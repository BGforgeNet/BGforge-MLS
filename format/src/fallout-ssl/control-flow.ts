/**
 * Control flow formatters for Fallout SSL code.
 * Extracted from core.ts -- handles if, while, for, foreach, switch.
 */

import type { Node as SyntaxNode } from "web-tree-sitter";

import { getCtx, isComment, normalizeComment, formatNode, formatBlock } from "./core";
import { EDGE_BLANKS, falloutSslLineCommentStart, itemsOf, weave } from "../format-utils";
import { formatExpression } from "./expressions";
import { canonicalKeyword } from "./canonical-keyword";
import { SyntaxType } from "@bgforge/shared/syntax-types/fallout-ssl";

/**
 * What goes between a head and its block body. The block opens on the head's line, unless a line comment ends that
 * line or comments written between the head and the block go above it, each on a line of its own.
 */
function blockSeparator(head: string, above: readonly SyntaxNode[], indent: string): string {
    if (above.length > 0) return linesAbove(above, indent) + "\n" + indent;
    const lastLine = head.slice(head.lastIndexOf("\n") + 1);
    return falloutSslLineCommentStart(lastLine) === -1 ? " " : "\n" + indent;
}

/** What goes between a head and its statement body: the comments between them, then the statement on its own line. */
function statementSeparator(above: readonly SyntaxNode[], indent: string): string {
    return linesAbove(above, indent) + "\n" + indent;
}

/** The comments, each on a line of its own at `indent` and after a line break. */
function linesAbove(comments: readonly SyntaxNode[], indent: string): string {
    return comments.map((comment) => "\n" + indent + normalizeComment(comment.text)).join("");
}

