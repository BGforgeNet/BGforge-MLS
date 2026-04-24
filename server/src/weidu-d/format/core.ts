/**
 * Core formatting logic for WeiDU D files.
 * Simple approach: preserve source structure, normalize indent, break long lines.
 *
 * For formatter behavior and examples, see:
 * {@link https://github.com/bgforge/vscode-mls/tree/master/grammars/weidu-d/formatter.md}
 */

import type { Node as SyntaxNode } from "web-tree-sitter";
import { normalizeWhitespaceWeidu, throwOnParseError, tokenizeWeidu, WeiduTokenType } from "../../shared/format-utils";

interface FormatOptions {
    indentSize: number;
    lineLimit: number;
}

const DEFAULT_OPTIONS: FormatOptions = {
    indentSize: 4,
    lineLimit: 120,
};

interface FormatResult {
    text: string;
}

interface FormatContext {
    indent: string;
    indent2: string;
    lineLimit: number;
}

function isComment(node: SyntaxNode): boolean {
    return node.type === "comment" || node.type === "line_comment";
}

function isCopyOrMacro(node: SyntaxNode): boolean {
    return node.type === "copy_trans" || node.type === "macro_expansion";
}

// Get the actual transition node (unwrap if wrapped in generic "transition")
function getTransitionNode(node: SyntaxNode): SyntaxNode | null {
    if (node.type === "transition") {
        return node.children[0] ?? null;
    }
    if (node.type.startsWith("transition_")) {
        return node;
    }
    return null;
}

// Find a keyword token in node's children by checking text (case-insensitive)
function findKeyword(node: SyntaxNode, keyword: string): string {
    const upper = keyword.toUpperCase();
    for (const child of node.children) {
        if (child.text.toUpperCase() === upper) {
            return child.text;
        }
    }
    return keyword; // fallback
}

// Apply inline comment normalization to a line (only if there's code before //)
function withNormalizedComment(line: string): string {
    if (!line.includes("//")) return line;
    // Check if this is a standalone comment line (only whitespace before //)
    const idx = line.indexOf("//");
    const before = line.slice(0, idx);
    if (!before.trim()) {
        // Standalone comment - preserve indent, normalize comment
        return before + normalizeLineComment(line.slice(idx));
    }
    return normalizeInlineComment(line);
}

// Normalize whitespace in a string: collapse runs of whitespace to single space, preserve strings
function normalizeWhitespace(text: string): string {
    return normalizeWhitespaceWeidu(text);
}

// Normalize a line comment: ensure "// comment" format (1 space after //), but preserve decorative separators
function normalizeLineComment(text: string): string {
    const trimmed = text.trim();
    if (trimmed.startsWith("//")) {
        const content = trimmed.slice(2);
        // Preserve decorative separators (//////) exactly - don't add space
        if (/^\/+$/.test(content)) {
            return "//" + content;
        }
        const normalized = content.trimStart();
        return normalized ? "// " + normalized : "//";
    }
    return trimmed;
}

// Normalize inline comment: ensure 2 spaces before //, 1 space after
function normalizeInlineComment(line: string): string {
    const idx = line.indexOf("//");
    if (idx === -1) return line;

    const code = line.slice(0, idx).trimEnd();
    const comment = line.slice(idx + 2).trimStart();
    return comment ? code + "  // " + comment : code + "  //";
}

// Normalize a trigger/action string - collapse whitespace inside delimiters
// But if contains //, preserve line structure
function normalizeDelimitedString(text: string): string {
    if (!text) return text;
    const delim = text[0];
    if (delim !== "~" && delim !== '"' && delim !== "%") {
        return text;
    }
    const inner = text.slice(1, -1);

    // If has // comments, can't collapse
    if (inner.includes("//")) {
        return text;
    }

    return delim + normalizeWhitespaceWeidu(inner) + delim;
}

// Check if node is a next-state feature (goto, exit, extern, short_goto)
function isNextFeature(node: SyntaxNode): boolean {
    return (
        node.type === "goto_next" ||
        node.type === "exit_next" ||
        node.type === "extern_next" ||
        node.type === "short_goto"
    );
}

// Normalize transition text: collapse whitespace in code, preserve strings and block comments exactly
function normalizeTransitionText(text: string): string {
    const tokens = tokenizeWeidu(text);
    const parts: string[] = [];

    for (const token of tokens) {
        if (token.type === WeiduTokenType.Code) {
            // Collapse whitespace in code parts
            parts.push(token.text.replace(/\s+/g, " "));
        } else {
            // Preserve strings and comments exactly as-is
            parts.push(token.text);
        }
    }

    return parts.join("").trim();
}

// Get line length excluding comment
function codeLengthOf(line: string): number {
    const idx = line.indexOf("//");
    return idx !== -1 ? line.slice(0, idx).trimEnd().length : line.length;
}

