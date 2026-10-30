/**
 * Expression formatters for Fallout SSL code.
 * Extracted from core.ts -- handles all expression-level formatting.
 */

import type { Node as SyntaxNode } from "web-tree-sitter";

import { getCtx, isComment, normalizeComment, throwFormatError } from "./core";
import { containsComment, itemsOf, layoutRowParts, terminate, weave, type Piece, type RowPart } from "../format-utils";
import { canonicalKeyword, canonicalOp } from "./canonical-keyword";
import { SyntaxType } from "@bgforge/shared/syntax-types/fallout-ssl";

/** Format an expression node to a string, with optional column tracking for line-breaking. */
export function formatExpression(
    node: SyntaxNode | null | undefined,
    column: number = 0,
    extraLength: number = 0,
): string {
    if (!node) return "";

    // Handle ERROR nodes: preserve original text
    if (node.type === SyntaxType.ERROR) {
        return node.text;
    }

    switch (node.type) {
        case "binary_expr":
            return formatBinaryExpr(node, column, extraLength);
        case "unary_expr":
            return formatUnaryExpr(node, column);
        case "ternary_expr":
            return formatTernaryExpr(node, column);
        case "call_expr":
            return formatCallExpr(node, column, extraLength);
        case "subscript_expr":
            return formatSubscriptExpr(node, column);
        case "member_expr":
            return formatMemberExpr(node, column);
        case "paren_expr": {
            const inner = node.children.find((child) => child.type !== "(" && child.type !== ")" && !isComment(child));
            if (!inner) {
                throwFormatError(
                    `Unexpected paren_expr structure: ${node.text}`,
                    node.startPosition.row + 1,
                    node.startPosition.column + 1,
                );
            }
            const innerText = formatExpression(inner, column + 1, extraLength > 0 ? extraLength - 1 : 0);
            return weave(
                itemsOf(node.children, (child) =>
                    child.id === inner.id
                        ? tight(innerText)
                        : child.type === "(" || child.type === ")"
                          ? tight(child.type)
                          : null,
                ),
                " ".repeat(column + 1),
            );
        }
        case "array_expr":
            return formatArrayExpr(node, column, extraLength);
        case "map_expr":
            return formatMapExpr(node, column, extraLength);
        case "proc_ref": {
            const ident = node.children[1];
            if (!ident || ident.type !== SyntaxType.Identifier) {
                throwFormatError(
                    `Unexpected proc_ref structure: ${node.text}`,
                    node.startPosition.row + 1,
                    node.startPosition.column + 1,
                );
            }
            return `@${ident.text}`;
        }
        case "identifier":
            return node.text;
        case "boolean":
            return canonicalKeyword(node.text);
        case "number":
        case "string":
            return node.text;
        case "for_var_decl": {
            const name = node.childForFieldName("name");
            const value = node.childForFieldName("value");
            if (!name || !value) {
                throwFormatError(
                    `Malformed for_var_decl: ${node.text}`,
                    node.startPosition.row + 1,
                    node.startPosition.column + 1,
                );
            }
            // Same `:=`-or-`=` choice as the sibling assignment below, and the same need to keep it.
            const valueText = formatExpression(value);
            return weave(
                itemsOf(node.children, (child) => {
                    if (child.type === "variable") return { text: canonicalKeyword("variable"), sep: "" };
                    if (child.id === name.id) return { text: name.text, sep: " " };
                    if (child.type === ":=" || child.type === "=") return { text: child.text, sep: " " };
                    return child.id === value.id ? { text: valueText, sep: " " } : null;
                }),
                " ".repeat(column),
            );
        }
        case "for_init_assign": {
            const name = node.childForFieldName("name");
            const value = node.childForFieldName("value");
            if (!name || !value) {
                throwFormatError(
                    `Malformed for_init_assign: ${node.text}`,
                    node.startPosition.row + 1,
                    node.startPosition.column + 1,
                );
            }
            // Preserve := vs = from original
            const valueText = formatExpression(value);
            return weave(
                itemsOf(node.children, (child) => {
                    if (child.id === name.id) return { text: name.text, sep: "" };
                    if (child.type === ":=" || child.type === "=") return { text: child.text, sep: " " };
                    return child.id === value.id ? { text: valueText, sep: " " } : null;
                }),
                " ".repeat(column),
            );
        }
        default:
            return node.text;
    }
}

