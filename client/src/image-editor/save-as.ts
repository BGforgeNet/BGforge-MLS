import * as path from "path";
import { type Animation, type LossReport, convertToFrm, frmDirectionMode } from "@bgforge/image";
import type { SaveAsTarget } from "./webview/messages";

/** The user-facing summary behind the lossy-conversion confirmation modal. */
export function summarizeLoss(report: LossReport): string {
    // Only real losses - informational notes (lossless remap, embedded/sidecar palette) are excluded
    // so the warning never lists a non-loss (and the modal only fires when report.lossless is false).
    return `Converting will lose: ${report.losses.map((item) => item.detail).join("; ")}`;
}

/**
 * Auto-named destination next to the source. Multi-file exports get a directory (the -apng suffix
 * stops the two directory exports from colliding on the same folder); single-file targets get
 * `<base>.<ext>`. BAMC shares the .bam extension, so its output name collides with an uncompressed
 * BAM / the source - a re-encode in place, intended.
 */
export function saveAsTargetPath(srcPath: string, target: SaveAsTarget): string {
    const dir = path.dirname(srcPath);
    const base = path.parse(srcPath).name;
    if (target === "apng") return path.join(dir, `${base}-apng`);
    if (target === "png-directory") return path.join(dir, base);
    const ext = target === "bamc" ? "bam" : target;
    return path.join(dir, `${base}.${ext}`);
}

/**
 * Whether saving/reshaping this animation as an FRM needs the user to choose a cycle: a
 * non-directional multi-cycle animation cannot fill FRM's 6 rotations on its own (a single cycle
 * auto-resolves to a single-orientation FRM).
 */
export function needsCyclePick(anim: Animation): boolean {
    return frmDirectionMode(anim) === "single-orientation" && anim.sequences.length > 1;
}

/**
 * Number of 8-cycle direction blocks when the animation resolved as an IE base file (directionLayout
 * "ie8"); undefined otherwise (then `needsCyclePick` decides). The ie8 layout guarantees a multiple of
 * 8 cycles at parse; Math.ceil keeps a loosely-claiming imported manifest from truncating a block.
 */
export function ieGroupCount(anim: Animation): number | undefined {
    if (anim.meta.directionLayout !== "ie8") return undefined;
    return Math.ceil(anim.sequences.length / 8);
}

/** How a non-FRM shape fills FRM's 6 rotations: one IE direction block, or one cycle for all rotations. */
export interface FrmShapePick {
    singleCycle?: number;
    ieGroup?: number;
}

/**
 * Reshape an imported animation into a valid FRM. `nearest` keeps its pixels consistent with the
 * FRM's default palette. The caller resolves `pick` first (the group/cycle choice, when one is needed).
 */
export function reshapeImportToFrm(next: Animation, pick?: FrmShapePick): Animation {
    // Tag the source as bam so convertToFrm actually reshapes it (it no-ops on frm-tagged input).
    const src: Animation = { ...next, meta: { ...next.meta, sourceFormat: "bam" } };
    return convertToFrm(src, { paletteMode: "nearest", ...pick }).animation;
}
