/**
 * Shared formatting utilities.
 */

import type { Node as SyntaxNode } from "web-tree-sitter";

/** Library-shape formatter output. Wrappers convert to LSP TextEdit[] at the LSP boundary. */
export interface FormatOutput {
    text: string;
    warning?: string;
}

/** Strips a leading UTF-8 BOM (\uFEFF) from text if present. */
export function stripBom(text: string): string {
    return text.startsWith("\uFEFF") ? text.slice(1) : text;
}

/** Function that strips comments from text while respecting string literals. */
export type CommentStripper = (text: string) => string;

/** Find first ERROR or MISSING node in tree. */
function findParseError(node: SyntaxNode): SyntaxNode | null {
    if (node.type === "ERROR" || node.isMissing) {
        return node;
    }
    for (const child of node.children) {
        const error = findParseError(child);
        if (error) return error;
    }
    return null;
}

/**
 * Throw if the tree contains any ERROR or MISSING nodes.
 * Call at the top of every formatDocument() to prevent formatting malformed input.
 */
export function throwOnParseError(root: SyntaxNode): void {
    const node = findParseError(root);
    if (node) {
        const { row, column } = node.startPosition;
        const kind = node.isMissing ? "MISSING" : "ERROR";
        throw new Error(`${row + 1}:${column + 1}: Parse ${kind}`);
    }
}

/** WeiDU multi-tilde delimiter count (~~~~~...~~~~~). */
const WEIDU_MULTI_TILDE_COUNT = 5;

/**
 * Options for stripCommentsCommon.
 * When handleTildeStrings is true, tilde-delimited WeiDU string literals are
 * preserved before the shared double-quote / comment handling runs.
 */
interface StripCommentsOptions {
    readonly handleTildeStrings: boolean;
}

/**
 * Shared comment-stripping implementation for Fallout SSL and WeiDU.
 * Preserves double-quoted string literals and optionally tilde-delimited
 * WeiDU string literals (~...~ and ~~~~~...~~~~~).
 * Removes line comments (//) and block comments.
 */
function stripCommentsCommon(text: string, options: StripCommentsOptions): string {
    let result = "";
    let i = 0;
    while (i < text.length) {
        // Tilde strings: WeiDU uses 1 tilde or 5 tildes as delimiters
        // ~content~ or ~~~~~content~~~~~
        if (options.handleTildeStrings && text[i] === "~") {
            const start = i;
            let tildeCount = 0;
            while (i < text.length && text[i] === "~") {
                tildeCount++;
                i++;
            }
            // WeiDU only recognizes 1 or 5 tildes as delimiters
            // If we see ~~, it's ~~ = ~ + empty + ~ (two single-tilde strings)
            // If we see ~~~, it's ~ + ~ + ~ (single tilde delimiters)
            // Only 5+ consecutive tildes use multi-tilde mode
            const delimiterCount = tildeCount >= WEIDU_MULTI_TILDE_COUNT ? WEIDU_MULTI_TILDE_COUNT : 1;
            // Rewind: we consumed all tildes but may need to re-parse some
            i = start + delimiterCount;
            result += text.slice(start, i);
            // Find matching closing tildes
            const closer = "~".repeat(delimiterCount);
            const end = text.indexOf(closer, i);
            if (end !== -1) {
                result += text.slice(i, end + delimiterCount);
                i = end + delimiterCount;
            }
            continue;
        }
        // Double-quoted strings
        if (text[i] === '"') {
            const start = i++;
            while (i < text.length && text[i] !== '"') {
                if (text[i] === "\\") i++; // Skip escaped char
                i++;
            }
            result += text.slice(start, ++i);
            continue;
        }
        // Block comments
        if (text[i] === "/" && text[i + 1] === "*") {
            const end = text.indexOf("*/", i + 2);
            i = end !== -1 ? end + 2 : text.length;
            continue;
        }
        // Line comments
        if (text[i] === "/" && text[i + 1] === "/") {
            while (i < text.length && text[i] !== "\n") i++;
            continue;
        }
        result += text[i++];
    }
    return result;
}

