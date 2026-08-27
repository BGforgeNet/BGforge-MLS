import zlib from "zlib";
import { type Rgba, emptyPalette } from "../model/animation.ts";
import { MAX_FRAME_PIXELS } from "../limits.ts";
import { type PngChunk, readChunks } from "./chunk.ts";

export interface DecodedIndexedPng {
    width: number;
    height: number;
    palette: Rgba[];
    pixels: Uint8Array;
    transparentIndex: number;
}

/** IHDR dimensions, guarded, for a PNG that must be 8-bit and of the given colour type. */
function readIhdr(
    chunks: PngChunk[],
    errorPrefix: string,
    expected: { colourType: number; description: string },
): { width: number; height: number } {
    const ihdr = chunks.find((c) => c.type === "IHDR");
    if (!ihdr) {
        throw new Error(`${errorPrefix}: missing IHDR chunk`);
    }
    const ihdrView = new DataView(ihdr.data.buffer, ihdr.data.byteOffset, ihdr.data.byteLength);
    const width = ihdrView.getUint32(0, false);
    const height = ihdrView.getUint32(4, false);
    const bitDepth = ihdr.data[8];
    const colourType = ihdr.data[9];
    if (bitDepth === undefined || colourType === undefined) {
        throw new Error(`${errorPrefix}: truncated IHDR chunk`);
    }
    if (colourType !== expected.colourType || bitDepth !== 8) {
        throw new Error(
            `${errorPrefix}: not an ${expected.description} PNG (colour type ${colourType}, bit depth ${bitDepth})`,
        );
    }
    if (width === 0 || height === 0 || width * height > MAX_FRAME_PIXELS) {
        throw new Error(`${errorPrefix}: implausible image dimensions ${width}x${height}`);
    }
    return { width, height };
}

/** The concatenated IDAT payload, inflated and capped at the one size the image can legally need. */
function inflateIdat(
    chunks: PngChunk[],
    width: number,
    height: number,
    bytesPerPixel: number,
    errorPrefix: string,
): Uint8Array {
    const idatChunks = chunks.filter((c) => c.type === "IDAT");
    const compressedLength = idatChunks.reduce((sum, c) => sum + c.data.length, 0);
    const compressed = new Uint8Array(compressedLength);
    let compressedOffset = 0;
    for (const c of idatChunks) {
        compressed.set(c.data, compressedOffset);
        compressedOffset += c.data.length;
    }
    // Non-interlaced 8-bit: the raw stream is exactly height x (1 filter byte + width * bpp).
    // Capping the inflate there stops zlib bombs (and rejects interlaced data loudly).
    const maxOutputLength = height * (width * bytesPerPixel + 1);
    try {
        return new Uint8Array(zlib.inflateSync(Buffer.from(compressed), { maxOutputLength }));
    } catch (error) {
        throw new Error(
            `${errorPrefix}: IDAT decompression failed: ${error instanceof Error ? error.message : String(error)}`,
            { cause: error },
        );
    }
}

/**
 * Shared IHDR-guard + PLTE/tRNS parse for the static and animated (APNG) indexed decoders.
 * Per the IR convention, the palette stays fully opaque (a: 255 for every entry) and
 * transparency is carried as a single `transparentIndex` - the first tRNS byte that is
 * 0 (default 0 if no tRNS) - never written onto a palette entry's alpha.
 */
