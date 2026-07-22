import { type Animation, type Frame, FRM_FACINGS } from "../model/animation.ts";

const HEADER_SIZE = 0x3e;

function frameBytes(f: Frame): Uint8Array {
    return f.rawEncoding ?? f.pixels;
}

export function serializeFrm(anim: Animation): Uint8Array {
    const be = false; // FRM is big-endian
    const seqs = anim.sequences;
    const framesPerDirection = seqs[0]?.frameRefs.length ?? 0;

    // Assign a data-region offset per direction, sharing the offset when two directions
    // reference the identical frame-ref list (mirrors how parse cached by raw offset).
    const dirBytes: Uint8Array[] = [];
    const dataOffsets: number[] = Array.from({ length: FRM_FACINGS.length }, () => 0);
    const offsetByKey = new Map<string, number>();
    let region = 0;
    for (let d = 0; d < FRM_FACINGS.length; d++) {
        const refs = seqs[d]?.frameRefs ?? [];
        const key = refs.join(",");
        const existing = offsetByKey.get(key);
        if (existing !== undefined) {
            dataOffsets[d] = existing;
            continue;
        }
        dataOffsets[d] = region;
        offsetByKey.set(key, region);
        for (const ref of refs) {
            const f = anim.frames[ref];
            if (!f) continue;
            const bytes = frameBytes(f);
            const rec = new Uint8Array(0x0c + bytes.length);
            const rv = new DataView(rec.buffer);
            rv.setUint16(0x00, f.width, be);
            rv.setUint16(0x02, f.height, be);
            rv.setUint32(0x04, bytes.length, be);
            rv.setInt16(0x08, f.offsetX, be);
            rv.setInt16(0x0a, f.offsetY, be);
            rec.set(bytes, 0x0c);
            dirBytes.push(rec);
            region += rec.length;
        }
    }
    const frameAreaSize = region;

    const total = HEADER_SIZE + frameAreaSize;
    const out = new Uint8Array(total);
    const view = new DataView(out.buffer);
    view.setUint32(0x00, anim.meta.frmVersion ?? 4, be);
    view.setUint16(0x04, anim.meta.fps ?? 0, be);
    view.setUint16(0x06, anim.meta.actionFrame ?? 0, be);
    view.setUint16(0x08, framesPerDirection, be);
    for (let d = 0; d < FRM_FACINGS.length; d++) {
        view.setInt16(0x0a + d * 2, anim.meta.dirOffsetsX?.[d] ?? 0, be);
    }
    for (let d = 0; d < FRM_FACINGS.length; d++) {
        view.setInt16(0x16 + d * 2, anim.meta.dirOffsetsY?.[d] ?? 0, be);
    }
    for (let d = 0; d < FRM_FACINGS.length; d++) view.setUint32(0x22 + d * 4, dataOffsets[d] ?? 0, be);
    view.setUint32(0x3a, frameAreaSize, be);

    let cursor = HEADER_SIZE;
    for (const rec of dirBytes) {
        out.set(rec, cursor);
        cursor += rec.length;
    }
    return out;
}
