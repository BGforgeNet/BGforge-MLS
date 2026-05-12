/**
 * Menu file Lua extraction and offset mapping.
 *
 * .menu files mix two forms of Lua:
 * - raw Lua preambles delimited by a line containing only `
 * - embedded Lua expressions / callbacks stored in quoted fields
 */

import type { NormalizedUri } from "./normalized-uri";

export type EmbeddedLuaSegmentKind = "statement" | "expression";

/** Represents a Lua segment extracted from a .menu file with offset mapping. */
export interface EmbeddedLuaSegment {
    /** The Lua source code without synthetic wrappers. */
    lua: string;
    /** Whether the segment is a statement block or an expression. */
    kind: EmbeddedLuaSegmentKind;
    /** 1-based line number in the original file where this segment starts. */
    sourceLineStart: number;
    /** 1-based line number in the original file where this segment ends (inclusive). */
    sourceLineEnd: number;
    /** URI of the original .menu file. */
    sourceUri: NormalizedUri;
}

const RAW_LUA_DELIMITER = "`";
const STATEMENT_FIELDS = /^(?:action|on\s+escape|onopen|onclose)\b/i;
const EXPRESSION_FIELDS = /^(?:enabled|clickable)\b/i;

function compileSegmentText(segment: EmbeddedLuaSegment): { text: string; lineOffset: number } {
    if (segment.kind !== "expression") {
        return { text: segment.lua, lineOffset: 0 };
    }

    if (segment.lua.includes("\n")) {
        return { text: `return (\n${segment.lua}\n)`, lineOffset: 1 };
    }

    return { text: `return (${segment.lua})`, lineOffset: 0 };
}

function pushSegment(
    segments: EmbeddedLuaSegment[],
    sourceUri: NormalizedUri,
    kind: EmbeddedLuaSegmentKind,
    sourceLineStart: number,
    sourceLineEnd: number,
    luaLines: string[],
): void {
    const lua = luaLines.join("\n").trim();
    if (lua.length === 0) {
        return;
    }

    segments.push({
        lua,
        kind,
        sourceLineStart,
        sourceLineEnd,
        sourceUri,
    });
}

function getEmbeddedFieldKind(line: string): EmbeddedLuaSegmentKind | null {
    const trimmed = line.trim();
    if (trimmed.length === 0) {
        return null;
    }

    if (STATEMENT_FIELDS.test(trimmed)) {
        return "statement";
    }

    if (EXPRESSION_FIELDS.test(trimmed) || /\blua\b/i.test(trimmed)) {
        return "expression";
    }

    return null;
}

function extractInlineQuotedContent(line: string): string | null {
    const firstQuote = line.indexOf('"');
    if (firstQuote === -1) {
        return null;
    }

    const lastQuote = line.lastIndexOf('"');
    if (lastQuote <= firstQuote) {
        return null;
    }

    return line.slice(firstQuote + 1, lastQuote);
}

/**
 * Extract Lua segments from .menu file content.
 *
 * The parser recognizes:
 * - raw Lua blocks surrounded by lines containing only `
 * - quoted statement blocks such as `action` / `onopen` / `onclose`
 * - quoted expression blocks such as `enabled`, `clickable`, and `... lua`
 */
export function extractLuaSegments(content: string, sourceUri: NormalizedUri): EmbeddedLuaSegment[] {
    const segments: EmbeddedLuaSegment[] = [];
    const lines = content.split(/\r?\n/);

    let insideRawLua = false;
    let rawBlockStartLine = 0;
    let rawLines: string[] = [];

    let pendingKind: EmbeddedLuaSegmentKind | null = null;
    let quotedKind: EmbeddedLuaSegmentKind | null = null;
    let quotedStartLine = 0;
    let quotedLines: string[] = [];

    for (let index = 0; index < lines.length; index += 1) {
        const lineNumber = index + 1;
        const line = lines[index] ?? "";
        const trimmed = line.trim();

        if (trimmed === RAW_LUA_DELIMITER) {
            if (insideRawLua) {
                pushSegment(segments, sourceUri, "statement", rawBlockStartLine, lineNumber - 1, rawLines);
                rawLines = [];
                insideRawLua = false;
            } else {
                insideRawLua = true;
                rawBlockStartLine = lineNumber + 1;
            }

            pendingKind = null;
            quotedKind = null;
            quotedLines = [];
            continue;
        }

        if (insideRawLua) {
            rawLines.push(line);
            continue;
        }

        if (quotedKind) {
            if (trimmed === '"') {
                pushSegment(segments, sourceUri, quotedKind, quotedStartLine, lineNumber - 1, quotedLines);
                quotedKind = null;
                quotedLines = [];
            } else {
                quotedLines.push(line);
            }
            continue;
        }

        if (pendingKind) {
            if (trimmed === '"') {
                quotedKind = pendingKind;
                quotedStartLine = lineNumber + 1;
                quotedLines = [];
                pendingKind = null;
            } else if (trimmed.length > 0) {
                pendingKind = null;
            }
            continue;
        }

        const fieldKind = getEmbeddedFieldKind(line);
        if (!fieldKind) {
            continue;
        }

        const inlineContent = extractInlineQuotedContent(line);
        if (inlineContent !== null) {
            pushSegment(segments, sourceUri, fieldKind, lineNumber, lineNumber, [inlineContent]);
            continue;
        }
        pendingKind = fieldKind;
    }

    if (insideRawLua) {
        pushSegment(segments, sourceUri, "statement", rawBlockStartLine, lines.length, rawLines);
    }

    return segments;
}

/** Build the text that should be compiled for a segment, including wrappers for expressions. */
export function buildCompiledLuaText(segment: EmbeddedLuaSegment): { text: string; lineOffset: number } {
    return compileSegmentText(segment);
}

/**
 * Map a line number in the compiled Lua (1-based) to the original .menu file (1-based).
 */
export function mapLuaLineToSource(luaLine: number, segment: EmbeddedLuaSegment): number {
    const { lineOffset } = compileSegmentText(segment);
    const mappedLine = segment.sourceLineStart + (luaLine - 1 - lineOffset);
    return Math.max(segment.sourceLineStart, Math.min(segment.sourceLineEnd, mappedLine));
}
