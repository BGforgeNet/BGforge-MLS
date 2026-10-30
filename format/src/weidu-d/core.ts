/**
 * Core formatting logic for WeiDU D files.
 * Simple approach: preserve source structure, normalize indent, break long lines.
 *
 * For formatter behavior and examples, see:
 * {@link https://github.com/bgforge/vscode-mls/tree/master/grammars/weidu-d/formatter.md}
 */

import type { Node as SyntaxNode } from "web-tree-sitter";
import { SyntaxType } from "@bgforge/shared/syntax-types/weidu-d";
import {
    normalizeWhitespaceWeidu,
    throwOnParseError,
    tokenizeWeidu,
    WeiduTokenType,
    normalizeComment,
    restoreLostComments,
    reportRescuedComments,
    commentItem,
    weave,
    weiduLineCommentStart,
    type WovenItem,
} from "../format-utils";
import { withNormalizedComment } from "../weidu-tp2/utils";
import { type FormatOptions, DEFAULT_OPTIONS, type FormatResult } from "../format-types";

// WeiDU D-specific context shape (carries indent2 for nested transitions).
interface FormatContext {
    indent: string;
    indent2: string;
    lineLimit: number;
}

function isComment(node: SyntaxNode): boolean {
    return node.type === SyntaxType.Comment || node.type === SyntaxType.LineComment;
}

/** The line a comment node is written as, at `indent`. */
function commentLines(node: SyntaxNode, indent: string): string[] {
    return [indent + normalizeComment(node.text)];
}

function isCopyTrans(node: SyntaxNode): boolean {
    return node.type === SyntaxType.CopyTrans;
}

// Get the actual transition node (unwrap if wrapped in generic "transition")
function getTransitionNode(node: SyntaxNode): SyntaxNode | null {
    if (node.type === SyntaxType.Transition) {
        return node.children[0] ?? null;
    }
    if (isTransitionBody(node)) {
        return node;
    }
    return null;
}

/** The concrete transition shapes a generic `transition` wraps. */
function isTransitionBody(node: SyntaxNode): boolean {
    return node.type === SyntaxType.TransitionFull || node.type === SyntaxType.TransitionShort;
}

// withNormalizedComment (inline + standalone comment handling) is shared with
// TP2 via @bgforge/format; D used a byte-equivalent local copy. Whitespace
// normalization uses normalizeWhitespaceWeidu directly (no D-specific logic).

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
    if (weiduLineCommentStart(inner) !== -1) {
        return text;
    }

    return delim + normalizeWhitespaceWeidu(inner) + delim;
}

// Check if node is a next-state feature (goto, exit, extern, short_goto)
function isNextFeature(node: SyntaxNode): boolean {
    return (
        node.type === SyntaxType.GotoNext ||
        node.type === SyntaxType.ExitNext ||
        node.type === SyntaxType.ExternNext ||
        node.type === SyntaxType.ShortGoto
    );
}

// True when a `~`/`"` string delimiter directly abuts a word character (in either order). That is the
// spot that renders as `~trigger~THEN` from a no-space source and reformats to `~trigger~ THEN`,
// breaking idempotency. `%` is deliberately excluded: %var%-interpolated names (%tutu_var%KELDDA,
// TAZOK%eet_var%) abut literal text on purpose and must never be split by a space.
function needsBoundarySpace(prev: string, next: string): boolean {
    const isTildeOrQuote = (c: string): boolean => c === "~" || c === '"';
    const isWord = (c: string): boolean => /\w/.test(c);
    return (isTildeOrQuote(prev) && isWord(next)) || (isWord(prev) && isTildeOrQuote(next));
}

// Normalize transition text: collapse whitespace in code, preserve strings and block comments exactly,
// and insert a separating space where a ~/"-string abuts a word with none (so `~..~THEN` is stable).
function normalizeTransitionText(text: string): string {
    const tokens = tokenizeWeidu(text);
    let result = "";

    for (const token of tokens) {
        const part = token.type === WeiduTokenType.Code ? token.text.replaceAll(/\s+/g, " ") : token.text;
        if (part.length > 0 && result.length > 0 && needsBoundarySpace(result[result.length - 1]!, part[0]!)) {
            result += " ";
        }
        result += part;
    }

    return result.trim();
}

