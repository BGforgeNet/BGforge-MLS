/**
 * Shared formatting utilities.
 */

import type { Node as SyntaxNode } from "web-tree-sitter";
import { findParseError, isImplicitEnd } from "@bgforge/shared/parse-errors";

/** Library-shape formatter output. Wrappers convert to LSP TextEdit[] at the LSP boundary. */
export interface FormatOutput {
    text: string;
    /** The formatter refused: `text` is the input, unchanged. */
    warning?: string;
    /** The text is formatted, and the caller should say this to the user (a comment had to be moved). */
    notice?: string;
}

/** Strips a leading UTF-8 BOM (\uFEFF) from text if present. */
export function stripBom(text: string): string {
    return text.startsWith("\uFEFF") ? text.slice(1) : text;
}

/**
 * Reduces text to the content formatting must preserve, for validateFormatting to compare against.
 * Every language drops comments from the reduced text; Fallout SSL also folds keyword case, because its formatter
 * canonicalises keyword spelling and the guard would otherwise read that as changed content.
 *
 * `omitted` lists what the reduced text leaves out but a formatter must still keep, in source order: the comments,
 * and for .msg the audio names. validateFormatting compares the two lists item by item, ignoring blanks, so a
 * formatter that drops or rewords a comment is refused although the code beside it is unchanged. A normalizer
 * without `omitted` leaves its omissions unguarded.
 */
export interface CompareNormalizer {
    (text: string): string;
    readonly omitted?: (text: string) => string[];
}

/** A normalizer for validateFormatting: `reduce` gives the compared text, `omitted` what it leaves out. */
export function withOmitted(reduce: (text: string) => string, omitted: (text: string) => string[]): CompareNormalizer {
    return Object.assign((text: string) => reduce(text), { omitted });
}

/**
 * Throw if the tree has a syntax error: an ERROR or MISSING node, or an implicit END (see shared/parse-errors.ts).
 * Call at the top of every formatDocument() to prevent formatting malformed input.
 */
export function throwOnParseError(root: SyntaxNode): void {
    const node = findParseError(root);
    if (node) {
        const { row, column } = node.startPosition;
        const kind = node.isMissing || isImplicitEnd(node) ? "MISSING" : "ERROR";
        throw new Error(`${row + 1}:${column + 1}: Parse ${kind}`);
    }
}

// ============================================
// Comment normalization (shared by every formatter)
// ============================================
//
// One canonical normalizer drives Fallout SSL, WeiDU BAF/D/TP2. Behavior:
//   - Line comments: exactly one space after `//`, leading whitespace collapsed,
//     trailing whitespace trimmed. Empty -> `//`.
//   - All-slash decorative dividers (`//////`) are preserved verbatim so visual
//     separators are not mangled into `// ////`.
//   - Block comments: single-line -> `/* text */`; multiline normalizes only the
//     spacing adjacent to `/*` and `*/`, leaving interior lines untouched.

/** Normalize a line comment. Input must be a comment token (may have outer whitespace). */
export function normalizeLineComment(text: string): string {
    const trimmed = text.trim();
    if (!trimmed.startsWith("//")) return trimmed;
    const content = trimmed.slice(2);
    // Decorative separator (all slashes, e.g. //////): preserve verbatim.
    if (/^\/+$/.test(content)) return trimmed;
    const body = content.trimStart();
    return body.length === 0 ? "//" : `// ${body}`;
}

/** Normalize a block comment. Input must be a comment token (may have outer whitespace). */
export function normalizeBlockComment(text: string): string {
    const trimmed = text.trim();
    if (!trimmed.startsWith("/*")) return trimmed;
    const inner = trimmed.slice(2, -2);
    // A `/**` doc-comment opener leaves `*` as the first inner char. Preserve it
    // rather than inserting a leading space and splitting `/**` into `/* *`.
    // An empty block (`/**/`) has no inner char, so it is not a doc comment.
    const isDoc = inner.startsWith("*");
    if (inner.includes("\n")) {
        // Multiline: normalize only the edges abutting /* and */; preserve interior.
        let result = inner;
        if (!isDoc && result.length > 0 && result[0] !== "\n") {
            result = result.replace(/^[ \t]*/, " ");
        }
        if (result.length > 0 && !result.endsWith("\n")) {
            // Scanned from the end: a `[ \t]*$` regex retries from every blank of a long run.
            let end = result.length;
            while (end > 0 && (result[end - 1] === " " || result[end - 1] === "\t")) end--;
            result = result.slice(0, end) + " ";
        }
        return `/*${result}*/`;
    }
    const innerTrimmed = inner.trim();
    if (innerTrimmed.length === 0) return "/* */";
    if (isDoc) {
        // Single-line doc comment: keep the `/**` opener, one space, then the body.
        const docBody = innerTrimmed.slice(1).trim();
        return docBody.length === 0 ? "/** */" : `/** ${docBody} */`;
    }
    return `/* ${innerTrimmed} */`;
}

