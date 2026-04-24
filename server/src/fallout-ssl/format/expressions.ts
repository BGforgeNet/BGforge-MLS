/**
 * Expression formatters for Fallout SSL code.
 * Extracted from core.ts -- handles all expression-level formatting.
 */

import type { Node as SyntaxNode } from "web-tree-sitter";

import { getCtx, isComment, throwFormatError } from "./core";
import { SyntaxType } from "../tree-sitter.d";

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
            return formatUnaryExpr(node);
        case "ternary_expr":
            return formatTernaryExpr(node);
        case "call_expr":
            return formatCallExpr(node, column, extraLength);
        case "subscript_expr":
            return formatSubscriptExpr(node);
        case "member_expr":
            return formatMemberExpr(node);
        case "paren_expr": {
            const inner = node.children[1];
            if (!inner || inner.type === SyntaxType.Comment || inner.type === SyntaxType.LineComment) {
                throwFormatError(
                    `Unexpected paren_expr structure: ${node.text}`,
                    node.startPosition.row + 1,
                    node.startPosition.column + 1,
                );
            }
            return `(${formatExpression(inner, column + 1, extraLength > 0 ? extraLength - 1 : 0)})`;
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
            // Note: Reserved word check removed here - macros can cause keywords to appear
            // as identifiers in the parse tree (e.g., `else` after macro that expands to
            // if-then-begin-end). Content validation catches any actual semantic changes.
            return node.text;
        case "number":
        case "boolean":
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
            return `variable ${name.text} = ${formatExpression(value)}`;
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
            const op = node.children.find((c) => c.text === ":=" || c.text === "=")?.text || "=";
            return `${name.text} ${op} ${formatExpression(value)}`;
        }
        default:
            return node.text;
    }
}

// Get operator from binary expression.
// Uses the "op" field defined in the grammar, which is reliable even when
// ERROR nodes appear between operands (e.g., CRLF line endings producing stray nodes).
function getBinaryOp(node: SyntaxNode): string {
    return node.childForFieldName("op")?.text ?? "";
}

// Flatten a chain of binary expressions with the same operator (e.g., a or b or c)
function flattenBinaryChain(node: SyntaxNode, op: string): SyntaxNode[] {
    const left = node.childForFieldName("left");
    const right = node.childForFieldName("right");
    const operands: SyntaxNode[] = [];

    if (left?.type === SyntaxType.BinaryExpr && getBinaryOp(left) === op) {
        operands.push(...flattenBinaryChain(left, op));
    } else if (left) {
        operands.push(left);
    }

    if (right?.type === SyntaxType.BinaryExpr && getBinaryOp(right) === op) {
        operands.push(...flattenBinaryChain(right, op));
    } else if (right) {
        operands.push(right);
    }

    return operands;
}

function formatBinaryExpr(node: SyntaxNode, column: number = 0, extraLength: number = 0): string {
    const ctx = getCtx();
    const left = node.childForFieldName("left");
    const right = node.childForFieldName("right");
    const op = getBinaryOp(node);

    // For logical/bitwise chains, try compact first then break if too long
    const breakableOps = ["or", "and", "bwor", "bwand", "bwxor"];
    if (breakableOps.includes(op)) {
        const operands = flattenBinaryChain(node, op);
        // Try compact first - format without column info for length check
        const compactOperands = operands.map((o) => formatExpression(o));
        const compact = compactOperands.join(` ${op} `);

        // Check if compact version fits (including any suffix like " then begin")
        if (column + compact.length + extraLength <= ctx.lineLimit) {
            return compact;
        }

        // Break before each operator, indent to align with first operand
        // Re-format operands with proper column info for nested breaking
        const opIndent = column + op.length + 1; // "op " prefix for subsequent operands
        const formattedOperands = operands.map((o, i) => {
            const opColumn = i === 0 ? column : opIndent;
            return formatExpression(o, opColumn);
        });
        const indent = " ".repeat(column);
        return formattedOperands.join(`\n${indent}${op} `);
    }

    // Non-breaking: pass column to left, calculate right's column based on left + op
    const formattedLeft = formatExpression(left, column);
    const rightColumn = column + formattedLeft.length + op.length + 2; // " op "
    return `${formattedLeft} ${op} ${formatExpression(right, rightColumn)}`;
}

function formatUnaryExpr(node: SyntaxNode): string {
    const op = node.childForFieldName("op")?.text || "";
    const expr = node.childForFieldName("expr");

    if (node.children[0]?.text === "++" || node.children[0]?.text === "--") {
        return `${op}${formatExpression(expr)}`;
    } else if (node.children[1]?.text === "++" || node.children[1]?.text === "--") {
        return `${formatExpression(expr)}${op}`;
    }

    // No space for unary minus on numbers, space for not/bnot
    if (op === "-") {
        return `${op}${formatExpression(expr)}`;
    }
    return `${op} ${formatExpression(expr)}`;
}