// Get operator from binary expression.
// Uses the "op" field defined in the grammar, which is reliable even when
// ERROR nodes appear between operands (e.g., CRLF line endings producing stray nodes).
function getBinaryOp(node: SyntaxNode): string {
    return canonicalOp(node);
}

/** A piece written directly against the one before it. */
const tight = (text: string): Piece => ({ text, sep: "" });

/**
 * A chain of binary expressions with the same operator (`a or b or c`) as one run of its children: the operands, the
 * operator tokens (collected in `operators` by id) and the comments among them, in source order.
 */
function flattenBinaryChain(
    node: SyntaxNode,
    op: string,
    operators: Set<number> = new Set(),
): { children: SyntaxNode[]; operators: Set<number> } {
    const left = node.childForFieldName("left");
    const right = node.childForFieldName("right");
    const operator = node.childForFieldName("op");
    const children: SyntaxNode[] = [];

    for (const child of node.children) {
        const isOperand = child.id === left?.id || child.id === right?.id;
        if (isOperand && child.type === SyntaxType.BinaryExpr && getBinaryOp(child) === op) {
            children.push(...flattenBinaryChain(child, op, operators).children);
        } else if (isOperand || isComment(child)) {
            children.push(child);
        } else if (child.id === operator?.id) {
            operators.add(child.id);
            children.push(child);
        }
    }

    return { children, operators };
}

function formatBinaryExpr(node: SyntaxNode, column: number = 0, extraLength: number = 0): string {
    const ctx = getCtx();
    const left = node.childForFieldName("left");
    const right = node.childForFieldName("right");
    const operator = node.childForFieldName("op");
    const op = getBinaryOp(node);
    const indent = " ".repeat(column);

    // For logical/bitwise chains, try compact first then break if too long.
    const breakableOps = ["or", "and", "bwor", "bwand", "bwxor"];
    if (breakableOps.includes(op)) {
        const { children, operators } = flattenBinaryChain(node, op);
        // Try compact first - format without column info for length check. A line comment ends its line, so a chain
        // holding one is laid out by operator below.
        const compact = weave(
            itemsOf(children, (child) => ({ text: operators.has(child.id) ? op : formatExpression(child), sep: " " })),
            indent,
        );

        // Check if compact version fits (including any suffix like " then begin")
        if (
            !children.some((child) => child.type === SyntaxType.LineComment) &&
            column + compact.length + extraLength <= ctx.lineLimit
        ) {
            return compact;
        }

        // Break before each operator, indent to align with first operand
        // Re-format operands with proper column info for nested breaking
        const opIndent = column + op.length + 1; // "op " prefix for subsequent operands
        let operandIndex = 0;
        return weave(
            itemsOf(children, (child) => {
                if (operators.has(child.id)) return { text: op, sep: "\n" + indent };
                const first = operandIndex++ === 0;
                return {
                    text: formatExpression(child, first ? column : opIndent),
                    sep: " ",
                    indent: " ".repeat(first ? column : opIndent),
                };
            }),
            indent,
        );
    }

    // Non-breaking: pass column to left, calculate right's column based on left + op
    const formattedLeft = formatExpression(left, column);
    const rightColumn = column + formattedLeft.length + op.length + 2; // " op "
    const formattedRight = formatExpression(right, rightColumn);
    return weave(
        itemsOf(node.children, (child) => {
            if (child.id === left?.id) return tight(formattedLeft);
            if (child.id === operator?.id) return { text: op, sep: " " };
            return child.id === right?.id ? { text: formattedRight, sep: " " } : null;
        }),
        indent,
    );
}

function formatUnaryExpr(node: SyntaxNode, column: number = 0): string {
    const op = canonicalOp(node);
    const operator = node.childForFieldName("op");
    const expr = node.childForFieldName("expr");
    const exprText = formatExpression(expr);

    // `++` and `--` bind to the operand on either side, and so does a unary minus on its right. `not` and `bnot` take
    // a blank.
    const exprSep = op === "++" || op === "--" || op === "-" ? "" : " ";
    const postfix = operator !== null && expr !== null && operator.startIndex > expr.startIndex;
    return weave(
        itemsOf(node.children, (child) => {
            if (child.id === operator?.id) return { text: op, sep: postfix ? "" : exprSep };
            return child.id === expr?.id ? { text: exprText, sep: postfix ? "" : exprSep } : null;
        }),
        " ".repeat(column),
    );
}

