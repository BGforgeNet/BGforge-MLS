import { type BamV2SourceBlock, type RgbaAnimation, type RgbaFrame } from "../model/animation.ts";
import { encodePvrz } from "../pvrz/container.ts";

/** One PVRZ page a save must write, alongside the `.bam` itself. */
export interface BamV2PageWrite {
    page: number;
    bytes: Uint8Array;
}

export interface BamV2SaveResult {
    bam: Uint8Array;
    /** Pages that must be written beside the `.bam`. Empty when nothing needed re-encoding. */
    pages: BamV2PageWrite[];
}

export interface BamV2SaveOptions {
    /**
     * First page number to allocate when frames must be repacked. Required in that case and never
     * guessed: "free in this folder" is not "free in the game", and a page number already taken by
     * a BIF surfaces only as corrupted graphics at runtime.
     */
    basePage?: number;
    /**
     * Emit the pages an unmodified animation reused, verbatim, instead of no pages at all. A Save As
     * needs them: the `.bam` names its pages by number and the folder it lands in has none.
     */
    emitUnchangedPages?: boolean;
}

const HEADER_BYTES = 0x20;
const FRAME_ENTRY_BYTES = 12;
const CYCLE_ENTRY_BYTES = 4;
const DATA_BLOCK_BYTES = 28;

/** Page dimension used when repacking. Powers of two up to 1024 are what the games ship. */
const PAGE_SIZE = 1024;

function everyFrameUnmodified(anim: RgbaAnimation): boolean {
    return anim.sourcePages !== undefined && anim.frames.every((f) => f.sourceBlocks !== undefined);
}

/** The PVRZ bytes the animation was read from, as page writes. Only meaningful while unmodified. */
function retainedPages(anim: RgbaAnimation): BamV2PageWrite[] {
    return [...(anim.sourcePages ?? [])].map(([page, bytes]) => ({ page, bytes }));
}

/**
 * Lay frames left-to-right in shelf rows on `PAGE_SIZE` pages, one block per frame.
 *
 * A shelf packer rather than anything cleverer: sprite frames within one animation are close in
 * height, which is the case shelf packing is already near-optimal for, and a tighter packing would
 * buy disk space in a format whose pages are read whole anyway.
 */
function repack(
    frames: readonly RgbaFrame[],
    basePage: number,
): { blocks: BamV2SourceBlock[]; pages: BamV2PageWrite[] } {
    const blocks: BamV2SourceBlock[] = [];
    const pages: BamV2PageWrite[] = [];
    let canvas = new Uint8Array(PAGE_SIZE * PAGE_SIZE * 4);
    let pageIndex = 0;
    let cursorX = 0;
    let cursorY = 0;
    let shelfHeight = 0;
    let used = false;

    const flush = (): void => {
        if (!used) return;
        pages.push({
            page: basePage + pageIndex,
            // BC3 throughout: a sprite page carries per-pixel alpha, which BC1 cannot represent.
            bytes: encodePvrz({ width: PAGE_SIZE, height: PAGE_SIZE, format: "bc3", rgba: canvas }),
        });
        canvas = new Uint8Array(PAGE_SIZE * PAGE_SIZE * 4);
        pageIndex++;
        cursorX = 0;
        cursorY = 0;
        shelfHeight = 0;
        used = false;
    };

    for (const frame of frames) {
        if (frame.width > PAGE_SIZE || frame.height > PAGE_SIZE) {
            throw new Error(
                `serializeBamV2: frame ${frame.width}x${frame.height} exceeds the ${PAGE_SIZE}x${PAGE_SIZE} page size`,
            );
        }
        if (cursorX + frame.width > PAGE_SIZE) {
            cursorX = 0;
            cursorY += shelfHeight;
            shelfHeight = 0;
        }
        if (cursorY + frame.height > PAGE_SIZE) {
            flush();
        }
        for (let row = 0; row < frame.height; row++) {
            canvas.set(
                frame.pixels.subarray(row * frame.width * 4, (row + 1) * frame.width * 4),
                ((cursorY + row) * PAGE_SIZE + cursorX) * 4,
            );
        }
        blocks.push({
            page: basePage + pageIndex,
            sourceX: cursorX,
            sourceY: cursorY,
            width: frame.width,
            height: frame.height,
            targetX: 0,
            targetY: 0,
        });
        used = true;
        cursorX += frame.width;
        shelfHeight = Math.max(shelfHeight, frame.height);
    }
    flush();
    return { blocks, pages };
}

