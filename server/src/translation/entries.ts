/**
 * Translation entry parsing and per-entry index lookups.
 * Turns raw `.tra`/`.msg` text into the `TraEntries` map keyed by entry id, and provides the
 * small pure lookups (line key extraction, position-to-entry, consumer-extension mapping) used
 * by the loader and LSP feature surface. No shared mutable state - every function here is pure
 * over its arguments.
 */

import type { Hover, Position } from "vscode-languageserver/node";
import { CONSUMER_EXTENSIONS_MSG, CONSUMER_EXTENSIONS_TRA } from "../core/languages";
import { REGEX_MSG_HOVER, REGEX_TRANSPILER_TRA_HOVER } from "../core/patterns";

export interface TraEntry {
    source: string;
    hover: Hover;
    inlay: string;
    inlayTooltip?: string;
    /** 0-based line number of this entry in the translation file */
    line: number;
    /** 0-based character offset within the line */
    character: number;
    /** 0-based end line of the full match (accounts for multiline values) */
    endLine: number;
    /** 0-based end character offset within the end line */
    endCharacter: number;
}

/** Single file: index => entry */
export interface TraEntries extends Map<string, TraEntry> {}
/** Relative file: path => entries */
export interface TraData extends Map<string, TraEntries> {}

export type TraExt = "msg" | "tra";

function stringToInlay(text: string): string {
    let line = text.replaceAll("\r", "");
    line = line.replaceAll("\n", "\\n");
    // Escape */ to prevent breaking the inlay comment syntax
    line = line.replaceAll("*/", "*\\/");
    if (line.length > 30) {
        line = line.slice(0, 27) + "...";
    }
    return `/* ${line} */`;
}

/** Parses text and returns a map of index => entry */
export function parseEntries(text: string, traType: TraExt): TraEntries {
    let regex: RegExp;
    if (traType === "tra") {
        regex = /@(\d+)\s*=\s*~([^~]*)~/gm;
    } else {
        regex = /{(\d+)}\s*{\w*}\s*{([^}]*)}/gm;
    }
    const entries: TraEntries = new Map();
    let currentLine = 0;
    let lineStartIndex = 0;
    let match = regex.exec(text);
    while (match !== null) {
        if (match.index === regex.lastIndex) {
            regex.lastIndex++;
        }
        const num = match[1];
        const str = match[2];
        // Check undefined only -- empty string is a valid translation entry (e.g., @0 = ~~)
        if (num === undefined || str === undefined) {
            match = regex.exec(text);
            continue;
        }

        // Track line/character position by scanning newlines up to match start.
        // This loop and the end-position loop below scan disjoint ranges
        // (lineStartIndex..match.index and match.index..matchEnd) so newlines
        // are never double-counted, even for multiline values.
        for (let i = lineStartIndex; i < match.index; i++) {
            if (text[i] === "\n") {
                currentLine++;
                lineStartIndex = i + 1;
            }
        }
        const startLine = currentLine;
        const character = match.index - lineStartIndex;

        // Compute end position by scanning newlines through the full match.
        // This also advances currentLine/lineStartIndex past multiline values
        // so the next iteration starts from the correct position.
        const matchEnd = match.index + match[0].length;
        for (let i = match.index; i < matchEnd; i++) {
            if (text[i] === "\n") {
                currentLine++;
                lineStartIndex = i + 1;
            }
        }
        const endLine = currentLine;
        const endCharacter = matchEnd - lineStartIndex;

        const hover: Hover = {
            contents: {
                kind: "markdown",
                value: `\`\`\`bgforge-mls-string\n${str}\n\`\`\``,
            },
        };
        const inlay = stringToInlay(str);

        const entry: TraEntry = {
            source: str,
            hover,
            inlay,
            line: startLine,
            character,
            endLine,
            endCharacter,
        };
        if (`/* ${str} */` !== inlay) {
            entry.inlayTooltip = str;
        }
        entries.set(num, entry);
        match = regex.exec(text);
    }
    return entries;
}

export function getLineKey(word: string, ext: TraExt): string | undefined {
    if (ext === "msg") {
        const match = REGEX_MSG_HOVER.exec(word);
        if (match) {
            return match[2];
        }
    }
    if (ext === "tra") {
        // Check for transpiler tra(123) format (TBAF/TD)
        const traMatch = REGEX_TRANSPILER_TRA_HOVER.exec(word);
        if (traMatch) {
            return traMatch[1];
        }
        // Standard @123 format
        return word.substring(1);
    }
    return undefined;
}

/**
 * Find which entry number the cursor is on in a tra/msg file.
 * Matches both the entry number/header and the value span (including multiline).
 */
export function entryAtPosition(entries: TraEntries, position: Position): string | undefined {
    for (const [num, entry] of entries) {
        // Check if position falls within this entry's range (start to end, inclusive)
        if (position.line < entry.line) continue;
        if (position.line > entry.endLine) continue;
        if (position.line === entry.line && position.character < entry.character) continue;
        if (position.line === entry.endLine && position.character > entry.endCharacter) continue;
        return num;
    }
    return undefined;
}

/**
 * Map a consumer file extension to its corresponding translation extension.
 * Derived from CONSUMER_EXTENSIONS_TRA/MSG to maintain a single source of truth.
 */
export function consumerExtToTraExt(ext: string): TraExt | undefined {
    const bare = ext.startsWith(".") ? ext.slice(1).toLowerCase() : ext.toLowerCase();
    if (CONSUMER_EXTENSIONS_TRA.includes(bare as (typeof CONSUMER_EXTENSIONS_TRA)[number])) {
        return "tra";
    }
    if (CONSUMER_EXTENSIONS_MSG.includes(bare as (typeof CONSUMER_EXTENSIONS_MSG)[number])) {
        return "msg";
    }
    return undefined;
}