/** Normalize a comment node's text, dispatching by delimiter. */
export function normalizeComment(text: string): string {
    const trimmed = text.trim();
    if (trimmed.startsWith("//")) return normalizeLineComment(trimmed);
    if (trimmed.startsWith("/*")) return normalizeBlockComment(trimmed);
    return trimmed;
}

/** WeiDU multi-tilde delimiter count (~~~~~...~~~~~). */
const WEIDU_MULTI_TILDE_COUNT = 5;

/** Result of scanning a WeiDU tilde-delimited string opener. */
export interface TildeDelimiter {
    /** Delimiter length: 1 for `~`, 5 for `~~~~~` (multi-tilde mode). */
    readonly delimLen: number;
    /** Index where the string content begins (just past the opening delimiter). */
    readonly contentStart: number;
    /** Index of the closing delimiter, or -1 if the string is unclosed. */
    readonly closerStart: number;
}

/**
 * Scan a WeiDU tilde-delimited string whose opening delimiter starts at `pos`
 * (which must point at a `~`). WeiDU recognizes only 1 or 5 tildes as delimiters:
 * 5+ consecutive tildes select multi-tilde mode (~~~~~...~~~~~), fewer select a
 * single-tilde string (so `~~` is an empty single-tilde string, not a delimiter).
 * Returns the delimiter length plus the content and closer positions; the caller
 * decides what to emit and how to advance, since the call sites diverge on what
 * they keep (delimiters, content, or a token) and on unclosed-string handling.
 */
export function scanTildeDelimiter(text: string, pos: number): TildeDelimiter {
    let i = pos;
    let tildeCount = 0;
    while (i < text.length && text[i] === "~") {
        tildeCount++;
        i++;
    }
    const delimLen = tildeCount >= WEIDU_MULTI_TILDE_COUNT ? WEIDU_MULTI_TILDE_COUNT : 1;
    const contentStart = pos + delimLen;
    const closerStart = text.indexOf("~".repeat(delimLen), contentStart);
    return { delimLen, contentStart, closerStart };
}

/**
 * The index just past a `%`-delimited .tra string opening at `pos` - which ends at the next `%`, as the grammar reads
 * it, so a `~` inside is content - or `text.length` when it never closes.
 */
export function scanPercentString(text: string, pos: number): number {
    const closer = text.indexOf("%", pos + 1);
    return closer === -1 ? text.length : closer + 1;
}

/**
 * The index just past a WeiDU block comment opening at `pos` (a `/*`), or `text.length` when it never closes.
 * WeiDU block comments nest, so a `/*` inside one opens a level that its own closer ends.
 */
export function scanNestedBlockComment(text: string, pos: number): number {
    let depth = 0;
    let i = pos;
    while (i < text.length) {
        if (text.startsWith("/*", i)) {
            depth++;
            i += 2;
        } else if (text.startsWith("*/", i)) {
            depth--;
            i += 2;
            if (depth === 0) return i;
        } else {
            i++;
        }
    }
    return text.length;
}

/** Digits an octal escape (`'\012'`) may carry after its `0`. */
const OCTAL_ESCAPE_MAX_DIGITS = 3;

/**
 * The index just past a Fallout SSL character constant (`'A'`, `'\n'`, `'\012'`) opening at `pos`, or -1 when none
 * starts there. A quote inside one (`'"'`) is a character, not the start of a string.
 */
function scanCharConstant(text: string, pos: number): number {
    let i = pos + 1;
    const first = text[i];
    if (first === undefined || first === "\n" || first === "'") return -1;
    if (first === "\\") {
        const escaped = text[i + 1];
        if (escaped === undefined || escaped === "\n") return -1;
        i += 2;
        if (escaped === "0") {
            for (let digits = 0; digits < OCTAL_ESCAPE_MAX_DIGITS && /[0-7]/.test(text[i] ?? ""); digits++) i++;
        }
    } else {
        i++;
    }
    return text[i] === "'" ? i + 1 : -1;
}

/**
 * A string's contents in a form validateFormatting's whitespace strip leaves alone: each whitespace character
 * becomes a visible `\u{..}` escape, so a space or tab changed inside a string reads as changed content. A `\r` is
 * dropped, since line endings are the formatter's to normalize.
 */
function protectStringWhitespace(s: string): string {
    return s.replaceAll("\r", "").replaceAll(/\s/g, (c) => `\\u{${c.codePointAt(0)!.toString(16)}}`);
}

/**
 * Shared comment-stripping implementation for Fallout SSL and WeiDU: drops comments, keeps string literals - with
 * their whitespace protected (see protectStringWhitespace) unless `protectStrings` is false.
 */
