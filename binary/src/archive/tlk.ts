/**
 * TLK V1 (`dialog.tlk`) reader: the game's string table, indexed 0-based by "strref". Records reference strings
 * by strref, so this resolves those to text for display. Format: IESDP file_formats/ie_formats/tlk_v1.htm.
 *
 * dialog.tlk holds hundreds of thousands of strings, so this reads the header once and then does a positioned
 * read per strref (one 26-byte entry + the string bytes) - resolving strrefs never bulk-loads the table.
 * `search` is the exception: matching on text has to see every entry, so it reads the table once and keeps it.
 */

import { BufferReader, u16, u32 } from "typed-binary";
import { charsSpec, type FieldSpec } from "../spec/types";
import { toTypedBinarySchema } from "../spec/derive-typed-binary";
import { bufferSource, type ByteSource } from "./byte-source";

const tlkHeaderSpec = {
    signature: charsSpec(4),
    version: charsSpec(4),
    languageId: { codec: u16 },
    stringCount: { codec: u32 },
    stringsOffset: { codec: u32 },
} satisfies Record<string, FieldSpec>;

const tlkEntrySpec = {
    flags: { codec: u16 },
    soundResref: charsSpec(8),
    volumeVariance: { codec: u32 },
    pitchVariance: { codec: u32 },
    stringOffset: { codec: u32 },
    stringLength: { codec: u32 },
} satisfies Record<string, FieldSpec>;

const TLK_HEADER_BYTES = 18;
const TLK_ENTRY_BYTES = 26; // entries are hardcoded to start at byte 18 (IESDP)
const TLK_TEXT_FLAG = 0x01; // bit 0: this entry has text

const headerCodec = toTypedBinarySchema(tlkHeaderSpec);
const entryCodec = toTypedBinarySchema(tlkEntrySpec);

// A TLK file is uniformly one encoding, set by the game: EE games are UTF-8, classic games use the game
// language's Windows ("ANSI") codepage - windows-1252 for Western, but windows-1251 (Russian), windows-1250
// (Polish/Czech), etc. for others, so it must not be assumed to be cp1252. The caller (usually openGame, which
// knows EE-vs-classic and the configured language) passes the encoding; a bare open with none falls back to a
// UTF-8-then-windows-1252 guess for the two most common cases.
const UTF8_STRICT = new TextDecoder("utf-8", { fatal: true });
const WINDOWS_1252 = new TextDecoder("windows-1252");
const decoderCache = new Map<string, InstanceType<typeof TextDecoder>>();

function decoderFor(encoding: string): InstanceType<typeof TextDecoder> {
    let decoder = decoderCache.get(encoding);
    if (!decoder) {
        decoder = new TextDecoder(encoding); // throws RangeError on an unsupported label - fail loud
        decoderCache.set(encoding, decoder);
    }
    return decoder;
}

// Strings may be NUL-terminated within their declared length; the real string ends at the first NUL.
function trimNul(text: string): string {
    const nul = text.indexOf("\0");
    return nul === -1 ? text : text.slice(0, nul);
}

function decodeString(bytes: Uint8Array, encoding: string | undefined): string {
    if (encoding !== undefined) return trimNul(decoderFor(encoding).decode(bytes));
    try {
        return trimNul(UTF8_STRICT.decode(bytes));
    } catch {
        return trimNul(WINDOWS_1252.decode(bytes));
    }
}

/** One search hit: the strref to reference the string by, and the text that matched. */
export interface TlkMatch {
    readonly strref: number;
    readonly text: string;
}

export interface TlkSearchOptions {
    /** Stop after this many hits. Defaults to 100 - a picker shows a page, not a whole string table. */
    limit?: number;
}

export interface Tlk {
    readonly count: number;
    readonly languageId: number;
    /**
     * The string for `strref`, NUL-trimmed. Returns "" for an empty or no-text entry, and `undefined` when
     * `strref` is out of range (including the -1 / 0xffffffff "no string" sentinel).
     */
    get(strref: number): string | undefined;
    /**
     * Entries whose text contains `query`, compared case-insensitively, in strref order. For choosing a string
     * by what it says rather than by number.
     *
     * Unlike `get`, this has to look at every entry, so the first call reads the whole table and keeps the
     * decoded strings; later searches are answered from that. Entries with no text are never hits.
     */
    search(query: string, options?: TlkSearchOptions): TlkMatch[];
    close(): void;
}

export interface TlkOptions {
    /**
     * Text encoding of the strings. A WHATWG label the platform's `TextDecoder` accepts - `"utf-8"` for EE
     * games, or the game language's Windows codepage for classic games (`"windows-1252"` Western,
     * `"windows-1251"` Russian, `"windows-1250"` Polish/Czech, ...). Omit to fall back to a UTF-8-then-cp1252
     * guess (correct only for EE and Western-classic games); prefer passing the known encoding.
     */
    encoding?: string;
}

