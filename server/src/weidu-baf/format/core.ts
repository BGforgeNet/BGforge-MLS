/**
 * Core formatting logic for WeiDU BAF files.
 * Shared between LSP server and CLI.
 * 
 * For formatter behavior and examples, see:
 * {@link https://github.com/bgforge/vscode-mls/tree/master/grammars/weidu-baf/formatter.md}
 */

import type { Node as SyntaxNode } from "web-tree-sitter";
import { SyntaxType } from "../tree-sitter.d";
import { throwOnParseError } from "../../shared/format-utils";

// Formatting options.
// Note: BAF doesn't need lineLimit - its format is inherently line-based
// (one trigger/action per line) with no long expressions to wrap.
interface FormatOptions {
    indentSize: number;
}

const DEFAULT_OPTIONS: FormatOptions = {
    indentSize: 4,
};

const INLINE_COMMENT_SPACING = "  ";

interface FormatResult {
    text: string;
}

// Format context - passed through to avoid global state
interface FormatContext {
    indent: string;
    indent2: string; // Double indent for nested elements
}

// Helper: check if node is a comment
function isComment(node: SyntaxNode): boolean {
    return node.type === SyntaxType.Comment || node.type === SyntaxType.LineComment;
}

// Normalize comment spacing (preserves multi-line block comments)
function normalizeComment(text: string): string {
    if (text.startsWith("/*")) {
        const inner = text.slice(2, -2);
        // Check if multi-line
        if (inner.includes("\n")) {
            return text; // Preserve as-is
        }
        return "/* " + inner.trim() + " */";
    }
    if (text.startsWith("//")) {
        const inner = text.slice(2);
        return "// " + inner.trimStart();
    }
    return text;
}

// Helper: append inline comment or push standalone comment
function handleComment(
    result: string[],
    child: SyntaxNode,
    lastNodeRow: number,
    indent: string,
): void {
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

// Format a single argument
function formatArgument(node: SyntaxNode): string {
    if (node.type === SyntaxType.CallExpr) {
        return formatCallExpr(node);
    }
    return node.text;
}

// Format a call expression: Name(arg1, arg2)
function formatCallExpr(node: SyntaxNode): string {
    const func = node.childForFieldName("func");
    const funcName = func?.text ?? "";

    const argNodes = node.childrenForFieldName("args");
    const args = argNodes.map(arg => formatArgument(arg));

    return funcName + "(" + args.join(", ") + ")";
}

// Format a condition: [!]CallExpr()
function formatCondition(node: SyntaxNode): string {
    const negated = node.children.some((c) => c.text === "!");
    const call = node.childForFieldName("call");
    const callText = call ? formatCallExpr(call) : "";
    return (negated ? "!" : "") + callText;
}

// Format an action: CallExpr()
function formatAction(node: SyntaxNode): string {
    const call = node.childForFieldName("call");
    return call ? formatCallExpr(call) : "";
}

// Format OR marker: OR(N)
function formatOrMarker(node: SyntaxNode): string {
    const count = node.childForFieldName("count");
    return "OR(" + (count?.text ?? "") + ")";
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
            result.push(ctx.indent + formatOrMarker(child));
            const count = child.childForFieldName("count");
            orCount = parseInt(count?.text ?? "0", 10);
            inOrGroup = true;
            lastNodeRow = child.endPosition.row;
        } else if (child.type === SyntaxType.Condition) {
            if (inOrGroup && orCount > 0) {
                // Indent OR conditions one extra level
                result.push(ctx.indent2 + formatCondition(child));
                orCount--;
                if (orCount === 0) {
                    inOrGroup = false;
                }
            } else {
                result.push(ctx.indent + formatCondition(child));
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
            result.push(ctx.indent2 + formatAction(child));
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
        text: result.join("\n").replace(/\r/g, "") + "\n",
    };
}
