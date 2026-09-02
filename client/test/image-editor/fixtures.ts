import type { AnimationView, IndexedAnimationView } from "../../src/image-editor/webview/messages";
import {
    DEFAULT_FALLOUT_PALETTE,
    emptyPalette,
    FRM_FACINGS,
    type IndexedAnimation,
    type Frame,
    type Sequence,
} from "@bgforge/image";

/** A minimal valid 6-facing FRM animation: one 1x1 frame per facing, still a real FRM construct. */
export function makeMiniFrm(): IndexedAnimation {
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

function ieBam(sequences: Sequence[], frames: Frame[]): IndexedAnimation {
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
export function makeIeBamBase(): IndexedAnimation {
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
export function makeIeBamEast(): IndexedAnimation {
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
export function makeMiniBam(): IndexedAnimation {
    return {
        palette: emptyPalette(),
        sequences: [{ frameRefs: [0], facing: "none" }],
        frames: [{ width: 1, height: 1, pixels: Uint8Array.from([0]), offsetX: 0, offsetY: 0 }],
        meta: { sourceFormat: "bam", transparentIndex: 0 },
    };
}

/**
 * Two cycles of three frames each. Unlike `makeMiniBam` and `makeMiniFrm`, whose sequences hold a
 * single frame apiece, this one has frames that no sequence shows FIRST - which is what makes lazy
 * frame delivery distinguishable from eager delivery at all.
 */
export function makeMultiFrameBam(): IndexedAnimation {
    return {
        palette: emptyPalette(),
        sequences: [
            { frameRefs: [0, 1, 2], facing: "none" },
            { frameRefs: [3, 4, 5], facing: "none" },
        ],
        frames: Array.from({ length: 6 }, (_, i) => ({
            width: 2,
            height: 1,
            pixels: Uint8Array.from([i, i + 10]),
            offsetX: 0,
            offsetY: 0,
        })),
        meta: { sourceFormat: "bam", transparentIndex: 0 },
    };
}

/**
 * The view as an indexed one, for suites that build palette-indexed documents. Throws rather than
 * casting, so a document that unexpectedly became true-colour fails here instead of at a missing
 * palette three assertions later.
 */
export function asIndexedView(view: AnimationView): IndexedAnimationView {
    if (view.colorModel !== "indexed") throw new Error(`expected an indexed view, got ${view.colorModel}`);
    return view;
}