function stripCommentsCommon(
    text: string,
    weidu: boolean,
    protectStrings = true,
    mapCode: (code: string) => string = (code) => code,
): string {
    return tokenizeCode(text, weidu)
        .map((token) => {
            if (token.type === WeiduTokenType.Comment) return "";
            if (token.type === WeiduTokenType.Code) return mapCode(token.text);
            return protectStrings ? protectStringWhitespace(token.text) : token.text;
        })
        .join("");
}

/** The comments of `text` in source order, string aware, for a normalizer's `omitted` list. */
function commentsOf(text: string, weidu: boolean): string[] {
    return tokenizeCode(text, weidu)
        .filter((token) => token.type === WeiduTokenType.Comment)
        .map((token) => token.text);
}

/**
 * Strip comments from WeiDU text, respecting string literals; the comments are its `omitted` list.
 * Handles: ~string~, "string", ~~~~~string~~~~~, %string%
 */
export const stripCommentsWeidu: CompareNormalizer = withOmitted(
    (text) => stripCommentsCommon(text, true),
    (text) => commentsOf(text, true),
);

/**
 * As stripCommentsWeidu, for WeiDU D, leaving whitespace inside strings to validateFormatting's strip. A D string is
 * content in a SAY or REPLY and code in a trigger or action, which the D formatter reformats - indenting continuation
 * lines, spacing a `//` comment - and nothing lexical tells the two apart.
 */
export const stripCommentsWeiduD: CompareNormalizer = withOmitted(
    (text) => stripCommentsCommon(text, true, false),
    (text) => commentsOf(text, true),
);

/** WeiDU token types for formatting. */
export enum WeiduTokenType {
    Code,
    String,
    Comment,
}

/** WeiDU token for formatting. */
export interface WeiduToken {
    type: WeiduTokenType;
    text: string;
}

/**
 * Tokenize WeiDU text into code and literals (strings, comments).
 * Handles: ~string~, "string", %string%, ~~~~~string~~~~~, /* comments * /, // comments.
 * Properly handles // inside strings (e.g., URLs).
 */
export function tokenizeWeidu(text: string): WeiduToken[] {
    return tokenizeCode(text, true);
}

/**
 * Tokenize Fallout SSL text into code, `"..."` strings and comments. SSL has no tilde strings, and its `%` is the
 * modulo operator rather than a variable delimiter.
 */
export function tokenizeFalloutSsl(text: string): WeiduToken[] {
    return tokenizeCode(text, false);
}

/**
 * The one string/comment scanner behind both dialects. `weidu` adds tilde and percent strings, reads a backslash in a
 * `"` string as an ordinary character and nests block comments, as the WeiDU grammars do; SSL has backslash escapes,
 * flat block comments and character constants.
 */
function tokenizeCode(text: string, weidu: boolean): WeiduToken[] {
    const tokens: WeiduToken[] = [];
    let i = 0;
    let lastCodeStart = 0;

    const flushCode = (end: number) => {
        if (end > lastCodeStart) {
            tokens.push({
                type: WeiduTokenType.Code,
                text: text.slice(lastCodeStart, end),
            });
        }
    };

    // Track string delimiters to avoid matching // inside strings
    // Note: This simplified version handles strings as complete tokens
    // when first encountered, so we don't need to track state across iterations

    while (i < text.length) {
        // Tilde strings: WeiDU uses 1 tilde or 5 tildes as delimiters
        if (weidu && text[i] === "~") {
            const { delimLen, contentStart, closerStart } = scanTildeDelimiter(text, i);
            if (closerStart !== -1) {
                flushCode(i);
                tokens.push({
                    type: WeiduTokenType.String,
                    text: text.slice(i, closerStart + delimLen),
                });
                i = closerStart + delimLen;
                lastCodeStart = i;
            } else {
                // Unclosed: treat the consumed tildes as code.
                i = contentStart;
            }
            continue;
        }
        // Double-quoted strings
        if (text[i] === '"') {
            const start = i++;
            while (i < text.length && text[i] !== '"') {
                if (!weidu && text[i] === "\\") i++;
                i++;
            }
            if (i < text.length) i++;
            flushCode(start);
            tokens.push({
                type: WeiduTokenType.String,
                text: text.slice(start, i),
            });
            lastCodeStart = i;
            continue;
        }
        // Percent strings/variables
        if (weidu && text[i] === "%") {
            const start = i++;
            const end = text.indexOf("%", i);
            if (end !== -1) {
                flushCode(start);
                tokens.push({
                    type: WeiduTokenType.String,
                    text: text.slice(start, end + 1),
                });
                i = end + 1;
                lastCodeStart = i;
            }
            continue;
        }
        // Character constants: the quote in '"' opens no string
        if (!weidu && text[i] === "'") {
            const end = scanCharConstant(text, i);
            if (end !== -1) {
                flushCode(i);
                tokens.push({ type: WeiduTokenType.String, text: text.slice(i, end) });
                i = end;
                lastCodeStart = i;
                continue;
            }
        }
        // Block comments - check before line comments
        if (text[i] === "/" && text[i + 1] === "*") {
            const start = i;
            if (weidu) {
                i = scanNestedBlockComment(text, i);
            } else {
                const end = text.indexOf("*/", i + 2);
                i = end !== -1 ? end + 2 : text.length;
            }
            flushCode(start);
            tokens.push({
                type: WeiduTokenType.Comment,
                text: text.slice(start, i),
            });
            lastCodeStart = i;
            continue;
        }
        // Line comments - only if not in a string
        if (text[i] === "/" && text[i + 1] === "/") {
            const start = i;
            while (i < text.length && text[i] !== "\n") i++;
            flushCode(start);
            tokens.push({
                type: WeiduTokenType.Comment,
                text: text.slice(start, i),
            });
            lastCodeStart = i;
            continue;
        }
        i++;
    }
    flushCode(text.length);
    return tokens;
}

