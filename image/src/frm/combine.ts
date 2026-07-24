import { type Animation, type Frame, type Sequence, FRM_FACINGS, emptyPalette } from "../model/animation.ts";
import { parseFrm } from "./parse.ts";

/**
 * Combine a Fallout critter's six single-direction files (`<base>.fr0` .. `<base>.fr5`) into one
 * 6-direction FRM Animation - the inverse of how modding tools split a critter for editing.
 *
 * Each `.frN` is itself a complete FRM that carries ONLY facing N's frames (all six of its
 * data-offset header slots point at region 0) and replicates facing N's pixel offset across all
 * six of its x/y-offset slots. So facing N's frames are that file's frame pool, and facing N's
 * offset is that file's slot 0 - reading slot 0 from each file reconstructs the original combined
 * header's per-direction offsets exactly.
 *
 * `files` is indexed by facing (0..5, FRM_FACINGS order). An undefined slot (an incomplete set on
 * disk) yields an empty sequence for that facing rather than throwing; the header fps / action
 * frame / version come from the first present file.
 */
export function combineFrmDirections(files: readonly (Uint8Array | undefined)[]): Animation {
    const frames: Frame[] = [];
    const sequences: Sequence[] = [];
    const dirOffsetsX: number[] = [];
    const dirOffsetsY: number[] = [];
    let fps = 0;
    let actionFrame = 0;
    let frmVersion = 4;
    let haveMeta = false;

    FRM_FACINGS.forEach((facing, d) => {
        const bytes = files[d];
        if (bytes === undefined) {
            sequences.push({ frameRefs: [], facing });
            dirOffsetsX.push(0);
            dirOffsetsY.push(0);
            return;
        }
        const dir = parseFrm(bytes);
        if (!haveMeta) {
            fps = dir.meta.fps ?? 0;
            actionFrame = dir.meta.actionFrame ?? 0;
            frmVersion = dir.meta.frmVersion ?? 4;
            haveMeta = true;
        }
        // A split file's six sequences all alias one frame pool (shared data offset 0), so its
        // first sequence is facing N's frame list. Re-index into the combined pool as we copy.
        const refs = dir.sequences[0]?.frameRefs ?? [];
        const combinedRefs: number[] = [];
        for (const ref of refs) {
            const f = dir.frames[ref];
            if (f === undefined) continue;
            combinedRefs.push(frames.length);
            frames.push(f);
        }
        sequences.push({ frameRefs: combinedRefs, facing });
        dirOffsetsX.push(dir.meta.dirOffsetsX?.[0] ?? 0);
        dirOffsetsY.push(dir.meta.dirOffsetsY?.[0] ?? 0);
    });

    return {
        palette: emptyPalette(),
        frames,
        sequences,
        meta: {
            sourceFormat: "frm",
            fps,
            actionFrame,
            frmVersion,
            directionLayout: "frm6",
            dirOffsetsX,
            dirOffsetsY,
        },
    };
}