// Get text offset from node start to a child node
function getChildOffset(parent: SyntaxNode, child: SyntaxNode): number {
    const parentStart = parent.startIndex;
    return child.startIndex - parentStart;
}

// Format a single-line transition using AST for break points
function formatTransitionLine(node: SyntaxNode, indent: string, innerIndent: string, limit: number): string {
    const normalized = normalizeTransitionText(node.text);
    const line = withNormalizedComment(indent + normalized);

    if (codeLengthOf(line) <= limit) {
        return line;
    }

    // Find break points using AST
    const doFeature = node.children.find((c) => c.type === "do_feature");
    const nextFeature = node.children.find(isNextFeature);

    // Try breaking on DO
    if (doFeature) {
        const offset = getChildOffset(node, doFeature);
        const beforeDo = normalizeTransitionText(node.text.slice(0, offset));
        const doAndAfter = normalizeTransitionText(node.text.slice(offset));
        const firstLine = indent + beforeDo;

        if (firstLine.length <= limit) {
            const secondLine = innerIndent + doAndAfter;
            if (secondLine.length <= limit) {
                return firstLine + "\n" + secondLine;
            }
            // Try breaking on next-state after DO
            if (nextFeature) {
                const nextOffset = getChildOffset(node, nextFeature);
                if (nextOffset > offset) {
                    const doOnly = normalizeTransitionText(node.text.slice(offset, nextOffset));
                    const nextPart = normalizeTransitionText(node.text.slice(nextOffset));
                    return firstLine + "\n" + innerIndent + doOnly + "\n" + innerIndent + nextPart;
                }
            }
        }
    }

    // Try breaking on next-state directly
    if (nextFeature) {
        const offset = getChildOffset(node, nextFeature);
        const beforeNext = normalizeTransitionText(node.text.slice(0, offset));
        const nextPart = normalizeTransitionText(node.text.slice(offset));
        const firstLine = indent + beforeNext;
        if (firstLine.length <= limit) {
            return firstLine + "\n" + innerIndent + nextPart;
        }
    }

    // Can't break nicely, return as-is
    return line;
}

// Format a single transition node, breaking it into lines based on source structure
function formatTransitionNode(node: SyntaxNode, indent: string, innerIndent: string, limit: number): string {
    const text = node.text;

    // Single-line transition - use AST-based formatting
    if (!text.includes("\n")) {
        return formatTransitionLine(node, indent, innerIndent, limit);
    }

    // Multi-line transition - reindent preserving structure
    const tokens = tokenizeWeidu(text);
    const result: string[] = [];
    let currentLine: string = "";

    const flushLine = () => {
        if (currentLine.trim() || result.length === 0) {
            const prefix = result.length === 0 ? indent : innerIndent;
            result.push(withNormalizedComment(prefix + currentLine.trimEnd()));
        }
        currentLine = "";
    };

    // Helper: process a multi-line token (string or code) and split across output lines
    const processMultiLineToken = (tokenText: string, isCode: boolean) => {
        const lines = tokenText.split("\n");
        for (let i = 0; i < lines.length; i++) {
            const linePart = lines[i];
            if (linePart !== undefined) {
                const processed = isCode
                    ? linePart.trim().replace(/\s+/g, " ")
                    : i === 0
                      ? linePart
                      : linePart.trimStart();
                if (processed || (isCode && i < lines.length - 1)) {
                    if (i === 0) {
                        if (currentLine && !currentLine.endsWith(" ")) {
                            currentLine += " ";
                        }
                        currentLine += processed;
                    } else {
                        flushLine();
                        currentLine = processed;
                    }
                } else if (i < lines.length - 1) {
                    // Empty line in middle of multi-line token
                    flushLine();
                }
            }
        }
    };

    for (const token of tokens) {
        if (token.type !== WeiduTokenType.Code) {
            // String or comment
            if (token.text.includes("\n")) {
                processMultiLineToken(token.text, false);
            } else {
                // Single-line string/comment
                if (currentLine && !currentLine.endsWith(" ")) {
                    currentLine += " ";
                }
                currentLine += token.text;
            }
            continue;
        }

        // Code token
        if (token.text.includes("\n")) {
            processMultiLineToken(token.text, true);
        } else {
            const normalized = token.text.trim().replace(/\s+/g, " ");
            if (normalized) {
                if (currentLine && !currentLine.endsWith(" ")) {
                    currentLine += " ";
                }
                currentLine += normalized;
            }
        }
    }
    flushLine();

    return result.join("\n");
}