/**
 * Strip comments from WeiDU text, respecting string literals.
 * Handles: ~string~, "string", ~~~~~string~~~~~
 */
export function stripCommentsWeidu(text: string): string {
    return stripCommentsCommon(text, { handleTildeStrings: true });
}

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
        if (text[i] === "~") {
            const start = i;
            let tildeCount = 0;
            while (i < text.length && text[i] === "~") {
                tildeCount++;
                i++;
            }
            const delimiterCount = tildeCount >= WEIDU_MULTI_TILDE_COUNT ? WEIDU_MULTI_TILDE_COUNT : 1;
            i = start + delimiterCount;
            const closer = "~".repeat(delimiterCount);
            const end = text.indexOf(closer, i);
            if (end !== -1) {
                flushCode(start);
                tokens.push({
                    type: WeiduTokenType.String,
                    text: text.slice(start, end + delimiterCount),
                });
                i = end + delimiterCount;
                lastCodeStart = i;
            }
            continue;
        }
        // Double-quoted strings
        if (text[i] === '"') {
            const start = i++;
            while (i < text.length && text[i] !== '"') {
                if (text[i] === "\\") i++;
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
        if (text[i] === "%") {
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
        // Block comments - check before line comments
        if (text[i] === "/" && text[i + 1] === "*") {
            const start = i;
            const end = text.indexOf("*/", i + 2);
            i = end !== -1 ? end + 2 : text.length;
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
            const normalized = token.text.replace(/\s+/g, " ");
            parts.push(normalized);
        } else {
            // Preserve strings and comments exactly
            parts.push(token.text);
        }
    }

    // Join parts directly (no separator) — whitespace is already in Code tokens
    return parts.join("").trim();
}

/**
 * Strip comments from Fallout SSL text, respecting string literals.
 * Handles: "string" only
 */
export function stripCommentsFalloutSsl(text: string): string {
    return stripCommentsCommon(text, { handleTildeStrings: false });
}

/**
 * Strip comments and string delimiters from WeiDU .tra translation text.
 * Removes:
 *   - Line comments (`// ...`) and block comments (`/* ... *\/`)
 *   - Tilde string delimiters: ~content~ emits content; ~~~~~content~~~~~ emits content
 *   - Double-quote delimiters: "content" emits content (handles backslash escapes)
 *   - `[SOUNDFILE]` sound references (structural metadata)
 * Keeps entry numbers, `@`, and `=` signs so validateFormatting can compare tokens.
 */
export function stripCommentsTra(text: string): string {
    let result = "";
    let i = 0;
    while (i < text.length) {
        // Block comments
        if (text[i] === "/" && text[i + 1] === "*") {
            const end = text.indexOf("*/", i + 2);
            i = end !== -1 ? end + 2 : text.length;
            continue;
        }
        // Line comments
        if (text[i] === "/" && text[i + 1] === "/") {
            while (i < text.length && text[i] !== "\n") i++;
            continue;
        }
        // Tilde strings: strip delimiters, keep content
        if (text[i] === "~") {
            const start = i;
            let tildeCount = 0;
            while (i < text.length && text[i] === "~") {
                tildeCount++;
                i++;
            }
            const delimLen = tildeCount >= WEIDU_MULTI_TILDE_COUNT ? WEIDU_MULTI_TILDE_COUNT : 1;
            // Rewind to just after the opening delimiter
            i = start + delimLen;
            const closer = "~".repeat(delimLen);
            const end = text.indexOf(closer, i);
            const contentEnd = end !== -1 ? end : text.length;
            // Emit the content without delimiters
            result += text.slice(i, contentEnd);
            i = end !== -1 ? end + delimLen : text.length;
            continue;
        }
        // Double-quoted strings: strip delimiters, keep content (handle escapes)
        if (text[i] === '"') {
            i++; // skip opening "
            while (i < text.length && text[i] !== '"') {
                if (text[i] === "\\") {
                    // Emit the escape sequence verbatim
                    result += text[i];
                    i++;
                    if (i < text.length) {
                        result += text[i++];
                    }
                    continue;
                }
                result += text[i++];
            }
            if (i < text.length) i++; // skip closing "
            continue;
        }
        // Sound references [SOUNDFILE] — remove entirely
        if (text[i] === "[") {
            const end = text.indexOf("]", i + 1);
            if (end !== -1) {
                i = end + 1;
                continue;
            }
        }
        result += text[i++];
    }
    return result;
}

/**
 * Strip comment lines and structural braces from Fallout .msg text.
 * Removes:
 *   - Lines that do not start with `{` (they are comment lines in .msg format)
 *   - Braces themselves from entry lines `{number}{audio}{text}`
 *   - The audio field content
 * Keeps entry numbers and text content so validateFormatting can compare tokens.
 */
export function stripCommentsFalloutMsg(text: string): string {
    if (text.length === 0) return "";
    let result = "";
    let i = 0;
    while (i < text.length) {
        // Skip blank lines
        if (text[i] === "\n") {
            result += "\n";
            i++;
            continue;
        }
        // Entry line: starts with {
        if (text[i] === "{") {
            // Group 1: number — emit number, skip braces
            i++; // skip {
            const numStart = i;
            while (i < text.length && text[i] !== "}") i++;
            result += text.slice(numStart, i).trim();
            if (i < text.length) i++; // skip }

            // Group 2: audio — skip entirely
            if (i < text.length && text[i] === "{") {
                i++; // skip {
                while (i < text.length && text[i] !== "}") i++;
                if (i < text.length) i++; // skip }
            }

            // Group 3: text — emit content, skip braces
            if (i < text.length && text[i] === "{") {
                i++; // skip {
                const textStart = i;
                while (i < text.length && text[i] !== "}") i++;
                result += " ";
                result += text.slice(textStart, i);
                if (i < text.length) i++; // skip }
            }

            // Advance past remainder of line
            while (i < text.length && text[i] !== "\n") i++;
            if (i < text.length) {
                result += "\n";
                i++; // skip \n
            }
            continue;
        }
        // Comment line: skip to end of line
        while (i < text.length && text[i] !== "\n") i++;
        if (i < text.length) {
            i++; // skip \n
        }
    }
    return result;
}

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
 * removing any text content, so no stripping is needed — all non-whitespace
 * tokens are preserved exactly.
 */
export function stripCommentsFalloutScriptsLst(text: string): string {
    return text;
}

/**
 * Validate that formatting only changed whitespace, not content.
 * Returns error message if content changed, null if OK.
 * @param stripComments Language-specific function to strip comments while respecting strings
 */
export function validateFormatting(original: string, formatted: string, stripComments: CommentStripper): string | null {
    const normalize = (text: string) => stripComments(text).replace(/\s+/g, "");
    const normalizedOriginal = normalize(original);
    const normalizedFormatted = normalize(formatted);

    if (normalizedOriginal !== normalizedFormatted) {
        // Find first difference for debugging
        const minLen = Math.min(normalizedOriginal.length, normalizedFormatted.length);
        let diffPos = 0;
        while (diffPos < minLen && normalizedOriginal[diffPos] === normalizedFormatted[diffPos]) {
            diffPos++;
        }
        const context = 20;
        const origSnippet = normalizedOriginal.slice(Math.max(0, diffPos - context), diffPos + context);
        const fmtSnippet = normalizedFormatted.slice(Math.max(0, diffPos - context), diffPos + context);
        return `Formatter changed content at position ${diffPos}: "${origSnippet}" vs "${fmtSnippet}"`;
    }
    return null;
}
