import {
    DEFAULT_FALLOUT_PALETTE,
    emptyPalette,
    FRM_FACINGS,
    type Animation,
    type Frame,
    type Sequence,
} from "@bgforge/image";

/** A minimal valid 6-facing FRM animation: one 1x1 frame per facing, still a real FRM construct. */
export function makeMiniFrm(): Animation {
    return {
        palette: emptyPalette(),
        sequences: FRM_FACINGS.map((facing, i) => ({ frameRefs: [i], facing })),
        frames: FRM_FACINGS.map((_, i) => ({
            width: 1,
            height: 1,
            pixels: Uint8Array.from([i]),
            offsetX: 0,
            offsetY: 0,
        })),
        meta: {
            sourceFormat: "frm",
            fps: 10,
            actionFrame: 0,
            frmVersion: 4,
            dirOffsetsX: [0, 0, 0, 0, 0, 0],
            dirOffsetsY: [0, 0, 0, 0, 0, 0],
        },
    };
}

function px(v: number): Frame {
    return { width: 1, height: 1, pixels: Uint8Array.from([v]), offsetX: 0, offsetY: 0 };
}

function ieBam(sequences: Sequence[], frames: Frame[]): Animation {
    return {
        palette: DEFAULT_FALLOUT_PALETTE.map((c) => ({ ...c })),
        frames,
        sequences,
        meta: { sourceFormat: "bam", transparentIndex: 0, directionLayout: "ie8", fps: 15 },
    };
}

/**
 * The base half of an IE base/east BAM pair: per 8-slot block, the five west slots carry a traceable
 * frame and the three east slots share filler frame 0 - the fingerprint combineIeBamPair detects.
 * Two blocks, the smallest count the detector accepts.
 */
export function makeIeBamBase(): Animation {
    const frames: Frame[] = [px(255)];
    const sequences: Sequence[] = [];
    for (let block = 0; block < 2; block++) {
        for (let slot = 0; slot < 5; slot++) {
            frames.push(px(1 + block * 16 + slot));
            sequences.push({ frameRefs: [frames.length - 1], facing: "none" });
        }
        for (let slot = 5; slot < 8; slot++) sequences.push({ frameRefs: [0, 0], facing: "none" });
    }
    return ieBam(sequences, frames);
}

/** The `*E` companion to makeIeBamBase: west slots dummied with the 0xFFFF sentinel, east slots real. */
export function makeIeBamEast(): Animation {
    const frames: Frame[] = [];
    const sequences: Sequence[] = [];
    for (let block = 0; block < 2; block++) {
        for (let slot = 0; slot < 5; slot++) sequences.push({ frameRefs: [65535], facing: "none" });
        for (let slot = 5; slot < 8; slot++) {
            frames.push(px(100 + block * 16 + slot));
            sequences.push({ frameRefs: [frames.length - 1], facing: "none" });
        }
    }
    return ieBam(sequences, frames);
}

/** A minimal valid BAM v1 animation: one facing-less cycle, one 1x1 frame, transparent index 0. */
export function makeMiniBam(): Animation {
    return {
        palette: emptyPalette(),
        sequences: [{ frameRefs: [0], facing: "none" }],
        frames: [{ width: 1, height: 1, pixels: Uint8Array.from([0]), offsetX: 0, offsetY: 0 }],
        meta: { sourceFormat: "bam", transparentIndex: 0 },
    };
}
