/**
 * KEY V1 (`chitin.key`) parser. The KEY is a game's master resource index: a
 * table of BIF files plus a table mapping each 8-char resref + resType to a
 * 32-bit locator (which BIF, and the file/tileset index within it). Format:
 * IESDP file_formats/ie_formats/key_v1.htm.
 *
 * KEY files are small (one per game), so this parses a whole in-memory buffer.
 * BIF extraction - the large, streaming part - lives in `./bif`.
 */

import { BufferReader, u16, u32 } from "typed-binary";
import { charsSpec, type FieldSpec } from "../spec/types";
import { toTypedBinarySchema } from "../spec/derive-typed-binary";
import { resourceTypeExt } from "./resource-type";

const keyHeaderSpec = {
    signature: charsSpec(4),
    version: charsSpec(4),
    bifCount: { codec: u32 },
    resCount: { codec: u32 },
    bifOffset: { codec: u32 },
    resOffset: { codec: u32 },
} satisfies Record<string, FieldSpec>;

const keyBifEntrySpec = {
    fileLength: { codec: u32 },
    nameOffset: { codec: u32 },
    nameLength: { codec: u16 },
    locationFlags: { codec: u16 },
} satisfies Record<string, FieldSpec>;

const keyResEntrySpec = {
    resref: charsSpec(8),
    type: { codec: u16 },
    locator: { codec: u32 },
} satisfies Record<string, FieldSpec>;

const KEY_HEADER_BYTES = 24;
const KEY_BIF_ENTRY_BYTES = 12;
const KEY_RES_ENTRY_BYTES = 14;

const headerCodec = toTypedBinarySchema(keyHeaderSpec);
const bifEntryCodec = toTypedBinarySchema(keyBifEntrySpec);
const resEntryCodec = toTypedBinarySchema(keyResEntrySpec);

export interface KeyBifEntry {
    /** BIF path relative to the game dir, separators normalized to '/'. */
    readonly name: string;
    readonly fileLength: number;
    readonly locationFlags: number;
}

export interface KeyResource {
    /** Uppercased, NUL-trimmed 8-char resref (the engine key is case-insensitive). */
    readonly resref: string;
    readonly type: number;
    /** Lowercase extension for `type`, or undefined if the resType is unknown. */
    readonly ext: string | undefined;
    readonly bifIndex: number;
    readonly tilesetIndex: number;
    readonly fileIndex: number;
}

export interface KeyIndex {
    readonly bifs: readonly KeyBifEntry[];
    readonly resources: readonly KeyResource[];
    /**
     * Resolve a resource (case-insensitive); with `type`, matches that resType exactly. When the same
     * resref+type is listed in more than one BIF, the LAST KEY entry wins - matching WeiDU (the toolchain this
     * emulates) and Near Infinity. GemRB keeps the first instead, so it differs.
     */
    lookup(resref: string, type?: number): KeyResource | undefined;
    /** Every KEY entry for a resref (optionally a resType), in file order; the last is the `lookup` winner. */
    lookupAll(resref: string, type?: number): readonly KeyResource[];
}

function trimNul(s: string): string {
    const i = s.indexOf("\0");
    return i === -1 ? s : s.slice(0, i);
}

// IE is little-endian, which is BufferReader's default (no endianness option).
function readerAt(bytes: Uint8Array, offset: number): BufferReader {
    return new BufferReader(bytes.buffer, { byteOffset: bytes.byteOffset + offset });
}

function requireInBounds(bytes: Uint8Array, offset: number, length: number, what: string): void {
    if (offset < 0 || offset + length > bytes.byteLength) {
        throw new RangeError(
            `KEY ${what} region [${offset}, ${offset + length}) exceeds file size ${bytes.byteLength}`,
        );
    }
}

function charsAt(bytes: Uint8Array, offset: number, length: number): string {
    let s = "";
    for (let i = 0; i < length; i++) s += String.fromCodePoint(bytes[offset + i]!);
    return s;
}

export function parseKey(bytes: Uint8Array): KeyIndex {
    requireInBounds(bytes, 0, KEY_HEADER_BYTES, "header");
    const header = headerCodec.read(readerAt(bytes, 0));
    if (header.signature !== "KEY " || !header.version.startsWith("V1")) {
        throw new Error(`Not a KEY V1 file (signature="${header.signature}" version="${header.version}")`);
    }

    requireInBounds(bytes, header.bifOffset, header.bifCount * KEY_BIF_ENTRY_BYTES, "BIF entries");
    const bifReader = readerAt(bytes, header.bifOffset);
    const bifs: KeyBifEntry[] = [];
    for (let i = 0; i < header.bifCount; i++) {
        const e = bifEntryCodec.read(bifReader);
        requireInBounds(bytes, e.nameOffset, e.nameLength, `BIF ${i} name`);
        bifs.push({
            name: trimNul(charsAt(bytes, e.nameOffset, e.nameLength)).replaceAll("\\", "/"),
            fileLength: e.fileLength,
            locationFlags: e.locationFlags,
        });
    }

    requireInBounds(bytes, header.resOffset, header.resCount * KEY_RES_ENTRY_BYTES, "resource entries");
    const resReader = readerAt(bytes, header.resOffset);
    const resources: KeyResource[] = [];
    for (let i = 0; i < header.resCount; i++) {
        const e = resEntryCodec.read(resReader);
        const locator = e.locator >>> 0;
        resources.push({
            resref: trimNul(e.resref).toUpperCase(),
            type: e.type,
            ext: resourceTypeExt(e.type),
            bifIndex: (locator >>> 20) & 0xfff,
            tilesetIndex: (locator >>> 14) & 0x3f,
            fileIndex: locator & 0x3fff,
        });
    }

    // Keep every duplicate in KEY (file) order so precedence is decidable: lookup returns the last, the
    // biffing/Near-Infinity winner. byKey is exact (resref+type); byRef collapses type for the loose lookup.
    const byKey = new Map<string, KeyResource[]>();
    const byRef = new Map<string, KeyResource[]>();
    const push = (m: Map<string, KeyResource[]>, k: string, v: KeyResource): void => {
        const list = m.get(k);
        if (list) list.push(v);
        else m.set(k, [v]);
    };
    for (const r of resources) {
        push(byKey, `${r.resref}\0${r.type}`, r);
        push(byRef, r.resref, r);
    }
    const matches = (resref: string, type?: number): KeyResource[] | undefined => {
        const key = resref.toUpperCase();
        return type === undefined ? byRef.get(key) : byKey.get(`${key}\0${type}`);
    };

    return {
        bifs,
        resources,
        lookup(resref, type) {
            const list = matches(resref, type);
            return list && list.length > 0 ? list[list.length - 1] : undefined;
        },
        lookupAll(resref, type) {
            return matches(resref, type) ?? [];
        },
    };
}
