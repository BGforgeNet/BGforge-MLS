import { type IndexedAnimation, type Frame, type Rgba, type Sequence, emptyPalette } from "../model/animation.ts";
import { directionLayoutOf, interpretIeDirections } from "../model/ie-direction.ts";
import { MAX_ANIMATION_PIXELS, MAX_FRAME_PIXELS } from "../limits.ts";

// RLE decode that also reports how many source bytes were consumed, so the caller can
// capture the exact on-disk frame-data slice for rawEncoding (byte-identical re-serialize).
function decodeRleTracked(
    view: DataView,
    start: number,
    transparent: number,
    expected: number,
): { decoded: Uint8Array; consumed: number } {
    const decoded = new Uint8Array(expected);
    let o = 0;
    let i = start;
    while (o < expected) {
        if (i >= view.byteLength) throw new Error("parseBamV1: RLE frame data truncated");
        const b = view.getUint8(i++);
        decoded[o++] = b;
        if (b === transparent) {
            if (i >= view.byteLength) throw new Error("parseBamV1: RLE frame data truncated");
            const run = view.getUint8(i++); // count byte: run + 1 transparent pixels
            for (let k = 0; k < run && o < expected; k++) decoded[o++] = transparent;
        }
    }
    return { decoded, consumed: i - start };
}

function tag(bytes: Uint8Array, start: number): string {
    return String.fromCodePoint(bytes[start] ?? 0, bytes[start + 1] ?? 0, bytes[start + 2] ?? 0, bytes[start + 3] ?? 0);
}

/**
 * Every BAM v1 table, with no pixel data decoded.
 *
 * Split out so a caller that needs only a few frames (a thumbnail samples one per cycle) can read the
 * cycle table and then decode just those, instead of paying for every frame. `parseBamV1` is the
 * decode-everything caller; both read the file through this one definition.
 */
export interface BamV1Tables {
    palette: Rgba[];
    sequences: Sequence[];
    frameCount: number;
    transparentIndex: number;
    /** Where the frame entry table starts; `decodeFrameAt` locates each entry from it. */
    frameEntryOffset: number;
    /**
     * Each frame's declared pixel count, in frame order.
     *
     * Read here because the entry table is already walked for the size bounds below, and the alternative
     * is decoding pixels to answer "does this frame draw anything" - which is the question a caller asks
     * of a whole file at once (a packed file's empty bands reference frames of no size).
     */
    frameAreas: number[];
}

/** Reads the header, palette, frame entry table and cycle table. `bytes` must be uncompressed v1. */
export function readV1Tables(bytes: Uint8Array): BamV1Tables {
    if (bytes.byteLength < 0x18) throw new Error("parseBamV1: BAM header truncated");
    const signature = tag(bytes, 0x00);
    if (signature !== "BAM ") throw new Error(`parseBamV1: not a BAM file (signature "${signature}")`);
    const version = tag(bytes, 0x04);
    if (version !== "V1  ") {
        throw new Error(`parseBamV1: unsupported BAM version "${version.trim()}" - only BAM V1 (and BAMC) is readable`);
    }
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const le = true; // BAM is little-endian
    const frameCount = view.getUint16(0x08, le);
    const cycleCount = view.getUint8(0x0a);
    const transparentIndex = view.getUint8(0x0b);
    const frameEntryOffset = view.getUint32(0x0c, le);
    const paletteOffset = view.getUint32(0x10, le);
    const frameLutOffset = view.getUint32(0x14, le);

    // Palette (BGRA -> Rgba, alpha forced opaque for v1). The on-disk palette section is not
    // always a full 256 entries: real files often store only the colors actually used, sized as
    // (frameLutOffset - paletteOffset) / 4. Start from emptyPalette() so the model's 256-entry
    // contract holds regardless, and overwrite the entries the file actually provides.
    const storedCount = Math.max(0, Math.min(256, Math.floor((frameLutOffset - paletteOffset) / 4)));
    if (storedCount > 0 && paletteOffset + storedCount * 4 > bytes.byteLength) {
        throw new Error("parseBamV1: palette out of range");
    }
    const palette: Rgba[] = emptyPalette();
    for (let i = 0; i < storedCount; i++) {
        const p = paletteOffset + i * 4;
        palette[i] = { b: view.getUint8(p), g: view.getUint8(p + 1), r: view.getUint8(p + 2), a: 255 };
    }

    // Frames.
    if (frameEntryOffset + frameCount * 12 > bytes.byteLength) {
        throw new Error("parseBamV1: frame entry table out of range");
    }

    // Both size bounds are checked against the DECLARED entry table before any frame is decoded. A
    // running total inside the decode loop cannot work for the aggregate: it is 4x MAX_FRAME_PIXELS, so
    // it first trips at frame 4 - by which point frames 0-3 are already allocated, which is the
    // allocation the bound exists to prevent. The per-frame bound moves here for the same reason.
    let declaredPixels = 0;
    const frameAreas: number[] = [];
    for (let i = 0; i < frameCount; i++) {
        const e = frameEntryOffset + i * 12;
        const width = view.getUint16(e + 0x00, le);
        const height = view.getUint16(e + 0x02, le);
        if (width * height > MAX_FRAME_PIXELS) {
            throw new Error(`parseBamV1: frame ${i} claims ${width}x${height} pixels - implausibly large for a sprite`);
        }
        frameAreas.push(width * height);
        declaredPixels += width * height;
    }
    if (declaredPixels > MAX_ANIMATION_PIXELS) {
        throw new Error(
            `parseBamV1: frames claim ${declaredPixels} pixels in total - more than the ` +
                `${MAX_ANIMATION_PIXELS} a whole animation may hold`,
        );
    }

    // Cycles + frame lookup table (cycle entries immediately follow the frame entries).
    const cycleEntryOffset = frameEntryOffset + frameCount * 12;
    if (cycleEntryOffset + cycleCount * 4 > bytes.byteLength) {
        throw new Error("parseBamV1: cycle entry table out of range");
    }
    const sequences: Sequence[] = [];
    for (let c = 0; c < cycleCount; c++) {
        const e = cycleEntryOffset + c * 4;
        const lutCount = view.getUint16(e + 0x00, le);
        const lutStart = view.getUint16(e + 0x02, le);
        if (frameLutOffset + (lutStart + lutCount) * 2 > bytes.byteLength) {
            throw new Error(`parseBamV1: cycle ${c} frame lookup table out of range`);
        }
        const frameRefs: number[] = [];
        for (let k = 0; k < lutCount; k++) {
            frameRefs.push(view.getUint16(frameLutOffset + (lutStart + k) * 2, le));
        }
        sequences.push({ frameRefs, facing: "none" });
    }

    return { palette, sequences, frameCount, transparentIndex, frameEntryOffset, frameAreas };
}