const DEFAULT_SEARCH_LIMIT = 100;

export function openTlk(source: ByteSource, options: TlkOptions = {}): Tlk {
    const header = headerCodec.read(readerOf(source.read(0, TLK_HEADER_BYTES)));
    if (header.signature !== "TLK " || !header.version.startsWith("V1")) {
        source.close();
        throw new Error(`Not a TLK V1 file (signature="${header.signature}" version="${header.version}")`);
    }
    const { encoding } = options;
    if (encoding !== undefined) decoderFor(encoding); // validate the label now, so a bad one fails at open

    const count = header.stringCount;
    const stringsOffset = header.stringsOffset;

    // Resolved strings, by strref. A TLK is read-only for this reader's lifetime, so a hit needs no
    // invalidation. Worth caching because callers resolve the same strrefs repeatedly - a record's fields are
    // re-resolved on every refresh - and each miss costs two positioned reads. Only in-range strrefs land here;
    // an out-of-range one (including the -1 "no string" sentinel) returns before the lookup and stores nothing.
    const strings = new Map<number, string>();

    // Every entry's text, in strref order, built on the first search. Held because a picker searches on each
    // keystroke and rebuilding would re-read and re-decode the whole table every time. Entries with no text are
    // undefined, so they can never match.
    let allText: (string | undefined)[] | undefined;
    // The same entries lower-cased once, which is what a case-insensitive match actually compares against. A
    // real dialog.tlk holds six figures of strings and the picker searches on every keystroke, so folding case
    // per search means re-lowering the whole table per keystroke; doing it here costs one more pass over a
    // table already in memory.
    let allLower: (string | undefined)[] | undefined;

    function readAllText(): (string | undefined)[] {
        // Two bulk reads rather than two per entry: a real dialog.tlk holds six figures of strings, and the
        // positioned-read-per-entry shape that suits `get` costs hundreds of thousands of syscalls here.
        const entries = source.read(TLK_HEADER_BYTES, count * TLK_ENTRY_BYTES);
        const stringBytes = source.read(stringsOffset, source.size - stringsOffset);
        const text: (string | undefined)[] = [];
        for (let strref = 0; strref < count; strref++) {
            const entry = entryCodec.read(readerOf(entries.subarray(strref * TLK_ENTRY_BYTES)));
            // Pushed for every strref, no-text entries included, so the index stays the strref.
            text.push(
                (entry.flags & TLK_TEXT_FLAG) === 0 || entry.stringLength === 0
                    ? undefined
                    : decodeString(
                          stringBytes.subarray(entry.stringOffset, entry.stringOffset + entry.stringLength),
                          encoding,
                      ),
            );
        }
        return text;
    }

    return {
        count,
        languageId: header.languageId,
        search(query, searchOptions = {}) {
            const limit = searchOptions.limit ?? DEFAULT_SEARCH_LIMIT;
            const text = (allText ??= readAllText());
            const lower = (allLower ??= text.map((entry) => entry?.toLowerCase()));
            const needle = query.toLowerCase();
            const hits: TlkMatch[] = [];
            for (let strref = 0; strref < count && hits.length < limit; strref++) {
                // An empty entry is not a hit even for an empty query: there is nothing there to choose.
                const folded = lower[strref];
                if (folded === undefined || folded === "") continue;
                if (folded.includes(needle)) hits.push({ strref, text: text[strref]! });
            }
            return hits;
        },
        get(strref) {
            if (!Number.isInteger(strref) || strref < 0 || strref >= count) return;
            const cached = strings.get(strref);
            // An empty string is a real cached value (a no-text entry), so test for the miss, not falsiness.
            if (cached !== undefined) return cached;
            const entry = entryCodec.read(
                readerOf(source.read(TLK_HEADER_BYTES + strref * TLK_ENTRY_BYTES, TLK_ENTRY_BYTES)),
            );
            const text =
                (entry.flags & TLK_TEXT_FLAG) === 0 || entry.stringLength === 0
                    ? ""
                    : decodeString(source.read(stringsOffset + entry.stringOffset, entry.stringLength), encoding);
            strings.set(strref, text);
            return text;
        },
        close() {
            source.close();
        },
    };
}

/** Convenience: open a TLK already fully in memory. */
export function parseTlk(bytes: Uint8Array, options: TlkOptions = {}): Tlk {
    return openTlk(bufferSource(bytes), options);
}

// IE is little-endian (BufferReader default). Each read gives a fresh slice; wrap it in a reader at its offset.
function readerOf(bytes: Uint8Array): BufferReader {
    return new BufferReader(bytes.buffer, { byteOffset: bytes.byteOffset });
}
