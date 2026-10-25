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
import { stringPreview } from "../shared/string-preview";
import { readMsgEntries, readTraEntries } from "./entry-readers";

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

/** The offsets at which each line of `text` starts, for turning an offset into a line and a character. */
function lineStarts(text: string): number[] {
    const starts = [0];
    for (let i = text.indexOf("\n"); i !== -1; i = text.indexOf("\n", i + 1)) starts.push(i + 1);
    return starts;
}

/** The 0-based line holding `offset`: the last line that starts at or before it. */
function lineOf(starts: readonly number[], offset: number): number {
    let low = 0;
    let high = starts.length - 1;
    while (low < high) {
        const mid = (low + high + 1) >> 1;
        if ((starts[mid] ?? 0) <= offset) low = mid;
        else high = mid - 1;
    }
    return low;
}

/**
 * Parses text and returns a map of index => entry. A `.tra` file is read as the installer reads it and a
 * `.msg` file as the game loads it (see entry-readers.ts), so what is indexed is what the game would see. Where
 * two entries share a number the last one wins, as in the game.
 */
export function parseEntries(text: string, traType: TraExt): TraEntries {
    const raw = traType === "tra" ? readTraEntries(text) : readMsgEntries(text);
    const starts = lineStarts(text);
    const entries: TraEntries = new Map();
    for (const { key, source, start, end } of raw) {
        const line = lineOf(starts, start);
        const endLine = lineOf(starts, end);
        // Previews are built here, not on demand, so a hover or inlay hint is a field read. Deferring and
        // memoising them was measured and dropped: a small share of load time and retained heap, against a
        // derivation on every preview's first access.
        const preview = stringPreview(source);
        const entry: TraEntry = {
            source,
            hover: preview.hover,
            inlay: preview.inlay,
            line,
            character: start - (starts[line] ?? 0),
            endLine,
            endCharacter: end - (starts[endLine] ?? 0),
        };
        if (preview.inlayTooltip !== undefined) {
            entry.inlayTooltip = preview.inlayTooltip;
        }
        entries.set(key, entry);
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
    if (CONSUMER_EXTENSIONS_TRA.includes(bare)) {
        return "tra";
    }
    if (CONSUMER_EXTENSIONS_MSG.includes(bare)) {
        return "msg";
    }
    return undefined;
}