export function parseHeaderAndPalette(
    chunks: PngChunk[],
    errorPrefix: string,
): { width: number; height: number; palette: Rgba[]; transparentIndex: number } {
    const { width, height } = readIhdr(chunks, errorPrefix, { colourType: 3, description: "8-bit indexed" });

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
            // Alpha stays whatever emptyPalette() seeded (255): the IR convention keeps
            // every palette entry opaque, transparency carried only via transparentIndex.
            palette[i] = { r, g, b, a: existing.a };
        }
    }

    let transparentIndex = 0;
    const trns = chunks.find((c) => c.type === "tRNS");
    if (trns) {
        const entryCount = Math.min(trns.data.length, 256);
        for (let i = 0; i < entryCount; i++) {
            if (trns.data[i] === 0) {
                transparentIndex = i;
                break;
            }
        }
    }

    return { width, height, palette, transparentIndex };
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
 * Reverses PNG's per-scanline filtering (all five filter types). Shared by the static, animated
 * (APNG) and true-colour decoders, since every one of them uses the same IDAT/fdAT scanline format.
 *
 * `bytesPerPixel` is 1 for 8-bit indexed and 4 for 8-bit RGBA. It is how far back the filter's
 * "left" and "above-left" neighbours sit - per PIXEL, not per byte - so getting it wrong still
 * decodes, just with the colour smeared along each row.
 */
export function unfilterScanlines(raw: Uint8Array, width: number, height: number, bytesPerPixel = 1): Uint8Array {
    const stride = width * bytesPerPixel;
    const pixels = new Uint8Array(stride * height);
    let prevRow = new Uint8Array(stride); // all zero: represents the nonexistent row above row 0
    let rawOffset = 0;
    for (let row = 0; row < height; row++) {
        const filterType = raw[rawOffset];
        if (filterType === undefined) {
            throw new Error("unfilterScanlines: truncated scanline data");
        }
        rawOffset += 1;
        const currentRow = new Uint8Array(stride);
        for (let col = 0; col < stride; col++) {
            const rawByte = raw[rawOffset + col];
            if (rawByte === undefined) {
                throw new Error("unfilterScanlines: truncated scanline data");
            }
            const back = col - bytesPerPixel;
            const a = back >= 0 ? (currentRow[back] ?? 0) : 0; // left
            const b = prevRow[col] ?? 0; // above
            const c = back >= 0 ? (prevRow[back] ?? 0) : 0; // above-left
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
        pixels.set(currentRow, row * stride);
        rawOffset += stride;
        prevRow = currentRow;
    }
    return pixels;
}

/**
 * The PNG's declared colour type (3 = indexed, 6 = true colour with alpha), for a caller that must
 * pick a decoder before it knows which one applies.
 */
export function pngColourType(bytes: Uint8Array): number {
    const ihdr = readChunks(bytes).find((c) => c.type === "IHDR");
    if (!ihdr) throw new Error("pngColourType: missing IHDR chunk");
    const colourType = ihdr.data[9];
    if (colourType === undefined) throw new Error("pngColourType: truncated IHDR chunk");
    return colourType;
}

/**
 * Hand-rolled colour-type-6 (truecolour with alpha) PNG decoder. Counterpart of
 * encodeTruecolourPng; `pixels` is `width * height * 4` RGBA bytes.
 */
export function decodeTruecolourPng(bytes: Uint8Array): { width: number; height: number; pixels: Uint8Array } {
    const chunks = readChunks(bytes);
    const { width, height } = readIhdr(chunks, "decodeTruecolourPng", {
        colourType: 6,
        description: "8-bit true-colour with alpha",
    });
    const raw = inflateIdat(chunks, width, height, 4, "decodeTruecolourPng");
    return { width, height, pixels: unfilterScanlines(raw, width, height, 4) };
}

/** Hand-rolled colour-type-3 (indexed) PNG decoder: parses chunks, INFLATEs IDAT, unfilters all five PNG filter types. */
export function decodeIndexedPng(bytes: Uint8Array): DecodedIndexedPng {
    const chunks = readChunks(bytes);
    const { width, height, palette, transparentIndex } = parseHeaderAndPalette(chunks, "decodeIndexedPng");

    const raw = inflateIdat(chunks, width, height, 1, "decodeIndexedPng");
    const pixels = unfilterScanlines(raw, width, height);

    return { width, height, palette, pixels, transparentIndex };
}