/** One item or comment of a list the formatter lays out line by line, with the source rows it spans. */
export interface RowPart {
    text: string;
    isItem: boolean;
    isLineComment: boolean;
    startRow: number;
    endRow: number;
}

/**
 * The lines of `head` followed by `parts`, one item to a line, comments kept where they were written. A comment stays
 * on the line of the part before it when it started on that source row, else gets a line of its own; a block comment on
 * the row of the item after it stays in front of that item. `headRow` is the source row `head` ends on. The first item
 * joins `head`'s line when `firstItemInline` says so. A line comment ends its line, so the last line may end in one:
 * the caller must not append to it.
 */
export function layoutRowParts(
    head: string,
    headRow: number,
    parts: readonly RowPart[],
    options: { firstItemInline: boolean; spaceAfterHead: boolean },
): string[] {
    const lines: string[] = [];
    let current = head;
    let previous: RowPart | undefined;
    let previousRow = headRow;
    for (const part of parts) {
        const sameRow = part.startRow === previousRow;
        const inline = part.isItem
            ? previous === undefined
                ? options.firstItemInline
                : !previous.isItem && sameRow
            : sameRow;
        if (inline) {
            current += (current === head && !options.spaceAfterHead ? "" : " ") + part.text;
        } else {
            lines.push(current);
            current = part.text;
        }
        previous = part;
        previousRow = part.endRow;
    }
    lines.push(current);
    return lines;
}

/** One piece of a construct written on a line: its text, and what separates it from the piece before. */
export interface Piece {
    text: string;
    /** Written between this piece and the one before it, when no comment lies between them. */
    sep: string;
    /** Where the piece starts when it follows a line comment; the `weave` indent when absent. */
    indent?: string;
}

/** A comment standing between two pieces in the source; a line comment ends its line. */
export interface WovenComment {
    comment: string;
    endsLine: boolean;
}

/** A piece, or the comment that stands between two pieces in the source. */
export type WovenItem = Piece | WovenComment;

/** The comment `node` as an item of {@link weave}. */
export function commentItem(node: SyntaxNode): WovenComment {
    return { comment: node.text, endsLine: node.type === LINE_COMMENT_NODE };
}

function isPiece(item: WovenItem): item is Piece {
    return "sep" in item;
}

/** A comment is written tight to an opener before it, and tight to a closer or separator after it. */
const OPENER_END = /[([{.]$/;
const CLOSER_START = /^[)\]},;]/;

/**
 * Joins the pieces of one construct and keeps each comment between them where it was written. A block comment stays
 * inline, one blank before and after it (none after an opener or before a closer). A line comment ends its line, so
 * the piece after it starts a new one at `indent`. A piece whose `sep` holds a line break keeps it after a block
 * comment. The first piece's `sep` is not written.
 */
export function weave(items: readonly WovenItem[], indent: string): string {
    let out = "";
    let afterComment = false;
    let lineEnded = false;
    for (const item of items) {
        if (isPiece(item)) {
            if (lineEnded) {
                out += "\n" + (item.indent ?? indent);
            } else if (out !== "") {
                const afterBlock = afterComment && !item.sep.includes("\n");
                out += afterBlock ? (CLOSER_START.test(item.text) ? "" : " ") : item.sep;
            }
            out += item.text;
            afterComment = false;
            lineEnded = false;
            continue;
        }
        if (lineEnded) out += "\n" + indent;
        else if (out !== "" && !OPENER_END.test(out)) out += " ";
        out += normalizeComment(item.comment);
        afterComment = true;
        lineEnded = item.endsLine;
    }
    return out;
}