/** Decodes one frame's pixels. `index` must be in range; `bytes` must be uncompressed v1. */
export function decodeFrameAt(bytes: Uint8Array, index: number, tables: BamV1Tables): Frame {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const le = true;
    const e = tables.frameEntryOffset + index * 12;
    const width = view.getUint16(e + 0x00, le);
    const height = view.getUint16(e + 0x02, le);
    const centerX = view.getInt16(e + 0x04, le);
    const centerY = view.getInt16(e + 0x06, le);
    const packed = view.getUint32(e + 0x08, le);
    const dataOffset = packed & 0x7fffffff;
    const uncompressed = (packed & 0x80000000) !== 0;

    const expected = width * height; // already bounded by readV1Tables' pre-decode pass
    let pixels: Uint8Array;
    let rawEncoding: Uint8Array;
    if (uncompressed) {
        if (dataOffset + expected > bytes.byteLength) {
            throw new Error(`parseBamV1: frame ${index} pixel data out of range`);
        }
        pixels = bytes.slice(dataOffset, dataOffset + expected);
        rawEncoding = pixels;
    } else {
        const { decoded, consumed } = decodeRleTracked(view, dataOffset, tables.transparentIndex, expected);
        pixels = decoded;
        rawEncoding = bytes.slice(dataOffset, dataOffset + consumed);
    }
    return { width, height, pixels, offsetX: centerX, offsetY: centerY, rawEncoding, rleEncoded: !uncompressed };
}

export function parseBamV1(bytes: Uint8Array): IndexedAnimation {
    const tables = readV1Tables(bytes);
    const frames: Frame[] = [];
    for (let i = 0; i < tables.frameCount; i++) frames.push(decodeFrameAt(bytes, i, tables));

    // Resolve the direction layout at the source: the BAM container carries no direction tag, but the
    // IE creature block structure is detectable from the cycle table. Every consumer (editor layout
    // default, metadata display, manifests) reads this one value.
    const directionLayout = directionLayoutOf(interpretIeDirections(tables.sequences, frames.length));

    return {
        palette: tables.palette,
        sequences: tables.sequences,
        frames,
        // A BAM stores no frame rate; the engine plays them at a fixed 15 fps. Resolved here so every
        // consumer (playback, APNG export, FRM conversion) reads one value instead of re-defaulting.
        meta: { sourceFormat: "bam", transparentIndex: tables.transparentIndex, directionLayout, fps: 15 },
    };
}
