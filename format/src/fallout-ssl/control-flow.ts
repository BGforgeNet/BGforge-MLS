/**
 * Control flow formatters for Fallout SSL code.
 * Extracted from core.ts -- handles if, while, for, foreach, switch.
 */

import type { Node as SyntaxNode } from "web-tree-sitter";

import { getCtx, normalizeComment, formatNode, formatBlock } from "./core";
import { formatExpression } from "./expressions";
import { SyntaxType } from "../../../server/src/fallout-ssl/tree-sitter.d";

export function formatIfStmt(node: SyntaxNode, depth: number, isElseIf: boolean = false): string {
    const ctx = getCtx();
    const cond = node.childForFieldName("cond");
    const thenBranch = node.childForFieldName("then");
    const elseBranch = node.childForFieldName("else");
    const thenIsBlock = thenBranch?.type === SyntaxType.Block;

    // Find "then" keyword to get its row for trailing comment detection
    const thenKeyword = node.children.find((c) => c.type === "then");
    const thenRow = thenKeyword?.startPosition.row ?? -1;

    // Collect comments between then and else early (needed for trailing comment handling)
    const elseComments: string[] = [];
    let thenTrailingComment = "";
    if (elseBranch) {
        for (const child of node.children) {
            if (child.type === SyntaxType.Comment || child.type === SyntaxType.LineComment) {
                if (
                    child.startPosition.row >= (thenBranch?.endPosition.row ?? 0) &&
                    child.startPosition.row < elseBranch.startPosition.row
                ) {
                    elseComments.push(normalizeComment(child.text));
                }
            }
        }
    }
    // Find trailing comment on "if ... then" line (same row as then, after then keyword)
    for (const child of node.children) {
        if (
            (child.type === SyntaxType.Comment || child.type === SyntaxType.LineComment) &&
            child.startPosition.row === thenRow &&
            thenKeyword &&
            child.startPosition.column > thenKeyword.endPosition.column
        ) {
            thenTrailingComment = ctx.indent + normalizeComment(child.text);
            break;
        }
    }

    // Condition starts after "if " or "else if "
    const condColumn = depth * ctx.indent.length + (isElseIf ? 8 : 3);
    // Extra length accounts for " then begin" (11 chars) after condition
    const extraLength = thenIsBlock ? 11 : 5; // " then begin" or " then"
    const formattedCond = formatExpression(cond, condColumn, extraLength);
    const condIsBroken = formattedCond.includes("\n");

    // If condition was broken across lines, put "then" on its own line
    let result: string;
    if (condIsBroken) {
        result = `if ${formattedCond}\n${ctx.indent.repeat(depth)}then` + thenTrailingComment;
    } else {
        result = `if ${formattedCond} then` + thenTrailingComment;
    }

    if (thenIsBlock) {
        result += " " + formatBlock(thenBranch, depth);
        // Comments between end and else: first as trailing, rest on own lines
        elseComments.forEach((comment, i) => {
            if (i === 0) {
                result += ctx.indent + comment;
            } else {
                result += "\n" + ctx.indent.repeat(depth) + comment;
            }
        });
    } else if (thenBranch) {
        result += "\n" + ctx.indent.repeat(depth + 1) + formatNode(thenBranch, depth + 1);
    }

    if (elseBranch) {
        const elseSep = thenIsBlock && elseComments.length === 0 ? " " : "\n" + ctx.indent.repeat(depth);

        if (elseBranch.type === SyntaxType.IfStmt) {
            result += elseSep + "else " + formatIfStmt(elseBranch, depth, true);
        } else if (elseBranch.type === SyntaxType.Block) {
            result += elseSep + "else " + formatBlock(elseBranch, depth);
        } else {
            result += elseSep + "else\n" + ctx.indent.repeat(depth + 1) + formatNode(elseBranch, depth + 1);
        }
    }

    return result;
}

export function formatWhileStmt(node: SyntaxNode, depth: number): string {
    const ctx = getCtx();
    const cond = node.childForFieldName("cond");
    const body = node.childForFieldName("body");
    const bodyIsBlock = body?.type === SyntaxType.Block;

    // Condition starts after "while " at column depth*indent + 6
    const condColumn = depth * ctx.indent.length + 6;
    // Extra length accounts for " do begin" (9 chars) or " do" (3 chars)
    const extraLength = bodyIsBlock ? 9 : 3;
    const formattedCond = formatExpression(cond, condColumn, extraLength);
    const condIsBroken = formattedCond.includes("\n");

    // If condition was broken across lines, put "do" on its own line
    let result: string;
    if (condIsBroken) {
        result = `while ${formattedCond}\n${ctx.indent.repeat(depth)}do`;
    } else {
        result = `while ${formattedCond} do`;
    }

    if (bodyIsBlock) {
        result += " " + formatBlock(body, depth);
    } else if (body) {
        result += "\n" + ctx.indent.repeat(depth + 1) + formatNode(body, depth + 1);
    }

    return result;
}

