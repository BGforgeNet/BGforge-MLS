import { type Animation, type Frame, type Sequence } from "../model/animation.ts";
import { LossReport } from "./loss-report.ts";

// Converts an FRM-shaped Animation to a BAM-shaped one. Already-BAM input is a no-op
// (still returns a new object per the shallow-clone contract) since there is nothing to convert.
export function convertToBam(anim: Animation): { animation: Animation; report: LossReport } {
    const report = new LossReport();

    if (anim.meta.sourceFormat === "bam" || anim.meta.sourceFormat === "bamc") {
        return { animation: { ...anim, meta: { ...anim.meta } }, report };
    }

    const sequences: Sequence[] = anim.sequences.map((seq) => ({ ...seq, frameRefs: [...seq.frameRefs] }));

    // New Frame objects, not spread: FRM's rawEncoding describes FRM's own on-disk pixel
    // payload and must not carry over into a BAM-shaped frame (would corrupt serializeBamV1).
    const frames: Frame[] = anim.frames.map((f) => ({
        width: f.width,
        height: f.height,
        pixels: f.pixels,
        offsetX: f.offsetX,
        offsetY: f.offsetY,
        rleEncoded: false,
    }));

    const palette = anim.palette.map((c) => ({ ...c }));

    if (anim.meta.fps) {
        report.add("dropped-fps", `source fps ${anim.meta.fps} has no BAM equivalent`);
    }
    if (anim.meta.actionFrame) {
        report.add("dropped-action-frame", `source action frame ${anim.meta.actionFrame} has no BAM equivalent`);
    }
    report.add("embedded-palette", "palette embedded directly in the BAM output");

    const animation: Animation = {
        palette,
        sequences,
        frames,
        meta: { sourceFormat: "bam", transparentIndex: 0, directionLayout: "frm6" },
    };

    return { animation, report };
}
