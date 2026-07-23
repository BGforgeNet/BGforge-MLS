import { type Animation, type Frame, type Rgba, type Sequence, emptyPalette } from "../model/animation.ts";
import { interpretIeDirections } from "../model/ie-direction.ts";
import { MAX_FRAME_PIXELS } from "../limits.ts";

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

export function parseBamV1(bytes: Uint8Array): Animation {
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
    const frames: Frame[] = [];
    for (let i = 0; i < frameCount; i++) {
        const e = frameEntryOffset + i * 12;
        const width = view.getUint16(e + 0x00, le);
        const height = view.getUint16(e + 0x02, le);
        const centerX = view.getInt16(e + 0x04, le);
        const centerY = view.getInt16(e + 0x06, le);
        const packed = view.getUint32(e + 0x08, le);
        const dataOffset = packed & 0x7fffffff;
        const uncompressed = (packed & 0x80000000) !== 0;

        const expected = width * height;
        if (expected > MAX_FRAME_PIXELS) {
            throw new Error(`parseBamV1: frame ${i} claims ${width}x${height} pixels - implausibly large for a sprite`);
        }
        let pixels: Uint8Array;
        let rawEncoding: Uint8Array;
        if (uncompressed) {
            if (dataOffset + expected > bytes.byteLength) {
                throw new Error(`parseBamV1: frame ${i} pixel data out of range`);
            }
            pixels = bytes.slice(dataOffset, dataOffset + expected);
            rawEncoding = pixels;
        } else {
            const { decoded, consumed } = decodeRleTracked(view, dataOffset, transparentIndex, expected);
            pixels = decoded;
            rawEncoding = bytes.slice(dataOffset, dataOffset + consumed);
        }
        frames.push({
            width,
            height,
            pixels,
            offsetX: centerX,
            offsetY: centerY,
            rawEncoding,
            rleEncoded: !uncompressed,
        });
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

    // Resolve the direction layout at the source: the BAM container carries no direction tag, but the
    // IE creature base-file fingerprint (stride-8 blocks, dummy east slots) is detectable from the cycle
    // structure. Every consumer (editor layout default, metadata display, manifests) reads this one value.
    const directionLayout = interpretIeDirections(sequences, frames.length)?.detected ? "ie8" : "non-directional";

    return {
        palette,
        sequences,
        frames,
        // A BAM stores no frame rate; the engine plays them at a fixed 15 fps. Resolved here so every
        // consumer (playback, APNG export, FRM conversion) reads one value instead of re-defaulting.
        meta: { sourceFormat: "bam", transparentIndex, directionLayout, fps: 15 },
    };
}