export function formatForStmt(node: SyntaxNode, depth: number): string {
    const ctx = getCtx();
    const init = node.childForFieldName("init");
    const cond = node.childForFieldName("cond");
    const update = node.childForFieldName("update");
    const body = node.childForFieldName("body");

    const initStr = init ? formatExpression(init) : "";
    const condStr = cond ? formatExpression(cond) : "";
    const updateStr = update ? formatExpression(update) : "";

    let result = `for (${initStr}; ${condStr}; ${updateStr})`;

    if (body?.type === SyntaxType.Block) {
        result += " " + formatBlock(body, depth);
    } else if (body) {
        result += "\n" + ctx.indent.repeat(depth + 1) + formatNode(body, depth + 1);
    }

    return result;
}

export function formatForeachStmt(node: SyntaxNode, depth: number): string {
    const ctx = getCtx();
    const varNode = node.childForFieldName("var");
    const keyNode = node.childForFieldName("key");
    const valueNode = node.childForFieldName("value");
    const hasVariable = node.children.some((c) => c.text === "variable");
    const hasParens = node.children.some((c) => c.text === "(");
    const iter = node.childForFieldName("iter");
    const body = node.childForFieldName("body");

    let header: string;
    const varPrefix = hasVariable ? "variable " : "";
    if (keyNode && valueNode) {
        // foreach k: v in expr (with or without parens)
        if (hasParens) {
            header = `foreach (${varPrefix}${keyNode.text}: ${valueNode.text} in ${formatExpression(iter)})`;
        } else {
            header = `foreach ${keyNode.text}: ${valueNode.text} in ${formatExpression(iter)}`;
        }
    } else if (keyNode) {
        // foreach (var in expr) - parenthesized single var form
        header = `foreach (${varPrefix}${keyNode.text} in ${formatExpression(iter)})`;
    } else if (varNode) {
        // foreach var in expr - no parens
        header = `foreach ${varNode.text} in ${formatExpression(iter)}`;
    } else {
        header = `foreach in ${formatExpression(iter)}`;
    }

    if (body?.type === SyntaxType.Block) {
        return header + " " + formatBlock(body, depth);
    } else if (body) {
        return header + "\n" + ctx.indent.repeat(depth + 1) + formatNode(body, depth + 1);
    }

    return header;
}

export function formatSwitchStmt(node: SyntaxNode, depth: number): string {
    const ctx = getCtx();
    const value = node.childForFieldName("value");
    const parts: string[] = [`switch ${formatExpression(value)} begin`];

    for (const child of node.children) {
        if (child.type === SyntaxType.CaseClause) {
            parts.push(formatCaseClause(child, depth + 1));
        } else if (child.type === SyntaxType.DefaultClause) {
            parts.push(formatDefaultClause(child, depth + 1));
        }
    }

    parts.push(ctx.indent.repeat(depth) + "end");
    return parts.join("\n");
}

function formatClauseBody(node: SyntaxNode, depth: number, skipTypes: Set<string>, skipNode?: SyntaxNode): string[] {
    const ctx = getCtx();
    const stmts: string[] = [];
    const skipPos = skipNode?.startPosition;

    for (const child of node.children) {
        if (skipTypes.has(child.type)) continue;
        if (skipPos && child.startPosition.row === skipPos.row && child.startPosition.column === skipPos.column)
            continue;

        const formatted = formatNode(child, depth + 1);
        if (formatted.trim()) {
            stmts.push(ctx.indent.repeat(depth + 1) + formatted);
        }
    }
    return stmts;
}

function formatCaseClause(node: SyntaxNode, depth: number): string {
    const ctx = getCtx();
    const value = node.childForFieldName("value");
    const stmts = formatClauseBody(node, depth, new Set(["case", ":"]), value ?? undefined);
    const header = ctx.indent.repeat(depth) + `case ${formatExpression(value)}:`;
    return stmts.length > 0 ? header + "\n" + stmts.join("\n") : header;
}

function formatDefaultClause(node: SyntaxNode, depth: number): string {
    const ctx = getCtx();
    const stmts = formatClauseBody(node, depth, new Set(["default", ":"]));
    const header = ctx.indent.repeat(depth) + "default:";
    return stmts.length > 0 ? header + "\n" + stmts.join("\n") : header;
}
