/**
 * BIF archive reader. A BIF is a flat archive of game resources; its directory
 * table gives each resource's `(offset, size)`, so a resource is extracted with
 * a single positioned read rather than loading the whole archive. Format: IESDP
 * file_formats/ie_formats/bif_v1.htm.
 *
 * Three on-disk shapes, detected by the 4-byte signature:
 *   - 'BIFF' V1  - uncompressed; read directly through the source (streaming).
 *   - 'BIF ' V1  - BIFC: the whole inner BIFF is one zlib stream.
 *   - 'BIFC' V1.0 - the inner BIFF is split into separately zlib-compressed blocks.
 * Compressed shapes have no random access, so they inflate fully into memory once
 * (the rare case); plain BIFF - the large, common case - never gets bulk-read.
 */

import { BufferReader, u16, u32 } from "typed-binary";
import * as zlib from "zlib";
import { charsSpec, type FieldSpec } from "../spec/types";
import { toTypedBinarySchema } from "../spec/derive-typed-binary";
import { bufferSource, type ByteSource } from "./byte-source";

const bifHeaderSpec = {
    signature: charsSpec(4),
    version: charsSpec(4),
    fileCount: { codec: u32 },
    tilesetCount: { codec: u32 },
    fileEntriesOffset: { codec: u32 },
} satisfies Record<string, FieldSpec>;

const bifFileEntrySpec = {
    locator: { codec: u32 },
    dataOffset: { codec: u32 },
    size: { codec: u32 },
    type: { codec: u16 },
    unknown: { codec: u16 },
} satisfies Record<string, FieldSpec>;

const bifTilesetEntrySpec = {
    locator: { codec: u32 },
    dataOffset: { codec: u32 },
    tileCount: { codec: u32 },
    tileSize: { codec: u32 },
    type: { codec: u16 },
    unknown: { codec: u16 },
} satisfies Record<string, FieldSpec>;

const BIF_HEADER_BYTES = 20; // sig(4) ver(4) fileCount(4) tilesetCount(4) fileEntriesOffset(4)
const BIF_FILE_ENTRY_BYTES = 16;
const BIF_TILESET_ENTRY_BYTES = 20;

const bifHeaderCodec = toTypedBinarySchema(bifHeaderSpec);
const bifFileEntryCodec = toTypedBinarySchema(bifFileEntrySpec);
const bifTilesetEntryCodec = toTypedBinarySchema(bifTilesetEntrySpec);

export interface BifFileEntry {
    readonly fileIndex: number;
    readonly offset: number;
    readonly size: number;
    readonly type: number;
}

export interface BifTilesetEntry {
    readonly tilesetIndex: number;
    readonly offset: number;
    readonly tileCount: number;
    readonly tileSize: number;
    readonly type: number;
}

export interface BifArchive {
    readonly compressed: boolean;
    readonly files: ReadonlyMap<number, BifFileEntry>;
    readonly tilesets: ReadonlyMap<number, BifTilesetEntry>;
    /** Bytes of the non-tileset resource at `fileIndex`. Positioned read; the archive is not bulk-loaded. */
    readFile(fileIndex: number): Uint8Array;
    /** Bytes of the tileset resource at `tilesetIndex` (`tileCount * tileSize`). */
    readTileset(tilesetIndex: number): Uint8Array;
    close(): void;
}

function signatureOf(source: ByteSource): string {
    const b = source.read(0, 4);
    return String.fromCodePoint(b[0]!, b[1]!, b[2]!, b[3]!);
}

/** Open a BIF over any byte source, transparently inflating the compressed variants. */
export function openBif(source: ByteSource): BifArchive {
    const signature = signatureOf(source);
    if (signature === "BIFF") return openPlainBif(source);
    if (signature === "BIF ") return openInflatedBif(inflateWhole(source), source);
    if (signature === "BIFC") return openInflatedBif(inflateBlocks(source), source);
    source.close();
    throw new Error(`Unrecognized BIF signature "${signature}"`);
}

/** Convenience: open a BIF already fully in memory. */
export function parseBif(bytes: Uint8Array): BifArchive {
    return openBif(bufferSource(bytes));
}

function openInflatedBif(inner: Uint8Array, original: ByteSource): BifArchive {
    // The whole archive was read to inflate it, so the original source is done.
    original.close();
    return { ...openPlainBif(bufferSource(inner)), compressed: true };
}