/** The fields whose string holds BAF code (layout is formatting); any other string is text the game shows. */
const CODE_STRING_FIELDS = ["trigger", "action"];

function isCodeString(node: SyntaxNode): boolean {
    const parent = node.parent;
    return (
        parent !== null &&
        CODE_STRING_FIELDS.some((field) => parent.childrenForFieldName(field).some((c) => c?.id === node.id))
    );
}

/** Delimiter length of a WeiDU string token: `~~~~~` is five characters, every other opener one. */
function stringDelimiterLength(token: string): number {
    return token.startsWith("~~~~~") ? 5 : 1;
}

/**
 * The lines of `text` after its first, by index, that start inside a block comment or inside a string or comment
 * nested in a string - the BAF code of a trigger or action holds both. Their text is content and stays as written;
 * only a line starting in code is layout.
 */
function literalContinuationLines(text: string): Set<number> {
    const lineIndexAfter = new Map<number, number>();
    let lineCount = 0;
    for (let offset = 0; offset < text.length; offset++) {
        if (text[offset] === "\n") lineIndexAfter.set(offset + 1, ++lineCount);
    }

    const lines = new Set<number>();
    const markNewlines = (from: number, to: number): void => {
        for (let offset = from; offset < to; offset++) {
            const line = text[offset] === "\n" ? lineIndexAfter.get(offset + 1) : undefined;
            if (line !== undefined) lines.add(line);
        }
    };

    let tokenStart = 0;
    for (const token of tokenizeWeidu(text)) {
        const tokenEnd = tokenStart + token.text.length;
        if (token.type === WeiduTokenType.Comment) {
            markNewlines(tokenStart, tokenEnd);
        } else if (token.type === WeiduTokenType.String) {
            const delimiter = stringDelimiterLength(token.text);
            if (token.text.length >= 2 * delimiter) {
                let nestedStart = tokenStart + delimiter;
                for (const nested of tokenizeWeidu(token.text.slice(delimiter, -delimiter))) {
                    if (nested.type !== WeiduTokenType.Code)
                        markNewlines(nestedStart, nestedStart + nested.text.length);
                    nestedStart += nested.text.length;
                }
            }
        }
        tokenStart = tokenEnd;
    }
    return lines;
}