function formatTernaryExpr(node: SyntaxNode): string {
    const trueValue = node.childForFieldName("true_value");
    const cond = node.childForFieldName("cond");
    const falseValue = node.childForFieldName("false_value");

    return `${formatExpression(trueValue)} if ${formatExpression(cond)} else ${formatExpression(falseValue)}`;
}

function formatCallExpr(node: SyntaxNode, column: number = 0, extraLength: number = 0): string {
    const ctx = getCtx();
    const func = node.childForFieldName("func");
    const funcName = func?.text || "";
    // namedChildren[0] is the func, rest are args; skip inline block comments
    const argNodes = node.namedChildren.slice(1).filter((c) => c.type !== SyntaxType.Comment);
    const args = argNodes.map((a) => formatExpression(a));

    const compact = `${funcName}(${args.join(", ")})`;

    // Check if compact version fits (including any suffix)
    if (column + compact.length + extraLength <= ctx.lineLimit || args.length <= 1) {
        return compact;
    }

    // Break after each comma, indent to align after opening paren
    const indent = " ".repeat(column + funcName.length + 1);
    return `${funcName}(${args.join(",\n" + indent)})`;
}

function formatSubscriptExpr(node: SyntaxNode): string {
    const obj = node.childForFieldName("object");
    const index = node.childForFieldName("index");
    return `${formatExpression(obj)}[${formatExpression(index)}]`;
}

function formatMemberExpr(node: SyntaxNode): string {
    const obj = node.childForFieldName("object");
    const member = node.childForFieldName("member");
    return `${formatExpression(obj)}.${member?.text || ""}`;
}

function formatArrayExpr(node: SyntaxNode, column: number = 0, extraLength: number = 0): string {
    const ctx = getCtx();
    const elements: string[] = [];
    for (const child of node.children) {
        // Skip brackets, commas, and comments - comments cause spurious commas after last element
        if (child.type !== "[" && child.type !== "]" && child.type !== "," && !isComment(child)) {
            elements.push(formatExpression(child));
        }
    }

    const compact = `[${elements.join(", ")}]`;

    // Check if compact version fits (including any suffix)
    if (column + compact.length + extraLength <= ctx.lineLimit || elements.length <= 1) {
        return compact;
    }

    // Break after each comma, indent to align after opening bracket
    const indent = " ".repeat(column + 1);
    return `[${elements.join(",\n" + indent)}]`;
}

function formatMapExpr(node: SyntaxNode, column: number = 0, extraLength: number = 0): string {
    const ctx = getCtx();
    const entries: string[] = [];
    for (const child of node.children) {
        if (child.type === SyntaxType.MapEntry) {
            const key = child.childForFieldName("key");
            const value = child.childForFieldName("value");
            entries.push(`${formatExpression(key)}: ${formatExpression(value)}`);
        }
    }

    const compact = `{${entries.join(", ")}}`;

    // Check if compact version fits (including any suffix)
    if (column + compact.length + extraLength <= ctx.lineLimit || entries.length <= 1) {
        return compact;
    }

    // Break after each comma, indent to align after opening brace
    const indent = " ".repeat(column + 1);
    return `{${entries.join(",\n" + indent)}}`;
}

export function formatCallStmt(node: SyntaxNode): string {
    const target = node.childForFieldName("target");
    const delay = node.childForFieldName("delay");

    if (!target) return node.text;

    let result = "call ";
    if (target.type === SyntaxType.CallExpr) {
        result += formatCallExpr(target);
    } else {
        result += target.text;
    }

    if (delay) {
        result += ` in ${formatExpression(delay)}`;
    }

    return result + ";";
}

export function formatAssignment(node: SyntaxNode): string {
    const left = node.childForFieldName("left");
    const right = node.childForFieldName("right");

    let op = "=";
    for (const child of node.children) {
        if (["=", ":=", "+=", "-=", "*=", "/="].includes(child.text)) {
            op = child.text;
            break;
        }
    }

    return `${formatExpression(left)} ${op} ${formatExpression(right)};`;
}

export function formatExpressionStmt(node: SyntaxNode, depth: number): string {
    const ctx = getCtx();
    const expr = node.children.find((c) => c.type !== ";");
    if (!expr) return "";

    const hasSemicolon = node.children.some((c) => c.text === ";");
    const column = depth * ctx.indent.length;
    return formatExpression(expr, column) + (hasSemicolon ? ";" : "");
}