function openPlainBif(source: ByteSource): BifArchive {
    const head = source.read(0, BIF_HEADER_BYTES);
    const header = bifHeaderCodec.read(new BufferReader(head.buffer, { byteOffset: head.byteOffset }));
    if (header.signature !== "BIFF") {
        source.close();
        throw new Error(`Not a BIFF V1 archive (signature="${header.signature}")`);
    }

    const fileTableBytes = header.fileCount * BIF_FILE_ENTRY_BYTES;
    const tilesetTableBytes = header.tilesetCount * BIF_TILESET_ENTRY_BYTES;
    const table = source.read(header.fileEntriesOffset, fileTableBytes + tilesetTableBytes);
    const tableReader = new BufferReader(table.buffer, { byteOffset: table.byteOffset });

    const files = new Map<number, BifFileEntry>();
    for (let i = 0; i < header.fileCount; i++) {
        const e = bifFileEntryCodec.read(tableReader);
        const fileIndex = (e.locator >>> 0) & 0x3fff;
        files.set(fileIndex, { fileIndex, offset: e.dataOffset, size: e.size, type: e.type });
    }

    const tilesets = new Map<number, BifTilesetEntry>();
    for (let i = 0; i < header.tilesetCount; i++) {
        const e = bifTilesetEntryCodec.read(tableReader);
        const tilesetIndex = ((e.locator >>> 0) >>> 14) & 0x3f;
        tilesets.set(tilesetIndex, {
            tilesetIndex,
            offset: e.dataOffset,
            tileCount: e.tileCount,
            tileSize: e.tileSize,
            type: e.type,
        });
    }

    return {
        compressed: false,
        files,
        tilesets,
        readFile(fileIndex) {
            const e = files.get(fileIndex);
            if (!e) throw new Error(`No file index ${fileIndex} in BIF`);
            return source.read(e.offset, e.size);
        },
        readTileset(tilesetIndex) {
            const e = tilesets.get(tilesetIndex);
            if (!e) throw new Error(`No tileset index ${tilesetIndex} in BIF`);
            return source.read(e.offset, e.tileCount * e.tileSize);
        },
        close() {
            source.close();
        },
    };
}

/**
 * Inflate one stream, refusing to produce more than deflate could plausibly have compressed. zlib's best
 * ratio is 1032:1, so anything past that multiple of the input is a corrupt or hostile length rather than a
 * real archive, and fails as a clear zlib error instead of an unbounded allocation.
 */
const MAX_INFLATE_RATIO = 1032;

function inflateBounded(compressed: Uint8Array): Buffer {
    return zlib.inflateSync(compressed, { maxOutputLength: compressed.byteLength * MAX_INFLATE_RATIO });
}

// BIFC ('BIF ' V1): header is sig(4)+version(4)+filenameLen(4)+filename+uncompressedLen(4)+compressedLen(4),
// then one zlib stream of the whole inner BIFF.
function inflateWhole(source: ByteSource): Uint8Array {
    const all = source.read(0, source.size);
    const dv = new DataView(all.buffer, all.byteOffset, all.byteLength);
    const filenameLen = dv.getUint32(8, true);
    return inflateBounded(all.subarray(12 + filenameLen + 8));
}

// BIFC V1.0 ('BIFC'): header is sig(4)+version(4)+uncompressedSize(4), then blocks of
// {decompressedSize(4), compressedSize(4), zlib data}. Blocks concatenate to the inner BIFF.
function inflateBlocks(source: ByteSource): Uint8Array {
    const all = source.read(0, source.size);
    const dv = new DataView(all.buffer, all.byteOffset, all.byteLength);
    // The declared total bounds the LOOP, never an allocation: it comes straight off the file, so sizing a
    // buffer with it lets the file's own claim reserve memory (and the archive then holds that buffer for its
    // lifetime). Concatenating what actually inflated gives the same bytes with no such trust.
    const total = dv.getUint32(8, true);
    const blocks: Uint8Array[] = [];
    let pos = 12;
    let written = 0;
    while (pos + 8 <= all.byteLength && written < total) {
        const compressedSize = dv.getUint32(pos + 4, true);
        pos += 8;
        const inflated = inflateBounded(all.subarray(pos, pos + compressedSize));
        blocks.push(inflated);
        written += inflated.byteLength;
        pos += compressedSize;
    }
    return Buffer.concat(blocks);
}
