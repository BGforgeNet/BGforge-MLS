/**
 * Core formatting logic for WeiDU BAF files.
 * Shared between LSP server and CLI.
 *
 * For formatter behavior and examples, see:
 * {@link https://github.com/bgforge/vscode-mls/tree/master/grammars/weidu-baf/formatter.md}
 */

import type { Node as SyntaxNode } from "web-tree-sitter";
import { bafIntegerValue } from "@bgforge/shared/baf-integer";
import { SyntaxType } from "@bgforge/shared/syntax-types/weidu-baf";
import {
    itemsOf,
    normalizeComment,
    reportRescuedComments,
    restoreLostComments,
    terminate,
    throwOnParseError,
    weave,
} from "../format-utils";
import { type FormatResult } from "../format-types";

// Formatting options. BAF intentionally declares its own narrower options type
// instead of the shared FormatOptions: its format is line-based (one
// trigger/action per line) with no long expressions to wrap, so it has no
// lineLimit.
interface FormatOptions {
    indentSize: number;
}

const DEFAULT_OPTIONS: FormatOptions = {
    indentSize: 4,
};

const INLINE_COMMENT_SPACING = "  ";

// Format context - passed through to avoid global state
interface FormatContext {
    indent: string;
    indent2: string; // Double indent for nested elements
}

// Helper: check if node is a comment
function isComment(node: SyntaxNode): boolean {
    return node.type === SyntaxType.Comment || node.type === SyntaxType.LineComment;
}

// Helper: append inline comment or push standalone comment
function handleComment(result: string[], child: SyntaxNode, lastNodeRow: number, indent: string): void {
    if (lastNodeRow === child.startPosition.row && result.length > 0) {
        result[result.length - 1] += INLINE_COMMENT_SPACING + normalizeComment(child.text);
    } else {
        result.push(indent + normalizeComment(child.text));
    }
}

// Helper: handle block-level comments between clauses
function handleBlockLevelComments(
    node: SyntaxNode,
    result: string[],
    startRow: number,
    endRow: number,
    indent: string,
): void {
    for (const child of node.children) {
        if (!isComment(child)) continue;
        const row = child.startPosition.row;
        if (row < startRow || row > endRow) continue;

        if (row === startRow && result.length > 0) {
            // Inline comment on same row as previous element
            result[result.length - 1] += INLINE_COMMENT_SPACING + normalizeComment(child.text);
        } else if (row > startRow) {
            // Standalone comment
            result.push(indent + normalizeComment(child.text));
        }
    }
}

// Format a call expression: Name(arg1, arg2). `lineIndent` is the indent of the line it starts on. A comment among
// the arguments stays where it was written; a `//` comment ends its line, so what follows it starts a new one.
function formatCallExpr(node: SyntaxNode, lineIndent: string, ctx: FormatContext): string {
    const func = node.childForFieldName("func");
    const funcName = func?.text ?? "";

    // The arguments (a call among them) and the comments, in source order.
    const parts = node.namedChildren.filter((child) => child.id !== func?.id);
    const lastArg = parts.findLastIndex((part) => !isComment(part));
    const tokens = parts.map((part, i) => {
        if (isComment(part)) return normalizeComment(part.text);
        const arg = part.type === SyntaxType.CallExpr ? formatCallExpr(part, lineIndent, ctx) : part.text;
        return i < lastArg ? arg + "," : arg;
    });

    let text = funcName + "(";
    tokens.forEach((token, i) => {
        const previous = parts[i - 1];
        if (previous === undefined) text += token;
        else if (previous.type === SyntaxType.LineComment) text += "\n" + lineIndent + ctx.indent + token;
        else text += " " + token;
    });
    // An ActionOverride may stand without its closing parenthesis; the text is kept as written, not completed.
    const closed = node.children.some((child) => child.type === ")");
    if (!closed) return text;
    return parts.at(-1)?.type === SyntaxType.LineComment ? text + "\n" + lineIndent + ")" : text + ")";
}

// Format a condition: [!]CallExpr()
function formatCondition(node: SyntaxNode, lineIndent: string, ctx: FormatContext): string {
    const call = node.childForFieldName("call");
    const callText = call ? formatCallExpr(call, lineIndent, ctx) : "";
    return weave(
        itemsOf(node.children, (child) => {
            if (child.text === "!") return { text: "!", sep: "" };
            return child.id === call?.id ? { text: callText, sep: "" } : null;
        }),
        lineIndent + ctx.indent,
    );
}

// `line`, the output for a node, with each comment of the node it lacks put back on a line of its own: a comment
// written where the formatter takes only the call (after a `!`, inside `OR(`) would vanish.
function keepComments(node: SyntaxNode, line: string, indent: string): string {
    return restoreLostComments(node, line, true, indent, true);
}

// Format an action: CallExpr()
function formatAction(node: SyntaxNode, lineIndent: string, ctx: FormatContext): string {
    const call = node.childForFieldName("call");
    return call ? formatCallExpr(call, lineIndent, ctx) : "";
}

// Format OR marker: OR(N)
function formatOrMarker(node: SyntaxNode, lineIndent: string, ctx: FormatContext): string {
    const count = node.childForFieldName("count");
    return weave(
        terminate(
            itemsOf(node.children, (child) => {
                if (child.id === count?.id) return { text: child.text, sep: "" };
                if (child.type === "(" || child.type === ")") return { text: child.type, sep: "" };
                return child.type === "OR" ? { text: "OR", sep: "" } : null;
            }),
            ")",
        ),
        lineIndent + ctx.indent,
    );
}

