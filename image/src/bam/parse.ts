import { type Animation, type Frame, type Rgba, type Sequence, emptyPalette } from "../model/animation.ts";

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
        const b = view.getUint8(i++);
        decoded[o++] = b;
        if (b === transparent) {
            const run = view.getUint8(i++); // count byte: run + 1 transparent pixels
            for (let k = 0; k < run && o < expected; k++) decoded[o++] = transparent;
        }
    }
    return { decoded, consumed: i - start };
}

export function parseBamV1(bytes: Uint8Array): Animation {
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
    const palette: Rgba[] = emptyPalette();
    for (let i = 0; i < storedCount; i++) {
        const p = paletteOffset + i * 4;
        palette[i] = { b: view.getUint8(p), g: view.getUint8(p + 1), r: view.getUint8(p + 2), a: 255 };
    }

    // Frames.
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
        let pixels: Uint8Array;
        let rawEncoding: Uint8Array;
        if (uncompressed) {
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
    const sequences: Sequence[] = [];
    for (let c = 0; c < cycleCount; c++) {
        const e = cycleEntryOffset + c * 4;
        const lutCount = view.getUint16(e + 0x00, le);
        const lutStart = view.getUint16(e + 0x02, le);
        const frameRefs: number[] = [];
        for (let k = 0; k < lutCount; k++) {
            frameRefs.push(view.getUint16(frameLutOffset + (lutStart + k) * 2, le));
        }
        sequences.push({ frameRefs, facing: "none" });
    }

    return {
        palette,
        sequences,
        frames,
        meta: { sourceFormat: "bam", transparentIndex, directionLayout: "non-directional" },
    };
}
