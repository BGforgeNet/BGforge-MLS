import zlib from "zlib";
import { type Rgba, emptyPalette } from "../model/animation.ts";
import { readChunks } from "./chunk.ts";

export interface DecodedIndexedPng {
    width: number;
    height: number;
    palette: Rgba[];
    pixels: Uint8Array;
    transparentIndex: number;
}

// Paeth predictor per the PNG spec (section 9.4): picks whichever of the three
// neighbours the linear predictor a+b-c lands closest to, ties broken a, then b.
function paeth(a: number, b: number, c: number): number {
    const p = a + b - c;
    const pa = Math.abs(p - a);
    const pb = Math.abs(p - b);
    const pc = Math.abs(p - c);
    if (pa <= pb && pa <= pc) return a;
    if (pb <= pc) return b;
    return c;
}

/**
 * Reverses PNG's per-scanline filtering (all five filter types, 1 byte/pixel:
 * bpp = 1 for 8-bit indexed colour). Shared by the static and animated (APNG)
 * decoders, since APNG frames use the same IDAT/fdAT scanline format.
 */
export function unfilterScanlines(raw: Uint8Array, width: number, height: number): Uint8Array {
    const pixels = new Uint8Array(width * height);
    let prevRow = new Uint8Array(width); // all zero: represents the nonexistent row above row 0
    let rawOffset = 0;
    for (let row = 0; row < height; row++) {
        const filterType = raw[rawOffset];
        if (filterType === undefined) {
            throw new Error("unfilterScanlines: truncated scanline data");
        }
        rawOffset += 1;
        const currentRow = new Uint8Array(width);
        for (let col = 0; col < width; col++) {
            const rawByte = raw[rawOffset + col];
            if (rawByte === undefined) {
                throw new Error("unfilterScanlines: truncated scanline data");
            }
            const a = col >= 1 ? (currentRow[col - 1] ?? 0) : 0; // left (bpp = 1 for 8-bit indexed)
            const b = prevRow[col] ?? 0; // above
            const c = col >= 1 ? (prevRow[col - 1] ?? 0) : 0; // above-left
            let value: number;
            switch (filterType) {
                case 0:
                    value = rawByte;
                    break;
                case 1:
                    value = (rawByte + a) & 0xff;
                    break;
                case 2:
                    value = (rawByte + b) & 0xff;
                    break;
                case 3:
                    value = (rawByte + Math.floor((a + b) / 2)) & 0xff;
                    break;
                case 4:
                    value = (rawByte + paeth(a, b, c)) & 0xff;
                    break;
                default:
                    throw new Error(`unfilterScanlines: unsupported filter type ${filterType}`);
            }
            currentRow[col] = value;
        }
        pixels.set(currentRow, row * width);
        rawOffset += width;
        prevRow = currentRow;
    }
    return pixels;
}

/** Hand-rolled colour-type-3 (indexed) PNG decoder: parses chunks, INFLATEs IDAT, unfilters all five PNG filter types. */
export function decodeIndexedPng(bytes: Uint8Array): DecodedIndexedPng {
    const chunks = readChunks(bytes);

    const ihdr = chunks.find((c) => c.type === "IHDR");
    if (!ihdr) {
        throw new Error("decodeIndexedPng: missing IHDR chunk");
    }
    const ihdrView = new DataView(ihdr.data.buffer, ihdr.data.byteOffset, ihdr.data.byteLength);
    const width = ihdrView.getUint32(0, false);
    const height = ihdrView.getUint32(4, false);
    const bitDepth = ihdr.data[8];
    const colourType = ihdr.data[9];
    if (bitDepth === undefined || colourType === undefined) {
        throw new Error("decodeIndexedPng: truncated IHDR chunk");
    }
    if (colourType !== 3 || bitDepth !== 8) {
        throw new Error(
            `decodeIndexedPng: not an 8-bit indexed PNG (colour type ${colourType}); import requires indexed PNGs`,
        );
    }

    const palette = emptyPalette();
    const plte = chunks.find((c) => c.type === "PLTE");
    if (plte) {
        const entryCount = Math.min(Math.floor(plte.data.length / 3), 256);
        for (let i = 0; i < entryCount; i++) {
            const r = plte.data[i * 3];
            const g = plte.data[i * 3 + 1];
            const b = plte.data[i * 3 + 2];
            const existing = palette[i];
            if (r === undefined || g === undefined || b === undefined || !existing) continue;
            palette[i] = { r, g, b, a: existing.a };
        }
    }

    const trns = chunks.find((c) => c.type === "tRNS");
    if (trns) {
        const entryCount = Math.min(trns.data.length, 256);
        for (let i = 0; i < entryCount; i++) {
            const alpha = trns.data[i];
            const existing = palette[i];
            if (alpha === undefined || !existing) continue;
            palette[i] = { ...existing, a: alpha };
        }
    }
    let transparentIndex = 0;
    for (const [i, entry] of palette.entries()) {
        if (entry.a === 0) {
            transparentIndex = i;
            break;
        }
    }

    const idatChunks = chunks.filter((c) => c.type === "IDAT");
    const compressedLength = idatChunks.reduce((sum, c) => sum + c.data.length, 0);
    const compressed = new Uint8Array(compressedLength);
    let compressedOffset = 0;
    for (const c of idatChunks) {
        compressed.set(c.data, compressedOffset);
        compressedOffset += c.data.length;
    }
    const raw = new Uint8Array(zlib.inflateSync(Buffer.from(compressed)));
    const pixels = unfilterScanlines(raw, width, height);

    return { width, height, palette, pixels, transparentIndex };
}