// Get line length excluding comment
function codeLengthOf(line: string): number {
    const idx = weiduLineCommentStart(line);
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
    const doFeature = node.children.find((c) => c.type === SyntaxType.DoFeature);
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
    // The line started inside a literal: its text goes out as written, whatever else joins it on the same line.
    let currentLineVerbatim = false;

    const flushLine = () => {
        if (currentLineVerbatim) {
            result.push(currentLine);
        } else if (currentLine.trim() || result.length === 0) {
            const prefix = result.length === 0 ? indent : innerIndent;
            result.push(withNormalizedComment(prefix + currentLine.trimEnd()));
        }
        currentLine = "";
        currentLineVerbatim = false;
    };

    // Helper: process a multi-line token (string or code) and split across output lines. `verbatimLines` are the
    // indexes of the lines that start inside a literal.
    const processMultiLineToken = (tokenText: string, isCode: boolean, verbatimLines?: ReadonlySet<number>) => {
        const lines = tokenText.split("\n");
        for (let i = 0; i < lines.length; i++) {
            const linePart = lines[i];
            if (linePart !== undefined && verbatimLines?.has(i)) {
                flushLine();
                currentLine = linePart;
                currentLineVerbatim = true;
            } else if (linePart !== undefined) {
                const processed = isCode
                    ? linePart.trim().replaceAll(/\s+/g, " ")
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

    // Where each text string (REPLY, JOURNAL) starts, relative to the node: tokens carry no tree, so a string
    // token is matched to its node by offset.
    const textStringStarts = new Set<number>();
    const collectTextStrings = (n: SyntaxNode): void => {
        if (n.type === SyntaxType.String) {
            if (!isCodeString(n)) textStringStarts.add(n.startIndex - node.startIndex);
            return;
        }
        for (const child of n.children) collectTextStrings(child);
    };
    collectTextStrings(node);

    let tokenStart = 0;
    for (const token of tokens) {
        const start = tokenStart;
        tokenStart += token.text.length;
        if (token.type !== WeiduTokenType.Code) {
            // A text string stays whole, its newlines and indentation being what the game shows; a code string
            // spanning lines is re-indented line by line, except the lines that start in a string or comment of its
            // own, and a block comment spanning lines keeps every line after its first as written.
            const isText = token.type === WeiduTokenType.String && textStringStarts.has(start);
            if (token.text.includes("\n") && !isText) {
                processMultiLineToken(token.text, false, literalContinuationLines(token.text));
            } else {
                if (currentLine && !currentLine.endsWith(" ")) {
                    currentLine += " ";
                }
                currentLine += token.text;
            }
            continue;
        }

        // Code token
        if (token.text.includes("\n")) {
            // A line comment ends its line: the break after it is kept, or the code that follows would join it.
            if (weiduLineCommentStart(currentLine) !== -1) flushLine();
            processMultiLineToken(token.text, true);
        } else {
            const normalized = token.text.trim().replaceAll(/\s+/g, " ");
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

    // A line continuing a multi-line CODE string (trigger, action) is indented one level past the line the
    // string starts on. A line continuing a TEXT string is the text itself: its leading and trailing whitespace
    // and its blank lines are what the game shows, so it is kept exactly as written.
    const extraIndent: number[] = Array.from<number>({ length: lines.length }).fill(0);
    const insideText: boolean[] = Array.from<boolean>({ length: lines.length }).fill(false);
    // END is the last non-blank line of a state
    let endKeywordLine = lines.length - 1;
    while (endKeywordLine > 0 && !lines[endKeywordLine]?.trim()) {
        endKeywordLine--;
    }

    function markContinuations(n: SyntaxNode) {
        // Only count top-level string nodes (not inner tilde_string etc)
        if (n.type === SyntaxType.String) {
            const startLine = n.startPosition.row - baseRow;
            const endLine = n.endPosition.row - baseRow;
            const code = isCodeString(n);
            const baseDepth = extraIndent[startLine] ?? 0;
            for (let line = Math.max(startLine + 1, 0); line <= endLine && line < lines.length; line++) {
                if (code) extraIndent[line] = Math.max(extraIndent[line] ?? 0, baseDepth + 1);
                else insideText[line] = true;
            }
            return;
        }
        for (const child of n.children) {
            markContinuations(child);
        }
    }
    markContinuations(node);
    const literalLines = literalContinuationLines(node.text);

    const result: string[] = [];
    let prevBlank = false;

    lines.forEach((line, i) => {
        if (insideText[i] || literalLines.has(i)) {
            result.push(line);
            prevBlank = false;
            return;
        }
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
        const line = withNormalizedComment(ctx.indent + normalizeWhitespaceWeidu(text));
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

    // Keywords are literals because D's grammar declares them case-sensitive: one spelling parses, and
    // anything else is an ERROR node throwOnParseError rejects. Fallout SSL matches case-insensitively,
    // so it needs a spelling policy instead - see fallout-ssl/canonical-keyword.ts.
    let ifLine = indent + "IF";
    if (weight) {
        ifLine += " WEIGHT " + weight.text;
    }
    ifLine += " " + (trigger ? normalizeDelimitedString(trigger.text) : "~~");
    // THEN and BEGIN are each optional in the grammar, and both are source text the state keeps.
    for (const keyword of ["THEN", "BEGIN"]) {
        if (node.children.some((child) => child.type === keyword)) ifLine += " " + keyword;
    }
    ifLine += " " + (label?.text ?? "");

    // Try to keep SAY on same line as IF if it fits
    if (say) {
        const sayText = "SAY " + formatSayText(say);
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
        } else if (isCopyTrans(child)) {
            lines.push(indent2 + normalizeWhitespaceWeidu(child.text));
        } else if (isComment(child)) {
            lines.push(...commentLines(child, indent2));
        }
    }

    lines.push(indent + "END");
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

/**
 * `formatted`, a node's text, with each comment of the node it lacks put back on a line of its own. The D formatters
 * rebuild a node from the children they pick, so a comment they do not pick would vanish.
 */
function keepComments(node: SyntaxNode, formatted: string, indent: string): string {
    return restoreLostComments(node, formatted, true, indent, true);
}

// Format a D action (BEGIN, APPEND, EXTEND, etc.)
function formatAction(node: SyntaxNode, ctx: FormatContext): string {
    return keepComments(node, formatActionWithoutLostComments(node, ctx), "");
}

function formatActionWithoutLostComments(node: SyntaxNode, ctx: FormatContext): string {
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

/** The header of an action, written as one line unless a `//` comment in it ends a line. */
interface ActionHeader {
    text: string;
    /** The comments of the action the header holds. */
    consumed: ReadonlySet<number>;
}

/**
 * The header of an action: its children ahead of the first one `startsBody` accepts. A comment between header words,
 * or (with `trailing`) after the last one on its row, stays in the header where it was written; the ones further
 * down are body comments, left to the caller. `normalize` collapses the blanks inside each word.
 */
function getActionHeader(
    node: SyntaxNode,
    startsBody: (child: SyntaxNode) => boolean,
    options: { normalize: boolean; trailing: boolean },
    indent: string,
): ActionHeader {
    const { normalize, trailing } = options;
    const children = node.children;
    const bodyAt = children.findIndex((child) => startsBody(child));
    const ahead = bodyAt === -1 ? children : children.slice(0, bodyAt);
    let last = ahead.findLastIndex((child) => !isComment(child));
    const lastRow = ahead[last]?.endPosition.row;
    if (trailing) {
        while (
            ahead[last + 1] !== undefined &&
            isComment(ahead[last + 1]!) &&
            ahead[last + 1]!.startPosition.row === lastRow
        ) {
            last++;
        }
    }

    const consumed = new Set<number>();
    const items = ahead.slice(0, last + 1).map((child): WovenItem => {
        if (!isComment(child)) return { text: normalize ? normalizeWhitespaceWeidu(child.text) : child.text, sep: " " };
        consumed.add(child.id);
        return commentItem(child);
    });
    return { text: weave(items, indent), consumed };
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
    const header = getActionHeader(
        node,
        (child) => child.type === SyntaxType.State || child.text === "END",
        { normalize: true, trailing: true },
        ctx.indent,
    );
    const lines: string[] = [header.text];

    forEachChild(node, lines, (child) => {
        if (child.type === SyntaxType.State) {
            return keepComments(child, formatState(child, ctx), ctx.indent);
        } else if (isComment(child) && !header.consumed.has(child.id)) {
            return commentLines(child, ctx.indent).join("\n") || null;
        }
        return null;
    });

    if (trailingEnd) {
        lines.push("END");
    }
    return lines.join("\n");
}

// Format EXTEND action; the header is its structural children (keyword, file, states, weight)
function formatExtendAction(node: SyntaxNode, ctx: FormatContext): string {
    const { indent, indent2, lineLimit } = ctx;
    // The header stops at the transitions, copy_trans, or the trailing END
    const header = getActionHeader(
        node,
        (child) =>
            child.type === SyntaxType.Transition ||
            isTransitionBody(child) ||
            isCopyTrans(child) ||
            child.text === "END",
        { normalize: false, trailing: false },
        indent,
    );
    const lines: string[] = [header.text];

    forEachChild(node, lines, (child) => {
        const trans = getTransitionNode(child);
        if (trans) {
            return formatTransitionNode(trans, indent, indent2, lineLimit);
        } else if (isCopyTrans(child)) {
            return indent + normalizeWhitespaceWeidu(child.text);
        } else if (isComment(child) && !header.consumed.has(child.id)) {
            return commentLines(child, indent).join("\n");
        }
        return null;
    });

    lines.push("END");
    return lines.join("\n");
}

// Main formatting function
export function formatDocument(root: SyntaxNode, options?: Partial<FormatOptions>): FormatResult {
    return reportRescuedComments(() => formatDocumentText(root, options));
}

function formatDocumentText(root: SyntaxNode, options?: Partial<FormatOptions>): FormatResult {
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
                result.push(...commentLines(child, ""));
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
        text: result.join("\n").replaceAll("\r", "") + "\n",
    };
}
