import { type Animation, type Frame, type Sequence, FRM_FACINGS, emptyPalette } from "../model/animation.ts";

const HEADER_SIZE = 0x3e;

export function parseFrm(bytes: Uint8Array): Animation {
    if (bytes.byteLength < HEADER_SIZE) throw new Error("parseFrm: FRM header truncated");
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const be = false; // DataView littleEndian flag; FRM is big-endian
    const version = view.getUint32(0x00, be);
    // Every Fallout 1/2 FRM (and .frN split member) carries version 4; anything else is not an
    // FRM this parser understands - reading on would produce garbage frames, not a best effort.
    if (version !== 4) throw new Error(`parseFrm: unsupported FRM version ${version} (expected 4)`);
    const fps = view.getUint16(0x04, be);
    const actionFrame = view.getUint16(0x06, be);
    const framesPerDirection = view.getUint16(0x08, be);
    const dirOffsetsX: number[] = [];
    const dirOffsetsY: number[] = [];
    for (let d = 0; d < FRM_FACINGS.length; d++) {
        dirOffsetsX.push(view.getInt16(0x0a + d * 2, be));
        dirOffsetsY.push(view.getInt16(0x16 + d * 2, be));
    }

    const frames: Frame[] = [];
    const sequences: Sequence[] = [];
    // Directions can share a data offset; cache frame indices per raw offset so a shared
    // direction reuses the same parsed frames rather than duplicating them in the pool.
    const framesByOffset = new Map<number, number[]>();

    // Iterate FRM_FACINGS (fixed length 6, one per header direction slot) rather than indexing
    // it by d, so facing comes out as Facing, not Facing | undefined under noUncheckedIndexedAccess.
    FRM_FACINGS.forEach((facing, d) => {
        const rawOffset = view.getUint32(0x22 + d * 4, be);
        let refs = framesByOffset.get(rawOffset);
        if (!refs) {
            refs = [];
            let cursor = HEADER_SIZE + rawOffset;
            for (let i = 0; i < framesPerDirection; i++) {
                if (cursor + 0x0c > bytes.byteLength) {
                    throw new Error(`parseFrm: frame header out of range (direction ${facing}, frame ${i})`);
                }
                const width = view.getUint16(cursor + 0x00, be);
                const height = view.getUint16(cursor + 0x02, be);
                const size = view.getUint32(cursor + 0x04, be);
                const x = view.getInt16(cursor + 0x08, be);
                const y = view.getInt16(cursor + 0x0a, be);
                const pixelStart = cursor + 0x0c;
                if (pixelStart + size > bytes.byteLength) {
                    throw new Error(`parseFrm: frame pixel data truncated (direction ${facing}, frame ${i})`);
                }
                const pixels = bytes.slice(pixelStart, pixelStart + size);
                frames.push({ width, height, pixels, offsetX: x, offsetY: y, rawEncoding: pixels });
                refs.push(frames.length - 1);
                cursor = pixelStart + size;
            }
            framesByOffset.set(rawOffset, refs);
        }
        sequences.push({ frameRefs: refs, facing });
    });

    return {
        palette: emptyPalette(),
        sequences,
        frames,
        meta: {
            sourceFormat: "frm",
            fps,
            actionFrame,
            frmVersion: version,
            directionLayout: "frm6",
            dirOffsetsX,
            dirOffsetsY,
        },
    };
}
