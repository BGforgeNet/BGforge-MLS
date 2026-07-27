/**
 * TLK V1 (`dialog.tlk`) reader: the game's string table, indexed 0-based by "strref". Records reference strings
 * by strref, so this resolves those to text for display. Format: IESDP file_formats/ie_formats/tlk_v1.htm.
 *
 * dialog.tlk holds hundreds of thousands of strings, so this reads the header once and then does a positioned
 * read per strref (one 26-byte entry + the string bytes) - the table and strings are never bulk-loaded.
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

export interface Tlk {
    readonly count: number;
    readonly languageId: number;
    /**
     * The string for `strref`, NUL-trimmed. Returns "" for an empty or no-text entry, and `undefined` when
     * `strref` is out of range (including the -1 / 0xffffffff "no string" sentinel).
     */
    get(strref: number): string | undefined;
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

    return {
        count,
        languageId: header.languageId,
        get(strref) {
            if (!Number.isInteger(strref) || strref < 0 || strref >= count) return;
            const entry = entryCodec.read(
                readerOf(source.read(TLK_HEADER_BYTES + strref * TLK_ENTRY_BYTES, TLK_ENTRY_BYTES)),
            );
            if ((entry.flags & TLK_TEXT_FLAG) === 0 || entry.stringLength === 0) return "";
            return decodeString(source.read(stringsOffset + entry.stringOffset, entry.stringLength), encoding);
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