/** `items` with `terminator` after the last piece, unless the last piece is it already. */
export function terminate(items: readonly WovenItem[], terminator: string): WovenItem[] {
    const lastPiece = items.findLastIndex((item) => isPiece(item));
    if (lastPiece !== -1 && (items[lastPiece] as Piece).text === terminator) return [...items];
    return [...items.slice(0, lastPiece + 1), { text: terminator, sep: "" }, ...items.slice(lastPiece + 1)];
}

/** The node types every grammar gives a line comment and a block comment. */
const LINE_COMMENT_NODE = "line_comment";
const COMMENT_NODE_TYPES = ["comment", LINE_COMMENT_NODE];

/** Whether a comment lies anywhere in `node`'s subtree. */
export function containsComment(node: SyntaxNode): boolean {
    return node.descendantsOfType(COMMENT_NODE_TYPES).length > 0;
}

/**
 * `children` as the items {@link weave} joins: the comments as they are, every other child as the piece `pieceOf`
 * makes of it, or dropped when `pieceOf` gives null (a token the caller writes some other way).
 */
export function itemsOf(children: readonly SyntaxNode[], pieceOf: (child: SyntaxNode) => Piece | null): WovenItem[] {
    return children.flatMap((child): WovenItem[] => {
        if (COMMENT_NODE_TYPES.includes(child.type)) return [commentItem(child)];
        const piece = pieceOf(child);
        return piece ? [piece] : [];
    });
}

/** A comment of a syntax tree: its words without blanks, and as the formatters write it. */
interface SourceComment {
    key: string;
    text: string;
    node: SyntaxNode;
}

/** The comments in `node`'s subtree, in source order. */
function sourceComments(node: SyntaxNode): SourceComment[] {
    return node
        .descendantsOfType(COMMENT_NODE_TYPES)
        .map((comment) => ({ key: unblank(comment.text), text: normalizeComment(comment.text), node: comment }));
}

/** Where a comment was written back by {@link restoreLostComments}: the comment's place in the tree. */
interface RescuedComment {
    line: number;
    column: number;
    parentType: string;
    rebuiltType: string;
}

/** The rescues of the format call in progress; undefined outside {@link reportRescuedComments}. */
let rescuedComments: RescuedComment[] | undefined;

/** Comments named in a rescue notice; the rest are counted. */
const RESCUE_WARNING_LISTED = 5;

/**
 * Runs `format`, a tree formatter, and adds one `notice` to its result when {@link restoreLostComments} wrote
 * comments back during the call, naming where they were. The text is still the formatted text with the comments
 * restored: the notice tells the user that a formatter path loses comments in that position and moved them. It is
 * not a `warning`, which means the formatter refused.
 */
export function reportRescuedComments(format: () => FormatOutput): FormatOutput {
    const outer = rescuedComments;
    const rescues: RescuedComment[] = [];
    rescuedComments = rescues;
    let result: FormatOutput;
    try {
        result = format();
    } finally {
        rescuedComments = outer;
    }
    if (rescues.length === 0) return result;
    const listed = rescues
        .slice(0, RESCUE_WARNING_LISTED)
        .map((r) => `line ${r.line}, column ${r.column} (comment in ${r.parentType}, rebuilt ${r.rebuiltType})`);
    const more = rescues.length > listed.length ? `, and ${rescues.length - listed.length} more` : "";
    const what = rescues.length === 1 ? "a comment was" : `${rescues.length} comments were`;
    return {
        ...result,
        notice: `${what} moved because the formatter would have dropped ${rescues.length === 1 ? "it" : "them"}: ${listed.join("; ")}${more}`,
    };
}

/**
 * `formatted`, the text a formatter wrote for `node`, with every comment of the node that it lacks put back. A
 * formatter that rebuilds a node from the children it picks loses each comment it did not pick; this writes them
 * back, so no path through it drops one. A lost comment goes on a line of its own above the line of the next comment
 * that survived, so the comments keep their order, or after the text when none follows. Comments are matched by their
 * words, blanks aside, in any order: one written in another place is not lost, and none is written twice.
 *
 * `indent` is the node's indentation; `firstLineIndented` says whether `formatted` starts with it or the caller adds
 * it, which decides how a comment above the first line is written. The caller must not append a comment to the last
 * line when it ends in a line comment.
 */