/**
 * Write a BAM v2, plus any PVRZ pages the write implies.
 *
 * An animation whose frames all still carry their `sourceBlocks` is emitted verbatim - the original
 * bytes when they are held, and no page writes at all. That is the point: block compression is
 * lossy, so re-encoding an untouched file would degrade it slightly on every save, cumulatively.
 * Any edited frame forces a full repack rather than a partial one, which trades a little extra
 * rewriting for a rule that is easy to state and to verify.
 */
export function serializeBamV2(anim: RgbaAnimation, options: BamV2SaveOptions = {}): BamV2SaveResult {
    const unmodified = everyFrameUnmodified(anim);
    const retained = options.emitUnchangedPages && unmodified ? retainedPages(anim) : [];
    if (unmodified && anim.sourceBytes !== undefined) {
        return { bam: anim.sourceBytes, pages: retained };
    }

    let blocks: BamV2SourceBlock[];
    let pages: BamV2PageWrite[];
    const frameBlockRanges: { start: number; count: number }[] = [];

    if (unmodified) {
        // Re-emit the file's own block table: the pages on disk are still the ones these frames
        // were composed from, so nothing needs encoding.
        blocks = [];
        pages = retained;
        for (const frame of anim.frames) {
            const own = frame.sourceBlocks ?? [];
            frameBlockRanges.push({ start: blocks.length, count: own.length });
            blocks.push(...own);
        }
    } else {
        const { basePage } = options;
        if (basePage === undefined) {
            throw new Error(
                "serializeBamV2: this animation has edited or synthesized frames, so it needs fresh PVRZ pages - " +
                    "pass basePage to say which page number to start at.",
            );
        }
        const packed = repack(anim.frames, basePage);
        blocks = packed.blocks;
        pages = packed.pages;
        for (const [index] of anim.frames.entries()) frameBlockRanges.push({ start: index, count: 1 });
    }

    const frameCount = anim.frames.length;
    const cycleCount = anim.sequences.length;
    const frameOffset = HEADER_BYTES;
    const cycleOffset = frameOffset + frameCount * FRAME_ENTRY_BYTES;
    const blockOffset = cycleOffset + cycleCount * CYCLE_ENTRY_BYTES;
    const total = blockOffset + blocks.length * DATA_BLOCK_BYTES;

    const out = new Uint8Array(total);
    out.set(new TextEncoder().encode("BAM V2  "), 0);
    const view = new DataView(out.buffer);
    const le = true;
    view.setUint32(0x08, frameCount, le);
    view.setUint32(0x0c, cycleCount, le);
    view.setUint32(0x10, blocks.length, le);
    view.setUint32(0x14, frameOffset, le);
    view.setUint32(0x18, cycleOffset, le);
    view.setUint32(0x1c, blockOffset, le);

    for (const [i, frame] of anim.frames.entries()) {
        const e = frameOffset + i * FRAME_ENTRY_BYTES;
        const range = frameBlockRanges[i] ?? { start: 0, count: 0 };
        view.setUint16(e + 0x00, frame.width, le);
        view.setUint16(e + 0x02, frame.height, le);
        view.setInt16(e + 0x04, frame.offsetX, le);
        view.setInt16(e + 0x06, frame.offsetY, le);
        view.setUint16(e + 0x08, range.start, le);
        view.setUint16(e + 0x0a, range.count, le);
    }

    for (const [c, seq] of anim.sequences.entries()) {
        const e = cycleOffset + c * CYCLE_ENTRY_BYTES;
        // A v2 cycle is a contiguous frame-entry range, so only the first ref and the count survive;
        // a non-contiguous cycle cannot be expressed and is rejected rather than silently reordered.
        const first = seq.frameRefs[0] ?? 0;
        const contiguous = seq.frameRefs.every((ref, k) => ref === first + k);
        if (!contiguous) {
            throw new Error(
                `serializeBamV2: cycle ${c} references non-contiguous frames, which BAM v2 cycles cannot express`,
            );
        }
        view.setUint16(e + 0x00, seq.frameRefs.length, le);
        view.setUint16(e + 0x02, first, le);
    }

    for (const [b, block] of blocks.entries()) {
        const e = blockOffset + b * DATA_BLOCK_BYTES;
        view.setUint32(e + 0x00, block.page, le);
        view.setUint32(e + 0x04, block.sourceX, le);
        view.setUint32(e + 0x08, block.sourceY, le);
        view.setUint32(e + 0x0c, block.width, le);
        view.setUint32(e + 0x10, block.height, le);
        view.setUint32(e + 0x14, block.targetX, le);
        view.setUint32(e + 0x18, block.targetY, le);
    }

    return { bam: out, pages };
}