function formatTernaryExpr(node: SyntaxNode, column: number = 0): string {
    const trueValue = node.childForFieldName("true_value");
    const cond = node.childForFieldName("cond");
    const falseValue = node.childForFieldName("false_value");
    const operands = [trueValue, cond, falseValue];

    return weave(
        itemsOf(node.children, (child) => {
            if (child.type === "if" || child.type === "else") return { text: child.type, sep: " " };
            return operands.some((operand) => child.id === operand?.id)
                ? { text: formatExpression(child), sep: " " }
                : null;
        }),
        " ".repeat(column),
    );
}

function listPart(node: SyntaxNode): RowPart {
    const comment = isComment(node);
    return {
        text: comment ? normalizeComment(node.text) : formatExpression(node),
        isItem: !comment,
        isLineComment: node.type === SyntaxType.LineComment,
        startRow: node.startPosition.row,
        endRow: node.endPosition.row,
    };
}

/**
 * Lay out a parenthesised or bracketed list, comments included. On one line when it fits, comments inline; else one
 * item per line, aligned after the opener (see layoutRowParts for where a comment goes). A `//` comment ends its line,
 * so a list holding one always breaks. `openRow` is the source row of the opener.
 */
function layoutList(
    open: string,
    parts: RowPart[],
    close: string,
    openRow: number,
    column: number,
    extraLength: number,
): string {
    const ctx = getCtx();
    const lastItem = parts.findLastIndex((part) => part.isItem);
    // The comma belongs to its item, so a comment after the comma follows it on the line.
    const tokens = parts.map((part, i) => ({
        ...part,
        text: part.isItem && i < lastItem ? `${part.text},` : part.text,
    }));
    const itemCount = parts.filter((part) => part.isItem).length;
    const hasLineComment = parts.some((part) => part.isLineComment);

    const compact = `${open}${tokens.map((token) => token.text).join(" ")}${close}`;
    if (!hasLineComment && (column + compact.length + extraLength <= ctx.lineLimit || itemCount <= 1)) {
        return compact;
    }

    const lines = layoutRowParts(open, openRow, tokens, { firstItemInline: true, spaceAfterHead: false });
    // A `//` comment takes the rest of its line, so a closer after it goes on the next one.
    if (parts.at(-1)?.isLineComment) {
        lines.push(close);
    } else {
        lines[lines.length - 1] += close;
    }
    return lines.join("\n" + " ".repeat(column + open.length));
}

function formatCallExpr(node: SyntaxNode, column: number = 0, extraLength: number = 0): string {
    const func = node.childForFieldName("func");
    const funcName = func?.text || "";
    // namedChildren[0] is the func, the rest are the arguments and the comments among them.
    const parts = node.namedChildren.slice(1).map((child) => listPart(child));
    const openRow = node.children.find((child) => child.type === "(")?.startPosition.row ?? node.startPosition.row;
    return layoutList(`${funcName}(`, parts, ")", openRow, column, extraLength);
}

function formatSubscriptExpr(node: SyntaxNode, column: number = 0): string {
    const obj = node.childForFieldName("object");
    const index = node.childForFieldName("index");
    return weave(
        itemsOf(node.children, (child) => {
            if (child.id === obj?.id || child.id === index?.id) return tight(formatExpression(child));
            return child.type === "[" || child.type === "]" ? tight(child.type) : null;
        }),
        " ".repeat(column),
    );
}

function formatMemberExpr(node: SyntaxNode, column: number = 0): string {
    const obj = node.childForFieldName("object");
    const member = node.childForFieldName("member");
    return weave(
        itemsOf(node.children, (child) => {
            if (child.id === obj?.id) return tight(formatExpression(child));
            if (child.id === member?.id) return tight(child.text);
            return child.type === "." ? tight(".") : null;
        }),
        " ".repeat(column),
    );
}

function formatArrayExpr(node: SyntaxNode, column: number = 0, extraLength: number = 0): string {
    // The brackets and commas are unnamed; the elements and the comments among them are not.
    const parts = node.namedChildren.map((child) => listPart(child));
    const openRow = node.children.find((child) => child.type === "[")?.startPosition.row ?? node.startPosition.row;
    return layoutList("[", parts, "]", openRow, column, extraLength);
}