export function formatIfStmt(node: SyntaxNode, depth: number, isElseIf: boolean = false): string {
    const ctx = getCtx();
    const cond = node.childForFieldName("cond");
    const thenBranch = node.childForFieldName("then");
    const elseBranch = node.childForFieldName("else");
    const thenIsBlock = thenBranch?.type === SyntaxType.Block;

    // Find "then" keyword to get its row for trailing comment detection
    const thenKeyword = node.children.find((c) => c.type === "then");
    const thenRow = thenKeyword?.startPosition.row ?? -1;

    // Find trailing comment on "if ... then" line (same row as then, after then keyword)
    const thenTrailingNode = node.children.find(
        (child) =>
            (child.type === SyntaxType.Comment || child.type === SyntaxType.LineComment) &&
            child.startPosition.row === thenRow &&
            thenKeyword &&
            child.startPosition.column > thenKeyword.endPosition.column,
    );
    const thenTrailingComment = thenTrailingNode ? ctx.indent + normalizeComment(thenTrailingNode.text) : "";

    // Collect comments between then and else early (needed for trailing comment handling). The one written after
    // `then` is not among them: a statement on the `then` row would otherwise put its comment out twice.
    const elseCommentNodes: SyntaxNode[] = [];
    if (elseBranch) {
        const elseKw = node.children.find((c) => c.type === "else");
        for (const child of node.children) {
            if (child.type === SyntaxType.Comment || child.type === SyntaxType.LineComment) {
                // A comment on the row of the else branch counts when it comes before the `else` keyword.
                const beforeElse =
                    child.startPosition.row < elseBranch.startPosition.row ||
                    (child.startPosition.row === elseBranch.startPosition.row &&
                        elseKw !== undefined &&
                        child.endIndex <= elseKw.startIndex);
                // One after the then branch: on that branch's row it may as well lie in the head, before the `then`.
                if (
                    child.id !== thenTrailingNode?.id &&
                    child.startIndex >= (thenBranch?.endIndex ?? 0) &&
                    beforeElse
                ) {
                    elseCommentNodes.push(child);
                }
            }
        }
    }
    const elseComments = elseCommentNodes.map((comment) => normalizeComment(comment.text));

    // Condition starts after "if " or "else if "
    const condColumn = depth * ctx.indent.length + (isElseIf ? 8 : 3);
    // Extra length accounts for " then begin" (11 chars) after condition
    const extraLength = thenIsBlock ? 11 : 5; // " then begin" or " then"
    const formattedCond = formatExpression(cond, condColumn, extraLength);
    const condIsBroken = formattedCond.includes("\n");

    // If condition was broken across lines, put "then" on its own line
    const depthIndent = ctx.indent.repeat(depth);
    const thenIndex = node.children.findIndex((child) => child.id === thenKeyword?.id);
    const branchIndex = node.children.findIndex((child) => child.id === thenBranch?.id);
    const head = weave(
        itemsOf(node.children.slice(0, thenIndex + 1), (child) => {
            if (child.type === "if") return { text: canonicalKeyword("if"), sep: "" };
            if (child.id === cond?.id) return { text: formattedCond, sep: " ", indent: " ".repeat(condColumn) };
            if (child.type !== "then") return null;
            return {
                text: canonicalKeyword("then"),
                sep: condIsBroken ? "\n" + depthIndent : " ",
                indent: depthIndent,
            };
        }),
        ctx.indent.repeat(depth + 1),
    );
    // The comments between `then` and the branch that are not on the `then` row go above the branch.
    const aboveBranch = node.children
        .slice(thenIndex + 1, branchIndex)
        .filter((child) => isComment(child) && child.id !== thenTrailingNode?.id);
    let result = head + thenTrailingComment;

    if (thenIsBlock) {
        result += blockSeparator(result, aboveBranch, depthIndent) + formatBlock(thenBranch, depth);
        // Comments between end and else: first as trailing, rest on own lines
        elseComments.forEach((comment, i) => {
            if (i === 0) {
                result += ctx.indent + comment;
            } else {
                result += "\n" + ctx.indent.repeat(depth) + comment;
            }
        });
    } else if (thenBranch) {
        result += statementSeparator(aboveBranch, ctx.indent.repeat(depth + 1)) + formatNode(thenBranch, depth + 1);
        // Comments before the else: one that began on the statement's last row stays on it, the rest take lines.
        elseComments.forEach((comment, i) => {
            const trailing = i === 0 && elseCommentNodes[i]?.startPosition.row === thenBranch.endPosition.row;
            result += trailing ? ctx.indent + comment : "\n" + ctx.indent.repeat(depth) + comment;
        });
    }

    if (elseBranch) {
        const elseSep = thenIsBlock && elseComments.length === 0 ? " " : "\n" + ctx.indent.repeat(depth);
        // The comments between the `else` and its branch that are not among the ones written above the else.
        const elseKeyword = node.children.find((child) => child.type === "else");
        const afterElse = node.children.filter(
            (child) =>
                (child.type === SyntaxType.Comment || child.type === SyntaxType.LineComment) &&
                elseKeyword !== undefined &&
                child.startIndex >= elseKeyword.endIndex &&
                child.endIndex <= elseBranch.startIndex &&
                !elseCommentNodes.some((comment) => comment.id === child.id),
        );
        result += elseSep + formatElse(elseBranch, depth, afterElse);
    }

    return result;
}

/**
 * `else` and its branch: an if's own, or an else_clause continuing an if a macro opened. `comments` are the block
 * comments written between the `else` and the branch on the branch's row, which follow the `else`.
 */
function formatElse(elseBranch: SyntaxNode, depth: number, comments: SyntaxNode[] = []): string {
    const kwElse = [canonicalKeyword("else"), ...comments.map((comment) => normalizeComment(comment.text))].join(" ");
    if (elseBranch.type === SyntaxType.IfStmt) {
        return kwElse + " " + formatIfStmt(elseBranch, depth, true);
    }
    if (elseBranch.type === SyntaxType.Block) {
        return kwElse + " " + formatBlock(elseBranch, depth);
    }
    // With a comment after the `else`, the statement stays on its line: the comment, read again, is on its row.
    if (comments.length > 0) return kwElse + " " + formatNode(elseBranch, depth + 1);
    return kwElse + "\n" + getCtx().indent.repeat(depth + 1) + formatNode(elseBranch, depth + 1);
}

