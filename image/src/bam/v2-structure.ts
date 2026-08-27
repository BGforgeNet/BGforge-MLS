/**
 * BAM v2's on-disk tables, read without touching the PVRZ pages the frames are composed from.
 *
 * Split from decoding because `loadImage` is synchronous and cannot fetch pages: a caller reads the
 * structure, resolves `requiredPages` by whatever means it has, then decodes. It also answers "which
 * PVRZ does this file depend on" without decoding anything.
 */

/** One rectangle copied out of a PVRZ page into a frame. */
export interface BamV2DataBlock {
    page: number;
    sourceX: number;
    sourceY: number;
    width: number;
    height: number;
    targetX: number;
    targetY: number;
}

export interface BamV2FrameEntry {
    width: number;
    height: number;
    centerX: number;
    centerY: number;
    blockStart: number;
    blockCount: number;
}

/** A cycle is a contiguous range of frame entries, not an indirection through a lookup table. */
export interface BamV2Cycle {
    frameStart: number;
    frameCount: number;
}

export interface BamV2Structure {
    frames: BamV2FrameEntry[];
    cycles: BamV2Cycle[];
    blocks: BamV2DataBlock[];
    /** Every PVRZ page the blocks reference, unique and ascending. */
    requiredPages: number[];
}

const HEADER_BYTES = 0x20;
const FRAME_ENTRY_BYTES = 12;
const CYCLE_ENTRY_BYTES = 4;
const DATA_BLOCK_BYTES = 28;

function tag(bytes: Uint8Array, start: number): string {
    return String.fromCodePoint(bytes[start] ?? 0, bytes[start + 1] ?? 0, bytes[start + 2] ?? 0, bytes[start + 3] ?? 0);
}

export function readBamV2Structure(bytes: Uint8Array): BamV2Structure {
    if (bytes.byteLength < HEADER_BYTES) throw new Error("readBamV2Structure: BAM header truncated");
    const signature = tag(bytes, 0x00);
    const version = tag(bytes, 0x04);
    if (signature !== "BAM " || version !== "V2  ") {
        throw new Error(
            `readBamV2Structure: not a BAM V2 file (signature "${signature}", version "${version.trim()}")`,
        );
    }

    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const le = true;
    // v2 counts are dwords, where v1's are a word and two bytes - one of several reasons this is a
    // separate reader rather than a version branch inside parseBamV1.
    const frameCount = view.getUint32(0x08, le);
    const cycleCount = view.getUint32(0x0c, le);
    const blockCount = view.getUint32(0x10, le);
    const frameOffset = view.getUint32(0x14, le);
    const cycleOffset = view.getUint32(0x18, le);
    const blockOffset = view.getUint32(0x1c, le);

    const inRange = (offset: number, count: number, size: number): boolean => offset + count * size <= bytes.byteLength;
    if (!inRange(frameOffset, frameCount, FRAME_ENTRY_BYTES)) {
        throw new Error("readBamV2Structure: frame entry table out of range");
    }
    if (!inRange(cycleOffset, cycleCount, CYCLE_ENTRY_BYTES)) {
        throw new Error("readBamV2Structure: cycle entry table out of range");
    }
    if (!inRange(blockOffset, blockCount, DATA_BLOCK_BYTES)) {
        throw new Error("readBamV2Structure: data block table out of range");
    }

    const frames: BamV2FrameEntry[] = [];
    for (let i = 0; i < frameCount; i++) {
        const e = frameOffset + i * FRAME_ENTRY_BYTES;
        frames.push({
            width: view.getUint16(e + 0x00, le),
            height: view.getUint16(e + 0x02, le),
            centerX: view.getInt16(e + 0x04, le),
            centerY: view.getInt16(e + 0x06, le),
            blockStart: view.getUint16(e + 0x08, le),
            blockCount: view.getUint16(e + 0x0a, le),
        });
    }

    const cycles: BamV2Cycle[] = [];
    for (let c = 0; c < cycleCount; c++) {
        const e = cycleOffset + c * CYCLE_ENTRY_BYTES;
        cycles.push({ frameCount: view.getUint16(e + 0x00, le), frameStart: view.getUint16(e + 0x02, le) });
    }

    const blocks: BamV2DataBlock[] = [];
    const pages = new Set<number>();
    for (let b = 0; b < blockCount; b++) {
        const e = blockOffset + b * DATA_BLOCK_BYTES;
        const page = view.getUint32(e + 0x00, le);
        pages.add(page);
        blocks.push({
            page,
            sourceX: view.getUint32(e + 0x04, le),
            sourceY: view.getUint32(e + 0x08, le),
            width: view.getUint32(e + 0x0c, le),
            height: view.getUint32(e + 0x10, le),
            targetX: view.getUint32(e + 0x14, le),
            targetY: view.getUint32(e + 0x18, le),
        });
    }

    return { frames, cycles, blocks, requiredPages: [...pages].sort((a, b) => a - b) };
}
