import { emptyPalette, FRM_FACINGS, type Animation } from "@bgforge/image";

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

/** A minimal valid BAM v1 animation: one facing-less cycle, one 1x1 frame, transparent index 0. */
export function makeMiniBam(): Animation {
    return {
        palette: emptyPalette(),
        sequences: [{ frameRefs: [0], facing: "none" }],
        frames: [{ width: 1, height: 1, pixels: Uint8Array.from([0]), offsetX: 0, offsetY: 0 }],
        meta: { sourceFormat: "bam", transparentIndex: 0 },
    };
}