export function formatElseClause(node: SyntaxNode, depth: number): string {
    const elseBranch = node.childForFieldName("else");
    return elseBranch ? formatElse(elseBranch, depth) : node.text;
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
    const depthIndent = ctx.indent.repeat(depth);
    const doIndex = node.children.findIndex((child) => child.type === "do");
    const head = weave(
        itemsOf(node.children.slice(0, doIndex + 1), (child) => {
            if (child.type === "while") return { text: canonicalKeyword("while"), sep: "" };
            if (child.id === cond?.id) return { text: formattedCond, sep: " ", indent: " ".repeat(condColumn) };
            if (child.type !== "do") return null;
            return { text: canonicalKeyword("do"), sep: condIsBroken ? "\n" + depthIndent : " ", indent: depthIndent };
        }),
        ctx.indent.repeat(depth + 1),
    );

    return withBody(head, node, doIndex, body, depth);
}

/**
 * `head`, the head's comments after its last token, and the body. The comments on the row of that token stay behind
 * it; the ones further down, up to the body, go above the body, each on a line of its own. `headEnd` is the index
 * among `node`'s children of the head's last token.
 */
function withBody(head: string, node: SyntaxNode, headEnd: number, body: SyntaxNode | null, depth: number): string {
    const ctx = getCtx();
    const bodyIndex = node.children.findIndex((child) => child.id === body?.id);
    const endRow = node.children[headEnd]?.endPosition.row;
    const between = body ? node.children.slice(headEnd + 1, bodyIndex).filter((child) => isComment(child)) : [];
    const trailing = between.filter((comment) => comment.startPosition.row === endRow);
    const above = between.filter((comment) => !trailing.includes(comment));
    const result =
        head + trailing.map((comment, i) => (i === 0 ? ctx.indent : " ") + normalizeComment(comment.text)).join("");

    if (body?.type === SyntaxType.Block) {
        const indent = ctx.indent.repeat(depth);
        return result + blockSeparator(result, above, indent) + formatBlock(body, depth);
    }
    if (body) {
        return result + statementSeparator(above, ctx.indent.repeat(depth + 1)) + formatNode(body, depth + 1);
    }
    return result;
}

export function formatForStmt(node: SyntaxNode, depth: number): string {
    const ctx = getCtx();
    const init = node.childForFieldName("init");
    const cond = node.childForFieldName("cond");
    const update = node.childForFieldName("update");
    const body = node.childForFieldName("body");

    // Without parentheses the update ends in its own `;`. Kept as the source wrote it, as foreach heads are. The head
    // reads `init; cond; update` with a blank after each `;` even where a clause is empty: `for (; ; )`.
    const hasParens = node.children.some((c) => c.text === "(");
    const bodyIndex = node.children.findIndex((child) => child.id === body?.id);
    const headChildren = node.children.slice(0, bodyIndex === -1 ? undefined : bodyIndex);
    const headEnd = headChildren.findLastIndex((child) => !isComment(child));
    let semicolons = 0;
    const head = weave(
        itemsOf(headChildren.slice(0, headEnd + 1), (child) => {
            if (child.type === "for") return { text: canonicalKeyword("for"), sep: "" };
            if (child.type === "(") return { text: "(", sep: " " };
            if (child.id === init?.id) return { text: formatExpression(child), sep: hasParens ? "" : " " };
            if (child.id === cond?.id || child.id === update?.id) return { text: formatExpression(child), sep: " " };
            if (child.type === ")") return { text: ")", sep: update ? "" : " " };
            if (child.type !== ";") return null;
            // A `;` inside the parentheses after the update is not written.
            semicolons++;
            if (hasParens && semicolons > 2) return null;
            return { text: ";", sep: (semicolons === 2 && !cond) || (semicolons === 3 && !update) ? " " : "" };
        }),
        ctx.indent.repeat(depth + 1),
    );

    return withBody(head, node, headEnd, body, depth);
}