// Reindent a multi-line state preserving source structure
function reindentState(node: SyntaxNode, ctx: FormatContext): string {
    const baseRow = node.startPosition.row;
    const lines = node.text.split("\n");

    // Build map of extra indent per line by walking AST
    // Any line that continues a multi-line node from previous line gets +1
    const extraIndent: number[] = Array.from<number>({ length: lines.length }).fill(0);
    // END is the last non-blank line of a state
    let endKeywordLine = lines.length - 1;
    while (endKeywordLine > 0 && !lines[endKeywordLine]?.trim()) {
        endKeywordLine--;
    }

    function markContinuations(n: SyntaxNode) {
        // Only count top-level string nodes (not inner tilde_string etc)
        const isString = n.type === "string";
        const startLine = n.startPosition.row - baseRow;
        const endLine = n.endPosition.row - baseRow;

        if (isString && endLine > startLine && startLine >= 0) {
            // This string spans lines
            // Base depth is the extraIndent of the line where this string starts
            const baseDepth = (startLine < extraIndent.length ? extraIndent[startLine] : 0) ?? 0;
            for (let line = startLine + 1; line <= endLine; line++) {
                if (line < extraIndent.length) {
                    extraIndent[line] = Math.max(extraIndent[line] ?? 0, baseDepth + 1);
                }
            }
        }
        for (const child of n.children) {
            markContinuations(child);
        }
    }
    markContinuations(node);

    // Now reindent with the computed extra indents
    const result: string[] = [];
    let prevBlank = false;

    lines.forEach((line, i) => {
        const trimmed = line.trim();
        if (!trimmed) {
            if (!prevBlank && result.length > 0) {
                result.push("");
            }
            prevBlank = true;
            return;
        }
        prevBlank = false;

        const isFirst = result.length === 0;
        const isEnd = i === endKeywordLine;
        const depth = isFirst || isEnd ? 1 : 2 + (extraIndent[i] ?? 0);
        result.push(withNormalizedComment(ctx.indent.repeat(depth) + trimmed));
    });
    return result.join("\n");
}

// Format a state node
function formatState(node: SyntaxNode, ctx: FormatContext): string {
    const text = node.text;

    // Single line state - normalize whitespace if fits
    if (!text.includes("\n")) {
        const line = withNormalizedComment(ctx.indent + normalizeWhitespace(text));
        if (line.length <= ctx.lineLimit) {
            return line;
        }
        // Too long - need to expand
        return formatStateExpanded(node, ctx);
    }

    // Multi-line state - preserve source structure, just reindent
    return reindentState(node, ctx);
}

// Format a state by expanding it (when single line is too long)
function formatStateExpanded(node: SyntaxNode, ctx: FormatContext): string {
    const lines: string[] = [];
    const { indent, indent2, lineLimit } = ctx;

    // Find components
    const weight = node.childForFieldName("weight");
    const trigger = node.childForFieldName("trigger");
    const label = node.childForFieldName("label");
    const say = node.childForFieldName("say");

    // IF header
    let ifLine = indent + findKeyword(node, "IF");
    if (weight) {
        ifLine += " " + findKeyword(node, "WEIGHT") + " #" + weight.text;
    }
    ifLine += " " + (trigger ? normalizeDelimitedString(trigger.text) : "~~");
    ifLine += " " + (label?.text ?? "");

    // Try to keep SAY on same line as IF if it fits
    if (say) {
        const sayText = findKeyword(node, "SAY") + " " + formatSayText(say);
        const combined = ifLine + " " + sayText;
        if (combined.length <= lineLimit) {
            ifLine = combined;
        } else {
            lines.push(ifLine);
            ifLine = indent2 + sayText;
        }
    }
    lines.push(ifLine);

    // Transitions and comments
    for (const child of node.children) {
        const trans = getTransitionNode(child);
        if (trans) {
            lines.push(formatTransitionNode(trans, indent2, indent2 + indent, lineLimit));
        } else if (isCopyOrMacro(child)) {
            lines.push(indent2 + normalizeWhitespace(child.text));
        } else if (isComment(child)) {
            lines.push(indent2 + normalizeLineComment(child.text));
        }
    }

    lines.push(indent + findKeyword(node, "END"));
    return lines.join("\n");
}

// Format SAY text
function formatSayText(node: SyntaxNode): string {
    const parts: string[] = [];
    for (const child of node.children) {
        if (child.type !== "=" && !isComment(child)) {
            parts.push(child.text);
        }
    }
    return parts.join(" = ");
}

// Format a D action (BEGIN, APPEND, EXTEND, etc.)
function formatAction(node: SyntaxNode, ctx: FormatContext): string {
    switch (node.type) {
        case "begin_action":
            return formatStateAction(node, ctx, false);
        case "append_action":
            return formatStateAction(node, ctx, true);
        case "extend_action":
            return formatExtendAction(node, ctx);
        default:
            // For other actions, preserve source text
            return node.text;
    }
}