// Format IF clause with conditions
function formatIfClause(node: SyntaxNode, result: string[], ctx: FormatContext): void {
    result.push("IF");

    // Track OR groups for proper indentation
    let inOrGroup = false;
    let orCount = 0;
    let lastNodeRow = -1;

    for (const child of node.children) {
        if (child.type === SyntaxType.OrMarker) {
            // Start OR group
            result.push(keepComments(child, ctx.indent + formatOrMarker(child, ctx.indent, ctx), ctx.indent));
            const count = child.childForFieldName("count");
            // A count read from a `%variable%` is unknown here, so its conditions stay flat: an indent would claim
            // a grouping the file may not have.
            const known = count === null ? Number.NaN : bafIntegerValue(count.text);
            orCount = Number.isFinite(known) ? known : 0;
            inOrGroup = true;
            lastNodeRow = child.endPosition.row;
        } else if (child.type === SyntaxType.Condition) {
            if (inOrGroup && orCount > 0) {
                // Indent OR conditions one extra level
                result.push(keepComments(child, ctx.indent2 + formatCondition(child, ctx.indent2, ctx), ctx.indent2));
                orCount--;
                if (orCount === 0) {
                    inOrGroup = false;
                }
            } else {
                result.push(keepComments(child, ctx.indent + formatCondition(child, ctx.indent, ctx), ctx.indent));
            }
            lastNodeRow = child.endPosition.row;
        } else if (isComment(child)) {
            const indent = inOrGroup && orCount > 0 ? ctx.indent2 : ctx.indent;
            handleComment(result, child, lastNodeRow, indent);
            lastNodeRow = child.endPosition.row;
        }
    }
}

// Format THEN clause with responses
function formatThenClause(node: SyntaxNode, result: string[], ctx: FormatContext): void {
    result.push("THEN");

    let lastNodeRow = -1;
    for (const child of node.children) {
        if (child.type === SyntaxType.Response) {
            formatResponse(child, result, ctx);
            lastNodeRow = child.endPosition.row;
        } else if (isComment(child)) {
            handleComment(result, child, lastNodeRow, ctx.indent);
            lastNodeRow = child.endPosition.row;
        }
    }
}

// Format a response block: RESPONSE #weight actions...
function formatResponse(node: SyntaxNode, result: string[], ctx: FormatContext): void {
    const weight = node.childForFieldName("weight");
    result.push(ctx.indent + "RESPONSE #" + (weight?.text ?? "100"));

    let lastNodeRow = weight?.endPosition.row ?? -1;

    for (const child of node.children) {
        if (child.type === SyntaxType.Action) {
            result.push(keepComments(child, ctx.indent2 + formatAction(child, ctx.indent2, ctx), ctx.indent2));
            lastNodeRow = child.endPosition.row;
        } else if (isComment(child)) {
            handleComment(result, child, lastNodeRow, ctx.indent2);
            lastNodeRow = child.endPosition.row;
        }
    }
}

// Format a complete IF/THEN/END block
function formatBlock(node: SyntaxNode, result: string[], ctx: FormatContext): void {
    const ifClause = node.childForFieldName("if");
    const thenClause = node.childForFieldName("then");

    if (ifClause) {
        formatIfClause(ifClause, result, ctx);
    }

    // Handle comments between IF and THEN (at block level)
    const ifEndRow = ifClause?.endPosition.row ?? -1;
    const thenStartRow = thenClause?.startPosition.row ?? Infinity;
    handleBlockLevelComments(node, result, ifEndRow, thenStartRow - 1, ctx.indent);

    if (thenClause) {
        formatThenClause(thenClause, result, ctx);
    }

    // Handle comments between THEN and END (at block level)
    const thenEndRow = thenClause?.endPosition.row ?? -1;
    const endRow = node.endPosition.row;
    handleBlockLevelComments(node, result, thenEndRow, endRow - 1, ctx.indent2);

    result.push("END");
}

// Main formatting function
export function formatDocument(root: SyntaxNode, options?: Partial<FormatOptions>): FormatResult {
    return reportRescuedComments(() => formatDocumentText(root, options));
}

function formatDocumentText(root: SyntaxNode, options?: Partial<FormatOptions>): FormatResult {
    throwOnParseError(root);
    const opts = { ...DEFAULT_OPTIONS, ...options };
    const ctx: FormatContext = {
        indent: " ".repeat(opts.indentSize),
        indent2: " ".repeat(opts.indentSize * 2),
    };

    const result: string[] = [];
    let lastEndRow = -1;

    for (const child of root.children) {
        if (child.type === SyntaxType.Block || isComment(child)) {
            // Preserve blank lines: if there was a gap, add one blank line
            if (lastEndRow >= 0 && child.startPosition.row > lastEndRow + 1) {
                result.push("");
            }
            if (child.type === SyntaxType.Block) {
                formatBlock(child, result, ctx);
            } else {
                result.push(normalizeComment(child.text));
            }
            lastEndRow = child.endPosition.row;
        }
    }

    // Ensure exactly one trailing newline
    while (result.length > 0 && result[result.length - 1] === "") {
        result.pop();
    }
    return {
        text: result.join("\n").replaceAll("\r", "") + "\n",
    };
}