export function formatForeachStmt(node: SyntaxNode, depth: number): string {
    const ctx = getCtx();
    const keyNode = node.childForFieldName("key");
    const valueNode = node.childForFieldName("value");
    // The grammar aliases each case-insensitive keyword back to its canonical name, so the node type
    // identifies the keyword whatever the source spelled it.
    const variableKw = node.children.find((c) => c.type === "variable");
    const hasParens = node.children.some((c) => c.text === "(");
    const iter = node.childForFieldName("iter");
    const guard = node.childForFieldName("while_cond");
    const body = node.childForFieldName("body");

    // The parentheses, the `variable` keyword, the `key: value` pair and the `while` guard are each
    // independently optional, so one head assembled from parts is the only shape that cannot drop
    // whichever combination a branch per form would have missed.
    const bodyIndex = node.children.findIndex((child) => child.id === body?.id);
    const headChildren = node.children.slice(0, bodyIndex === -1 ? undefined : bodyIndex);
    const headEnd = headChildren.findLastIndex((child) => !isComment(child));
    const firstInHead = variableKw ?? keyNode;
    const header = weave(
        itemsOf(headChildren.slice(0, headEnd + 1), (child) => {
            if (child.type === "foreach") return { text: canonicalKeyword("foreach"), sep: "" };
            if (child.type === "(") return { text: "(", sep: " " };
            if (child.type === ")") return { text: ")", sep: "" };
            if (child.type === ":") return { text: ":", sep: "" };
            if (child.type === "variable") return { text: canonicalKeyword("variable"), sep: hasParens ? "" : " " };
            if (child.type === "in") return { text: canonicalKeyword("in"), sep: " " };
            if (child.type === "while") return { text: canonicalKeyword("while"), sep: " " };
            if (child.id === keyNode?.id || child.id === valueNode?.id) {
                return { text: child.text, sep: child.id === firstInHead?.id && hasParens ? "" : " " };
            }
            return child.id === iter?.id || child.id === guard?.id ? { text: formatExpression(child), sep: " " } : null;
        }),
        ctx.indent.repeat(depth + 1),
    );

    return withBody(header, node, headEnd, body, depth);
}

export function formatSwitchStmt(node: SyntaxNode, depth: number): string {
    const ctx = getCtx();
    const value = node.childForFieldName("value");
    const parts: string[] = [`${canonicalKeyword("switch")} ${formatExpression(value)} ${canonicalKeyword("begin")}`];

    for (const child of node.children) {
        if (child.type === SyntaxType.CaseClause) {
            parts.push(formatCaseClause(child, depth + 1));
        } else if (child.type === SyntaxType.DefaultClause) {
            parts.push(formatDefaultClause(child, depth + 1));
        } else if (child.type === SyntaxType.Comment || child.type === SyntaxType.LineComment) {
            parts.push(ctx.indent.repeat(depth + 1) + normalizeComment(child.text));
        }
    }

    parts.push(ctx.indent.repeat(depth) + canonicalKeyword("end"));
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
        if (formatted.replace(EDGE_BLANKS, "")) {
            stmts.push(ctx.indent.repeat(depth + 1) + formatted);
        }
    }
    return stmts;
}

function formatCaseClause(node: SyntaxNode, depth: number): string {
    const ctx = getCtx();
    const value = node.childForFieldName("value");
    const stmts = formatClauseBody(node, depth, new Set(["case", ":"]), value ?? undefined);
    const header = ctx.indent.repeat(depth) + `${canonicalKeyword("case")} ${formatExpression(value)}:`;
    return stmts.length > 0 ? header + "\n" + stmts.join("\n") : header;
}

function formatDefaultClause(node: SyntaxNode, depth: number): string {
    const ctx = getCtx();
    const stmts = formatClauseBody(node, depth, new Set(["default", ":"]));
    const header = ctx.indent.repeat(depth) + `${canonicalKeyword("default")}:`;
    return stmts.length > 0 ? header + "\n" + stmts.join("\n") : header;
}
