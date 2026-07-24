import { type Animation, type Frame, type Sequence } from "../model/animation.ts";
import { offsetToAnchor } from "../model/frame-anchor.ts";
import { LossReport } from "./loss-report.ts";

// Converts an FRM-shaped Animation to a BAM-shaped one. Already-BAM input is a no-op
// (still returns a new object per the shallow-clone contract) since there is nothing to convert.
export function convertToBam(anim: Animation): { animation: Animation; report: LossReport } {
    const report = new LossReport();

    if (anim.meta.sourceFormat === "bam" || anim.meta.sourceFormat === "bamc") {
        return { animation: { ...anim, meta: { ...anim.meta } }, report };
    }

    const sequences: Sequence[] = anim.sequences.map((seq) => ({ ...seq, frameRefs: [...seq.frameRefs] }));

    // Each frame's FRM per-direction header offset, needed to translate its anchor: a frame belongs to
    // the first direction (sequence) that references it; the sequences are in FRM header-slot order, so
    // the sequence index indexes dirOffsetsX/Y. Frames referenced by no direction keep a zero offset.
    // The "frm" annotation is the compile-time proof the no-op above covered every other SourceFormat.
    const source: "frm" = anim.meta.sourceFormat;
    const frameDirOffset = new Map<number, { x: number; y: number }>();
    let sharedOffsetConflicts = 0;
    anim.sequences.forEach((seq, slot) => {
        const dir = { x: anim.meta.dirOffsetsX?.[slot] ?? 0, y: anim.meta.dirOffsetsY?.[slot] ?? 0 };
        for (const ref of seq.frameRefs) {
            const existing = frameDirOffset.get(ref);
            if (!existing) frameDirOffset.set(ref, dir);
            else if (existing.x !== dir.x || existing.y !== dir.y) sharedOffsetConflicts++;
        }
    });
    if (sharedOffsetConflicts > 0) {
        report.add(
            "shared-frame-direction-offset",
            `${sharedOffsetConflicts} shared frame reference(s) keep the first referencing direction's offset; the other directions' differing offsets are dropped (BAM stores one anchor per frame)`,
        );
    }

    // Each frame's format-neutral anchor: the FRM feet line (bottom-centre + its per-direction offset).
    // offsetToAnchor deliberately ignores the FRM per-frame offset (an animation delta), so inter-frame
    // motion is not carried across - see model/frame-anchor.ts.
    const anchored = anim.frames.map((f, i) => {
        const dir = frameDirOffset.get(i);
        const anchor = offsetToAnchor(source, {
            width: f.width,
            height: f.height,
            offsetX: f.offsetX,
            offsetY: f.offsetY,
            dirOffsetX: dir?.x ?? 0,
            dirOffsetY: dir?.y ?? 0,
        });
        return { f, anchor };
    });

    // A BAM's centre fields idiomatically sit near the frame's visual centre (real corpus BAMs anchor at
    // ~half width/height), so feet-line anchors render half a sprite too high in centre-anchored
    // consumers, this editor's tile preview included. Translate every anchor by ONE shared delta - never
    // per-frame centring, which would unregister differing-size frames and make a walk cycle bob - so the
    // union box of all frames around the shared anchor point is centred on it.
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    for (const { f, anchor } of anchored) {
        minX = Math.min(minX, -anchor.ax);
        maxX = Math.max(maxX, f.width - 1 - anchor.ax);
        minY = Math.min(minY, -anchor.ay);
        maxY = Math.max(maxY, f.height - 1 - anchor.ay);
    }
    const shiftX = anchored.length > 0 ? (minX + maxX) / 2 : 0;
    const shiftY = anchored.length > 0 ? (minY + maxY) / 2 : 0;

    // New Frame objects, not spread: FRM's rawEncoding describes FRM's own on-disk pixel payload and must
    // not carry over into a BAM-shaped frame (would corrupt serializeBamV1).
    const frames: Frame[] = anchored.map(({ f, anchor }) => ({
        width: f.width,
        height: f.height,
        // Shares the source frame's buffer: frame pixels are immutable by convention across the
        // library (every mutation path builds new buffers), so a copy would only spend memory.
        pixels: f.pixels,
        offsetX: Math.round(anchor.ax + shiftX),
        offsetY: Math.round(anchor.ay + shiftY),
        rleEncoded: false,
    }));

    const palette = anim.palette.map((c) => ({ ...c }));

    // The FRM fps and action frame are dropped silently: BAM has no field for either (playback is the
    // engine's fixed 15 fps), and warning about fields the target format cannot store is noise on
    // every conversion.
    report.add("embedded-palette", "palette embedded directly in the BAM output");

    const animation: Animation = {
        palette,
        sequences,
        frames,
        meta: { sourceFormat: "bam", transparentIndex: 0, directionLayout: "frm6" },
    };

    return { animation, report };
}