export function restoreLostComments(
    node: SyntaxNode,
    formatted: string,
    weidu: boolean,
    indent: string,
    firstLineIndented: boolean,
): string {
    const comments = sourceComments(node);
    if (comments.length === 0) return formatted;
    // A first line that carries its indentation is the truth about it: some callers indent a node's lines themselves.
    const nodeIndent = firstLineIndented ? (/^[ \t]*/.exec(formatted)?.[0] ?? "") : indent;

    const written: { key: string; offset: number }[] = [];
    // Where the strings and comments of the text are: a line may start inside one, and nothing goes there.
    const literals: { start: number; end: number }[] = [];
    let offset = 0;
    for (const token of tokenizeCode(formatted, weidu)) {
        if (token.type === WeiduTokenType.Comment) written.push({ key: unblank(token.text), offset });
        if (token.type !== WeiduTokenType.Code) literals.push({ start: offset, end: offset + token.text.length });
        offset += token.text.length;
    }

    // Pair each comment with a written one of the same words, in any order: a formatter may write comments in
    // another order than the source, which the content guard judges, and a comment that is written is not lost.
    // The ones with no written twin are lost.
    const match: (number | undefined)[] = [];
    const taken = new Set<number>();
    for (const comment of comments) {
        const found = written.findIndex((w, index) => !taken.has(index) && w.key === comment.key);
        if (found === -1) {
            match.push(undefined);
        } else {
            taken.add(found);
            match.push(found);
        }
    }
    if (match.every((m) => m !== undefined)) return formatted;

    // Where each lost comment goes: the start of the line holding the next surviving comment; after the last
    // survivor, the end; with no survivor at all, the start. A comment before or after a node is a sibling of it when
    // the text is read again, so it keeps its place, which a comment written inside it may not.
    const anySurvivor = match.some((m) => m !== undefined);
    const inserts: { at: number; text: string }[] = [];
    for (const [i, comment] of comments.entries()) {
        if (match[i] !== undefined) continue;
        // The offset of the comment this one goes above, if any.
        rescuedComments?.push({
            line: comment.node.startPosition.row + 1,
            column: comment.node.startPosition.column + 1,
            parentType: comment.node.parent?.type ?? "none",
            rebuiltType: node.type,
        });
        const survivor = match.slice(i + 1).find((m) => m !== undefined);
        const above = anySurvivor ? (survivor === undefined ? undefined : written[survivor]!.offset) : 0;
        if (above === undefined) {
            inserts.push({ at: formatted.length, text: "\n" + nodeIndent + comment.text });
            continue;
        }
        let lineStart = above === 0 ? 0 : formatted.lastIndexOf("\n", above - 1) + 1;
        // A line that starts inside a string or a block comment is not a place for a comment: go up to the line
        // the literal starts on.
        let inside = literals.find((l) => l.start < lineStart && lineStart < l.end);
        while (inside !== undefined) {
            lineStart = inside.start === 0 ? 0 : formatted.lastIndexOf("\n", inside.start - 1) + 1;
            const here = lineStart;
            inside = literals.find((l) => l.start < here && here < l.end);
        }
        if (lineStart === 0 && !firstLineIndented) {
            inserts.push({ at: 0, text: comment.text + "\n" + nodeIndent });
            continue;
        }
        let lineIndent = /^[ \t]*/.exec(formatted.slice(lineStart))?.[0] ?? "";
        // A survivor behind code on its line (`end // c`) says little about where a comment above it sits: the line
        // before it, deeper when a block closes here, does.
        if (formatted.slice(lineStart, above).trim() !== "" && lineStart > 0) {
            const previousStart = formatted.lastIndexOf("\n", lineStart - 2) + 1;
            const previousIndent = /^[ \t]*/.exec(formatted.slice(previousStart, lineStart))?.[0] ?? "";
            if (previousIndent.length > lineIndent.length) lineIndent = previousIndent;
        }
        inserts.push({ at: lineStart, text: lineIndent + comment.text + "\n" });
    }

    // Inserts at one place keep their source order: the sort is stable.
    inserts.sort((a, b) => a.at - b.at);
    let result = "";
    let from = 0;
    for (const insert of inserts) {
        result += formatted.slice(from, insert.at) + insert.text;
        from = insert.at;
    }
    return result + formatted.slice(from);
}

/**
 * Index of the `//` that opens a line comment in WeiDU `line`, or -1. A `//` inside a string (a URL in `~...~`)
 * or inside a block comment is not one, so a line is scanned token by token rather than for the substring.
 */
export function weiduLineCommentStart(line: string): number {
    return lineCommentStart(tokenizeWeidu(line));
}

/** {@link weiduLineCommentStart} for Fallout SSL, whose only strings are `"..."`. */
export function falloutSslLineCommentStart(line: string): number {
    return lineCommentStart(tokenizeFalloutSsl(line));
}

function lineCommentStart(tokens: readonly WeiduToken[]): number {
    let offset = 0;
    for (const token of tokens) {
        if (token.type === WeiduTokenType.Comment && token.text.startsWith("//")) return offset;
        offset += token.text.length;
    }
    return -1;
}

