import { type Facing, type IndexedAnimation, type Frame, type Sequence } from "../model/animation.ts";
import { offsetToAnchor } from "../model/frame-anchor.ts";
import { IE8_FACINGS } from "./directions.ts";
import { LossReport } from "./loss-report.ts";

// Converts an FRM-shaped IndexedAnimation to a BAM-shaped one. Already-BAM input is a no-op
// (still returns a new object per the shallow-clone contract) since there is nothing to convert.
export function convertToBam(anim: IndexedAnimation): { animation: IndexedAnimation; report: LossReport } {
    const report = new LossReport();

    if (anim.meta.sourceFormat === "bam" || anim.meta.sourceFormat === "bamc") {
        return { animation: { ...anim, meta: { ...anim.meta } }, report };
    }

    const sequences = placeFrmRotations(anim);

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

    const animation: IndexedAnimation = {
        palette,
        sequences,
        frames,
        meta: { sourceFormat: "bam", transparentIndex: 0, directionLayout: "ie8" },
    };

    return { animation, report };
}

/**
 * Lay the FRM rotations out as IE direction cycles.
 *
 * A BAM stores no facing field - a cycle's direction IS its index - so keeping the FRM's own header
 * order would silently rotate every direction the moment the file is written and read back: the engine
 * takes cycle 0 as South, and FRM's cycle 0 is NE. Each rotation is therefore placed at the IE slot
 * naming the same compass point. S and N stay empty: FRM's rotations are hexagonal and include neither,
 * and filling them from a neighbour would invent a direction the source never had. That is deliberately
 * not a reported loss - nothing of the source is dropped, the target simply has two slots it cannot
 * fill - matching how the reverse conversion treats losing N/S as structural.
 */
function placeFrmRotations(anim: IndexedAnimation): Sequence[] {
    const copy = (seq: Sequence, facing: Facing): Sequence => ({ frameRefs: [...seq.frameRefs], facing });
    const [first] = anim.sequences;
    if (first === undefined) return [];
    // Every rotation pointing at the same frames is FRM's way of saying "one orientation, shown for all
    // six" (equal data offsets); that sprite belongs in every IE slot, S and N included. Read from the
    // frames rather than the facing tags, which parseFrm fills in for all six slots either way.
    const oneOrientation = anim.sequences.every(
        (s) => s.frameRefs.length === first.frameRefs.length && s.frameRefs.every((r, i) => r === first.frameRefs[i]),
    );
    if (oneOrientation) return IE8_FACINGS.map((facing) => copy(first, facing));
    const byFacing = new Map(anim.sequences.map((seq) => [seq.facing, seq]));
    return IE8_FACINGS.map((facing) => {
        const seq = byFacing.get(facing);
        return seq === undefined ? { frameRefs: [], facing } : copy(seq, facing);
    });
}