function formatMapEntry(node: SyntaxNode, column: number): string {
    const key = node.childForFieldName("key");
    const value = node.childForFieldName("value");
    return weave(
        itemsOf(node.children, (child) => {
            if (child.id === key?.id) return tight(formatExpression(child));
            if (child.type === ":") return tight(":");
            return child.id === value?.id ? { text: formatExpression(child), sep: " " } : null;
        }),
        " ".repeat(column),
    );
}

function formatMapExpr(node: SyntaxNode, column: number = 0, extraLength: number = 0): string {
    const ctx = getCtx();
    const entryNodes = node.children.filter((child) => child.type === SyntaxType.MapEntry);
    const last = entryNodes.at(-1);
    // The comma belongs to its entry, so a comment after the comma follows it.
    const layout = (entrySep: string): string =>
        weave(
            itemsOf(node.children, (child) => {
                if (child.type === "{" || child.type === "}") return tight(child.type);
                if (child.type !== SyntaxType.MapEntry) return null;
                const text = formatMapEntry(child, column + 1) + (child.id === last?.id ? "" : ",");
                return { text, sep: child.id === entryNodes[0]?.id ? "" : entrySep };
            }),
            " ".repeat(column + 1),
        );

    const compact = layout(" ");

    // Check if compact version fits (including any suffix). A line comment ends its line, so a map holding one is
    // laid out by entry below.
    const hasLineComment = node.children.some((child) => child.type === SyntaxType.LineComment);
    if (!hasLineComment && (column + compact.length + extraLength <= ctx.lineLimit || entryNodes.length <= 1)) {
        return compact;
    }

    // Break after each comma, indent to align after opening brace
    return layout("\n" + " ".repeat(column + 1));
}

export function formatCallStmt(node: SyntaxNode, depth: number = 0): string {
    const ctx = getCtx();
    const target = node.childForFieldName("target");
    const delay = node.childForFieldName("delay");
    const condition = node.childForFieldName("condition");

    if (!target) return node.text;

    return weave(
        terminate(
            itemsOf(node.children, (child) => {
                if (child.type === "call") return tight(canonicalKeyword("call"));
                if (child.id === target.id) {
                    return { text: child.type === SyntaxType.CallExpr ? formatCallExpr(child) : child.text, sep: " " };
                }
                if (child.type === "in") return { text: "in", sep: " " };
                if (child.id === delay?.id || child.id === condition?.id) {
                    return { text: formatExpression(child), sep: " " };
                }
                if (/^when$/i.test(child.text)) return { text: canonicalKeyword("when"), sep: " " };
                return child.type === ";" ? tight(";") : null;
            }),
            ";",
        ),
        ctx.indent.repeat(depth + 1),
    );
}

export function formatAssignment(node: SyntaxNode, depth: number = 0): string {
    const ctx = getCtx();
    const left = node.childForFieldName("left");
    const right = node.childForFieldName("right");

    let op = "=";
    for (const child of node.children) {
        if (["=", ":=", "+=", "-=", "*=", "/="].includes(child.text)) {
            op = child.text;
            break;
        }
    }

    const leftText = formatExpression(left);
    const column = depth * ctx.indent.length + leftText.length + op.length + 2;
    return weave(
        terminate(
            itemsOf(node.children, (child) => {
                if (child.id === left?.id) return tight(leftText);
                if (child.id === right?.id) {
                    // The right side is laid out from column 0, as it always was; only a comment in it needs the real
                    // column, which is where a line comment's continuation lines up.
                    const text = formatExpression(child, containsComment(child) ? column : 0);
                    return { text, sep: " ", indent: " ".repeat(column) };
                }
                return child.text === op ? { text: op, sep: " " } : child.type === ";" ? tight(";") : null;
            }),
            ";",
        ),
        ctx.indent.repeat(depth + 1),
    );
}

export function formatExpressionStmt(node: SyntaxNode, depth: number): string {
    const ctx = getCtx();
    const expr = node.children.find((c) => c.type !== ";" && !isComment(c));
    if (!expr) return "";

    const column = depth * ctx.indent.length;
    return weave(
        itemsOf(node.children, (child) => {
            if (child.id === expr.id) return tight(formatExpression(child, column));
            return child.type === ";" ? tight(";") : null;
        }),
        ctx.indent.repeat(depth + 1),
    );
}