/** Whether WeiDU `line` already carries a line comment, so another cannot be appended to it. */
export function hasWeiduLineComment(line: string): boolean {
    return weiduLineCommentStart(line) !== -1;
}

/**
 * Normalizes whitespace in WeiDU text while preserving strings and comments.
 * Collapses multiple spaces into one, trims outer whitespace.
 *
 * Important: line-based formatters must never split string/comment tokens by newlines.
 */
export function normalizeWhitespaceWeidu(text: string): string {
    const tokens = tokenizeWeidu(text);
    const parts: string[] = [];

    for (const token of tokens) {
        if (token.type === WeiduTokenType.Code) {
            // Collapse whitespace in code parts
            const normalized = token.text.replaceAll(/\s+/g, " ");
            parts.push(normalized);
        } else {
            // Preserve strings and comments exactly
            parts.push(token.text);
        }
    }

    // Join parts directly (no separator) - whitespace is already in Code tokens
    return parts.join("").trim();
}

/**
 * Strip comments from Fallout SSL text, respecting string literals and character constants; the comments are its
 * `omitted` list. `mapCode` rewrites the stretches between strings and comments (the tokenizer's code tokens).
 * Handles: "string" only
 */
export function stripCommentsFalloutSslWith(text: string, mapCode: (code: string) => string): string {
    return stripCommentsCommon(text, false, true, mapCode);
}

/** The comments of Fallout SSL `text` in source order: the `omitted` list of every SSL normalizer. */
export function commentsFalloutSsl(text: string): string[] {
    return commentsOf(text, false);
}

export const stripCommentsFalloutSsl: CompareNormalizer = withOmitted(
    (text) => stripCommentsCommon(text, false),
    commentsFalloutSsl,
);

/**
 * Strip comments and string delimiters from WeiDU .tra translation text.
 * Removes:
 *   - Line comments (`// ...`) and block comments (`/* ... *\/`)
 *   - Tilde string delimiters: ~content~ emits content; ~~~~~content~~~~~ emits content
 *   - Double-quote delimiters: "content" emits content (a backslash is an ordinary character, as in the grammar)
 *   - Percent delimiters: %content% emits content
 *   - `[SOUNDFILE]` sound references (structural metadata)
 * Keeps entry numbers, `@`, and `=` signs so validateFormatting can compare tokens. Block comments nest, as in the
 * grammar. The comments are the `omitted` list of stripCommentsTra.
 */
function scanTra(text: string): { code: string; comments: string[] } {
    let result = "";
    const comments: string[] = [];
    let i = 0;
    while (i < text.length) {
        // Block comments
        if (text[i] === "/" && text[i + 1] === "*") {
            const end = scanNestedBlockComment(text, i);
            comments.push(text.slice(i, end));
            i = end;
            continue;
        }
        // Line comments
        if (text[i] === "/" && text[i + 1] === "/") {
            const start = i;
            while (i < text.length && text[i] !== "\n") i++;
            comments.push(text.slice(start, i));
            continue;
        }
        // Tilde strings: strip delimiters, keep content
        if (text[i] === "~") {
            const { delimLen, contentStart, closerStart } = scanTildeDelimiter(text, i);
            const contentEnd = closerStart !== -1 ? closerStart : text.length;
            // Emit the content without delimiters
            result += protectStringWhitespace(text.slice(contentStart, contentEnd));
            i = closerStart !== -1 ? closerStart + delimLen : text.length;
            continue;
        }
        // Double-quoted strings: strip delimiters, keep content
        if (text[i] === '"') {
            const contentStart = ++i; // skip opening "
            const close = text.indexOf('"', i);
            i = close === -1 ? text.length : close;
            result += protectStringWhitespace(text.slice(contentStart, i));
            if (i < text.length) i++; // skip closing "
            continue;
        }
        // Percent strings: strip delimiters, keep content
        if (text[i] === "%") {
            const end = scanPercentString(text, i);
            const contentEnd = text[end - 1] === "%" && end - 1 > i ? end - 1 : end;
            result += protectStringWhitespace(text.slice(i + 1, contentEnd));
            i = end;
            continue;
        }
        // Sound references [SOUNDFILE] - remove entirely
        if (text[i] === "[") {
            const end = text.indexOf("]", i + 1);
            if (end !== -1) {
                i = end + 1;
                continue;
            }
        }
        result += text[i++];
    }
    return { code: result, comments };
}

export const stripCommentsTra: CompareNormalizer = withOmitted(
    (text) => scanTra(text).code,
    (text) => scanTra(text).comments,
);

/** Every group of a .msg file is read as the engine reads it; the first of each three is a number, the second audio. */
export const MSG_GROUPS_PER_ENTRY = 3;
const MSG_NUMBER_GROUP = 0;
export const MSG_AUDIO_GROUP = 1;

