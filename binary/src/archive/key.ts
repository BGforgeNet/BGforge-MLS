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

const KEY_HEADER_BYTES = 24;
const KEY_BIF_ENTRY_BYTES = 12;

// Resource entry: an 8-byte resref (NUL-terminated within the field), u16 resType, u32 locator. Laid out
// as offsets rather than a spec because this is the one structure read per RESOURCE - see the decode loop.
const KEY_RES_ENTRY_BYTES = 14;
const KEY_RESREF_BYTES = 8;
const KEY_RES_TYPE_OFFSET = 8;
const KEY_RES_LOCATOR_OFFSET = 10;

const headerCodec = toTypedBinarySchema(keyHeaderSpec);
const bifEntryCodec = toTypedBinarySchema(keyBifEntrySpec);

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
    // Decoded straight from a DataView rather than through a derived codec like the header and BIF tables
    // above. This is the one structure read per RESOURCE - tens of thousands of times for a real chitin.key -
    // and the generic codec's per-entry reader and intermediate object dominated the whole parse there. The
    // header runs once and the BIF table tens of times, so those keep the declarative spec.
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const resources: KeyResource[] = [];
    for (let i = 0; i < header.resCount; i++) {
        const at = header.resOffset + i * KEY_RES_ENTRY_BYTES;
        let resref = "";
        for (let c = 0; c < KEY_RESREF_BYTES; c++) {
            const byte = view.getUint8(at + c);
            if (byte === 0) break; // NUL-terminated within the fixed 8-byte field
            resref += String.fromCodePoint(byte);
        }
        const type = view.getUint16(at + KEY_RES_TYPE_OFFSET, true);
        const locator = view.getUint32(at + KEY_RES_LOCATOR_OFFSET, true) >>> 0;
        resources.push({
            resref: resref.toUpperCase(),
            type,
            ext: resourceTypeExt(type),
            bifIndex: (locator >>> 20) & 0xfff,
            tilesetIndex: (locator >>> 14) & 0x3f,
            fileIndex: locator & 0x3fff,
        });
    }

    // Every entry for a resref, in KEY (file) order, so precedence is decidable: lookup returns the last -
    // the biffing/Near-Infinity winner.
    //
    // Built on the FIRST lookup rather than at parse time, and as ONE index rather than two. A real
    // chitin.key names tens of thousands of resources, and eagerly building a resref index plus a second
    // resref+type index was the bulk of the parse - paid by every caller whether or not it ever looked a
    // resource up. A typed lookup filters the resref's own list instead, which is a handful of entries.
    let byRef: Map<string, KeyResource[]> | undefined;

    function index(): Map<string, KeyResource[]> {
        if (byRef !== undefined) return byRef;
        const built = new Map<string, KeyResource[]>();
        for (const r of resources) {
            const list = built.get(r.resref);
            if (list) list.push(r);
            else built.set(r.resref, [r]);
        }
        byRef = built;
        return built;
    }

    const matches = (resref: string, type?: number): readonly KeyResource[] => {
        const all = index().get(resref.toUpperCase()) ?? [];
        return type === undefined ? all : all.filter((r) => r.type === type);
    };

    return {
        bifs,
        resources,
        lookup(resref, type) {
            return matches(resref, type).at(-1);
        },
        lookupAll(resref, type) {
            return matches(resref, type);
        },
    };
}