// Get the header from a BEGIN/APPEND action - everything before states and END
function getActionHeader(node: SyntaxNode): string {
    const headerRow = node.startPosition.row;
    const parts: string[] = [];
    for (const child of node.children) {
        // Stop at states or END keyword
        if (child.type === "state") break;
        if (child.text.toUpperCase() === "END") break;
        // Stop at comments that are NOT on the header line
        if (isComment(child) && child.startPosition.row !== headerRow) break;
        parts.push(isComment(child) ? normalizeLineComment(child.text) : child.text);
    }
    return normalizeWhitespace(parts.join(" "));
}

// Iterate children with blank line preservation, calling handler for each
function forEachChild(node: SyntaxNode, lines: string[], handler: (_child: SyntaxNode) => string | null): void {
    let lastEndRow = node.startPosition.row;
    for (const child of node.children) {
        if (child.startPosition.row > lastEndRow + 1) {
            lines.push("");
        }
        const formatted = handler(child);
        if (formatted !== null) {
            lines.push(formatted);
        }
        lastEndRow = child.endPosition.row;
    }
}

// Format BEGIN/APPEND action (states with optional trailing END)
function formatStateAction(node: SyntaxNode, ctx: FormatContext, trailingEnd: boolean): string {
    const headerRow = node.startPosition.row;
    const lines: string[] = [getActionHeader(node)];

    forEachChild(node, lines, (child) => {
        if (child.type === "state") {
            return formatState(child, ctx);
        } else if (isComment(child)) {
            // Skip comments on the header line - already included via getActionHeader()
            if (child.startPosition.row === headerRow) return null;
            return ctx.indent + normalizeLineComment(child.text);
        }
        return null;
    });

    if (trailingEnd) {
        lines.push(findKeyword(node, "END"));
    }
    return lines.join("\n");
}

// Build the header for an EXTEND action from its structural children (keyword, file, states, weight)
function getExtendHeader(node: SyntaxNode): string {
    let result = "";
    for (const child of node.children) {
        // Stop at transitions, comments, copy_trans, or the trailing END
        if (
            child.type === "transition" ||
            child.type.startsWith("transition_") ||
            isComment(child) ||
            isCopyOrMacro(child)
        )
            break;
        if (child.text.toUpperCase() === "END") break;
        // Don't insert space after "#" — keep "#N" as a single token (position number).
        // TODO: fix in grammar instead — tokenize "#N" as a single node (like tlk_ref does),
        // also for _weight_value. Then this workaround can be removed.
        if (result.length > 0 && !result.endsWith("#")) {
            result += " ";
        }
        result += child.text;
    }
    return result;
}

// Format EXTEND action
function formatExtendAction(node: SyntaxNode, ctx: FormatContext): string {
    const { indent, indent2, lineLimit } = ctx;
    const lines: string[] = [getExtendHeader(node)];

    forEachChild(node, lines, (child) => {
        const trans = getTransitionNode(child);
        if (trans) {
            return formatTransitionNode(trans, indent, indent2, lineLimit);
        } else if (isCopyOrMacro(child)) {
            return indent + normalizeWhitespace(child.text);
        } else if (isComment(child)) {
            return indent + normalizeLineComment(child.text);
        }
        return null;
    });

    lines.push(findKeyword(node, "END"));
    return lines.join("\n");
}

// Main formatting function
export function formatDocument(root: SyntaxNode, options?: Partial<FormatOptions>): FormatResult {
    throwOnParseError(root);
    const opts = { ...DEFAULT_OPTIONS, ...options };
    const indent = " ".repeat(opts.indentSize);
    const ctx: FormatContext = {
        indent,
        indent2: indent + indent,
        lineLimit: opts.lineLimit,
    };

    const result: string[] = [];
    let lastEndRow = -1;

    for (const child of root.children) {
        if (isComment(child)) {
            // Check if this comment is on the same line as the previous item (trailing comment)
            if (lastEndRow >= 0 && child.startPosition.row === lastEndRow) {
                // Trailing comment - append to previous line (only if there is a previous line)
                if (result.length > 0) {
                    result[result.length - 1] += " " + child.text;
                }
            } else {
                // Standalone comment - preserve blank lines
                if (lastEndRow >= 0 && child.startPosition.row > lastEndRow + 1) {
                    result.push("");
                }
                result.push(normalizeLineComment(child.text));
            }
        } else {
            // Non-comment node - preserve blank lines
            if (lastEndRow >= 0 && child.startPosition.row > lastEndRow + 1) {
                result.push("");
            }
            result.push(formatAction(child, ctx));
        }
        lastEndRow = child.endPosition.row;
    }

    // Ensure exactly one trailing newline
    while (result.length > 0 && result[result.length - 1] === "") {
        result.pop();
    }

    return {
        text: result.join("\n").replace(/\r/g, "") + "\n",
    };
}