function scanMsg(text: string): { code: string; omitted: string[] } {
    let code = "";
    const omitted: string[] = [];
    let groups = 0;
    let i = 0;
    while (i < text.length) {
        if (text[i] !== "{") {
            // Between groups: a note. Tagged with the number of groups before it, so moving it past an entry shows.
            const next = text.indexOf("{", i);
            const end = next === -1 ? text.length : next;
            const note = text.slice(i, end).trim();
            if (note !== "") omitted.push(`note ${groups}: ${note}`);
            i = end;
            continue;
        }
        // A group runs from `{` to the next `}` (or the end of the file), newlines included.
        const close = text.indexOf("}", i + 1);
        const end = close === -1 ? text.length : close;
        const field = text.slice(i + 1, end);
        const kind = groups % MSG_GROUPS_PER_ENTRY;
        if (kind === MSG_NUMBER_GROUP) {
            code += field.trim();
        } else if (kind === MSG_AUDIO_GROUP) {
            omitted.push(`audio ${groups}: ${field.trim()}`);
        } else {
            code += ` ${protectStringWhitespace(field)}`;
        }
        groups++;
        i = close === -1 ? text.length : close + 1;
    }
    return { code, omitted };
}

/**
 * Strip the notes and the audio names from Fallout .msg text, reading it as the engine does: a run of brace groups,
 * three to an entry (number, audio, text), each from a `{` to the next `}`, with whatever lies between them a note.
 * A group may start anywhere on a line. Emits the numbers and the text groups; the notes and the trimmed audio names
 * are the `omitted` list, so a formatter may trim an audio name but not change it.
 */
export const stripCommentsFalloutMsg: CompareNormalizer = withOmitted(
    (text) => scanMsg(text).code,
    (text) => scanMsg(text).omitted,
);

/**
 * Pass-through stripper for Infinity Engine 2DA files.
 * 2DA files have no comment syntax, so nothing needs stripping.
 * validateFormatting compares the full token stream, which is correct for 2DA.
 */
export function stripComments2da(text: string): string {
    return text;
}

/**
 * Strip comments from Fallout scripts.lst text for formatting validation.
 * The scripts.lst formatter only rearranges whitespace between columns without
 * removing any text content, so no stripping is needed - all non-whitespace
 * tokens are preserved exactly.
 */
export function stripCommentsFalloutScriptsLst(text: string): string {
    return text;
}

/**
 * Validate that formatting only changed whitespace, not content.
 * Returns error message if content changed, null if OK.
 * @param normalizeForCompare Language-specific reduction to comparable content
 */
export function validateFormatting(
    original: string,
    formatted: string,
    normalizeForCompare: CompareNormalizer,
): string | null {
    const normalize = (text: string) => unblank(normalizeForCompare(text));
    const normalizedOriginal = normalize(original);
    const normalizedFormatted = normalize(formatted);

    if (normalizedOriginal === normalizedFormatted)
        return firstOmittedDifference(original, formatted, normalizeForCompare);

    // Find first difference for debugging
    const minLen = Math.min(normalizedOriginal.length, normalizedFormatted.length);
    let diffPos = 0;
    while (diffPos < minLen && normalizedOriginal[diffPos] === normalizedFormatted[diffPos]) {
        diffPos++;
    }
    const context = 20;
    const origSnippet = normalizedOriginal.slice(Math.max(0, diffPos - context), diffPos + context);
    const fmtSnippet = normalizedFormatted.slice(Math.max(0, diffPos - context), diffPos + context);
    // Each caller says who is reporting and what it did about it, so the message itself states only
    // what differed.
    return `content changed at position ${diffPos}: "${origSnippet}" vs "${fmtSnippet}"`;
}

const unblank = (text: string): string => text.replaceAll(/\s+/g, "");

/** How much of a changed comment the message quotes. */
const OMITTED_SNIPPET = 60;

/**
 * The message for the first comment (or note) that differs between the two texts, or null when they match. Compared
 * word for word, in order, ignoring blanks: blanks are all a formatter may change in one (the edge blanks of a block
 * comment, the trailing blanks of a line comment).
 */
function firstOmittedDifference(original: string, formatted: string, normalizer: CompareNormalizer): string | null {
    const omit = (text: string) => (normalizer.omitted?.(text) ?? []).map((item) => unblank(item));
    const before = omit(original);
    const after = omit(formatted);
    const show = (item: string | undefined) =>
        item === undefined ? "(none)" : JSON.stringify(item.slice(0, OMITTED_SNIPPET));
    for (let i = 0; i < Math.max(before.length, after.length); i++) {
        if (before[i] !== after[i]) return `comment or note ${i + 1} changed: ${show(before[i])} vs ${show(after[i])}`;
    }
    return null;
}
