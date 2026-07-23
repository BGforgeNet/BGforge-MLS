import {
    type Animation,
    type Facing,
    type Frame,
    type Sequence,
    FRM_FACINGS,
    transparentIndexOf,
} from "../model/animation.ts";
import { interpretIeDirections } from "../model/ie-direction.ts";
import { LossReport } from "./loss-report.ts";
import { facingsForCycleCount, partitionForFrm, frmSlotOrder, FRM_FACING_SET } from "./directions.ts";
import { normalizeTransparentToZero, remapToDefault, remapToNearest } from "./palette-remap.ts";
import { DEFAULT_FALLOUT_PALETTE } from "../palette/default-palette.ts";

export interface FrmConvertOpts {
    paletteMode?: "sidecar" | "nearest";
    /** Non-directional source only: the cycle index that fills all 6 FRM rotations (single-orientation). */
    singleCycle?: number;
    /** IE multi-block source only: the 8-slot direction block whose cycles fill the FRM rotations (its
     *  north/south cycles have no FRM slot and are dropped). Mutually exclusive with singleCycle. */
    ieGroup?: number;
}

/**
 * Whether a source converts to a DIRECTIONAL FRM (6/8 cycles, or cycles already tagged with facings)
 * or a SINGLE-ORIENTATION FRM. Per the FRM spec a valid ".frm can contain one direction or all six":
 * a non-directional sprite fills all six rotations from ONE cycle, written as equal data_offsets. The
 * provider reads this to decide whether it must ask which cycle (multi-cycle non-directional source).
 */
export function frmDirectionMode(anim: Animation): "directional" | "single-orientation" {
    if (anim.sequences.some((s) => s.facing !== "none")) return "directional";
    return facingsForCycleCount(anim.sequences.length) === null ? "single-orientation" : "directional";
}

function resolveFacings(anim: Animation): Facing[] {
    // Tagged facings are authoritative; the count-derived IE8/FRM order is only for untagged sources
    // (a 6-cycle source tagged in a different order must not be re-read positionally).
    const ownFacings = anim.sequences.map((s) => s.facing);
    if (ownFacings.some((f) => f !== "none")) return ownFacings;
    const derived = facingsForCycleCount(anim.sequences.length);
    if (derived) return derived;
    // Untagged with no count-derived layout: a multi-cycle non-directional source with no chosen cycle -
    // the caller must pass opts.singleCycle (a single-cycle source auto-resolves in convertToFrm).
    throw new Error(
        `Cannot save this ${anim.sequences.length}-cycle animation as FRM: it has no directions - choose which cycle to use for a single-orientation FRM.`,
    );
}

/**
 * Single-orientation slots: all six rotations share the chosen cycle's one animation. The pool holds
 * that cycle's frames once and every slot references the IDENTICAL frame-ref list, so serializeFrm
 * writes equal data_offsets (the FRM spec's shared-rotation form) rather than six copies.
 */
function buildSingleOrientationSlots(
    anim: Animation,
    cycleIndex: number,
    report: LossReport,
): { pool: Frame[]; frameRefsPerSlot: number[][] } {
    const seq = anim.sequences[cycleIndex];
    if (!seq) throw new Error(`convertToFrm: single-orientation cycle index ${cycleIndex} out of range`);
    const pool: Frame[] = seq.frameRefs.map((ref) => {
        const frame = anim.frames[ref];
        if (!frame) throw new Error(`convertToFrm: frame ref ${ref} out of range`);
        return frame;
    });
    const refs = pool.map((_, i) => i);
    const frameRefsPerSlot = FRM_FACINGS.map(() => [...refs]);
    if (anim.sequences.length > 1) {
        report.add(
            "dropped-direction",
            `used cycle ${cycleIndex} for a single-orientation FRM; dropped ${anim.sequences.length - 1} other cycle(s)`,
        );
    }
    return { pool, frameRefsPerSlot };
}

/**
 * One IE direction block as a standalone facing-tagged source: the chosen group's slots become the
 * sequences (the interpretation already drops east dummies and empty slots), every other cycle is
 * reported dropped. Out-of-range refs (the 0xFFFF "no frame" sentinel) are filtered the way the
 * interpretation ignores them, so the directional builder never chases a sentinel into the frame table.
 */
function extractIeGroup(anim: Animation, groupIndex: number, report: LossReport): Animation {
    const group = interpretIeDirections(anim.sequences, anim.frames.length)?.groups[groupIndex];
    if (!group || group.length === 0) {
        throw new Error(
            `convertToFrm: no IE direction block ${groupIndex} in this ${anim.sequences.length}-cycle animation`,
        );
    }
    const sequences: Sequence[] = group.map((slot) => {
        const seq = anim.sequences[slot.seqIndex];
        /* v8 ignore next -- the interpretation only emits slots whose sequence exists */
        if (!seq) throw new Error(`convertToFrm: sequence ${slot.seqIndex} out of range`);
        return { frameRefs: seq.frameRefs.filter((r) => r >= 0 && r < anim.frames.length), facing: slot.facing };
    });
    report.add(
        "dropped-direction",
        `used direction block ${groupIndex} for the FRM rotations; dropped ${anim.sequences.length - group.length} other cycle(s)`,
    );
    return { ...anim, sequences };
}

/**
 * Directional slots: map the source's cycles onto the 6 FRM rotations by facing, duplicating any frame
 * shared across rotations (FRM cannot share a frame object across directions) and padding short
 * rotations to the longest with fully-transparent frames.
 */
function buildDirectionalSlots(anim: Animation, report: LossReport): { pool: Frame[]; frameRefsPerSlot: number[][] } {
    const facings = resolveFacings(anim);

    const { dropped } = partitionForFrm(facings);
    // Reject an ambiguous layout: two source directions claiming the same FRM facing cannot both occupy
    // that single slot, and keeping only the first would silently drop the other.
    const seenFrmFacings = new Set<Facing>();
    for (const f of facings) {
        if (!FRM_FACING_SET.has(f)) continue;
        if (seenFrmFacings.has(f)) {
            throw new Error(
                `convertToFrm: duplicate FRM facing "${f}" in the direction layout; each facing maps to at most one source direction`,
            );
        }
        seenFrmFacings.add(f);
    }
    for (const i of dropped) {
        const facing = facings[i];
        if (facing === undefined) throw new Error(`convertToFrm: dropped facing index ${i} out of range`);
        report.add("dropped-direction", `sequence ${i} (facing ${facing}) has no FRM slot`);
    }

    const rawSlotOrder = frmSlotOrder(facings);

    // Resolve each FRM slot's source sequence index; an unfilled (-1) slot reuses slot 0's resolved
    // source, since FRM requires all six rotation slots to be present.
    const chosenSourceIndices: number[] = [];
    for (let slot = 0; slot < FRM_FACINGS.length; slot++) {
        const raw = rawSlotOrder[slot];
        if (raw === undefined) throw new Error(`convertToFrm: missing slot order entry at ${slot}`);
        if (raw >= 0) {
            chosenSourceIndices.push(raw);
            continue;
        }
        const facingName = FRM_FACINGS[slot];
        if (facingName === undefined) throw new Error(`convertToFrm: missing FRM facing at slot ${slot}`);
        const reuseFrom = chosenSourceIndices[0] ?? 0;
        report.add("empty-direction", `FRM slot ${facingName} has no source direction; reused slot 0's sequence`);
        chosenSourceIndices.push(reuseFrom);
    }

    const chosenSequences: Sequence[] = chosenSourceIndices.map((idx) => {
        const seq = anim.sequences[idx];
        if (!seq) throw new Error(`convertToFrm: source sequence index ${idx} out of range`);
        return seq;
    });

    const pool: Frame[] = [];
    const claimedSourceIndices = new Set<number>();
    let duplicatedCount = 0;
    const frameRefsPerSlot: number[][] = chosenSequences.map((seq) => {
        const refs: number[] = [];
        for (const origIdx of seq.frameRefs) {
            const srcFrame = anim.frames[origIdx];
            if (!srcFrame) throw new Error(`convertToFrm: frame ref ${origIdx} out of range`);
            if (!claimedSourceIndices.has(origIdx)) {
                claimedSourceIndices.add(origIdx);
                pool.push(srcFrame);
            } else {
                pool.push({ ...srcFrame });
                duplicatedCount++;
            }
            refs.push(pool.length - 1);
        }
        return refs;
    });
    if (duplicatedCount > 0) {
        report.add(
            "duplicated-shared-frames",
            `${duplicatedCount} frame reference(s) duplicated to avoid cross-direction sharing`,
        );
    }

    // Pad every direction to the longest one with synthesized fully-transparent frames. The fill is
    // the SOURCE's transparent index: the palette paths below map that index to the FRM's slot 0
    // (a bare 0 would read as the source's color 0 whenever transparentIndex != 0).
    const transparent = transparentIndexOf(anim.meta);
    const maxLen = frameRefsPerSlot.reduce((max, refs) => Math.max(max, refs.length), 0);
    for (let slot = 0; slot < frameRefsPerSlot.length; slot++) {
        const refs = frameRefsPerSlot[slot];
        if (!refs) throw new Error(`convertToFrm: missing frame refs for slot ${slot}`);
        const from = refs.length;
        if (from >= maxLen) continue;
        const lastIdx = refs[refs.length - 1];
        const lastFrame = lastIdx !== undefined ? pool[lastIdx] : undefined;
        const width = lastFrame?.width ?? 1;
        const height = lastFrame?.height ?? 1;
        while (refs.length < maxLen) {
            pool.push({
                width,
                height,
                pixels: new Uint8Array(width * height).fill(transparent),
                offsetX: 0,
                offsetY: 0,
            });
            refs.push(pool.length - 1);
        }
        const facingName = FRM_FACINGS[slot];
        if (facingName === undefined) throw new Error(`convertToFrm: missing FRM facing at slot ${slot}`);
        report.add("padded-sequence", `direction ${facingName} padded from ${from} to ${maxLen} frames`);
    }

    return { pool, frameRefsPerSlot };
}

// Converts any Animation to an FRM-shaped one: 6 fixed hex rotations sharing a uniform frame count, an
// index-0-transparent palette, and no frame object shared across rotations. Already-FRM input is a
// no-op (still a new object per the shallow-clone contract, matching convertToBam).
export function convertToFrm(anim: Animation, opts?: FrmConvertOpts): { animation: Animation; report: LossReport } {
    const report = new LossReport();

    if (anim.meta.sourceFormat === "frm") {
        // Shallow clone: shares the frames/sequences/palette arrays with the input, unlike the paths
        // below. A no-op has nothing to convert, so aliasing is acceptable here.
        return { animation: { ...anim, meta: { ...anim.meta } }, report };
    }
    // Compile-time proof the no-op above covered the only non-convertible case: a 4th member of
    // SourceFormat fails this narrowing instead of silently falling through as convertible.
    anim.meta.sourceFormat satisfies "bam" | "bamc";

    if (opts?.ieGroup !== undefined && opts.singleCycle !== undefined) {
        throw new Error("convertToFrm: ieGroup and singleCycle are mutually exclusive");
    }
    // An IE multi-block source converts ONE direction block: its slots become facing-tagged sequences
    // feeding the directional path below.
    const source = opts?.ieGroup === undefined ? anim : extractIeGroup(anim, opts.ieGroup, report);

    // A non-directional single-cycle source auto-resolves to a single-orientation FRM; a multi-cycle
    // one needs an explicit cycle (opts.singleCycle) chosen by the caller.
    const singleCycle =
        opts?.singleCycle ??
        (frmDirectionMode(source) === "single-orientation" && source.sequences.length === 1 ? 0 : undefined);

    const { pool, frameRefsPerSlot } =
        singleCycle !== undefined
            ? buildSingleOrientationSlots(source, singleCycle, report)
            : buildDirectionalSlots(source, report);

    const defaultRemap = remapToDefault(pool, source.palette, transparentIndexOf(source.meta));
    let paletteFrames = defaultRemap.frames;
    let palette = defaultRemap.palette;
    if (defaultRemap.remapped) {
        report.add("palette-remapped-to-default", "palette losslessly remapped to the default Fallout palette");
    } else if (opts?.paletteMode === "nearest") {
        // Exact remap failed; lossily project every used color onto its nearest default-palette neighbor
        // instead of carrying the source palette as a sidecar.
        const nearestRemap = remapToNearest(
            { palette: source.palette, frames: pool, sequences: source.sequences, meta: source.meta },
            DEFAULT_FALLOUT_PALETTE,
        );
        paletteFrames = nearestRemap.animation.frames;
        palette = nearestRemap.animation.palette;
        report.add(
            "palette-nearest-remapped",
            "source palette could not be losslessly remapped; pixels lossily remapped to the nearest default Fallout palette color",
        );
    } else {
        report.add(
            "palette-sidecar-required",
            "source palette could not be losslessly remapped onto the default; kept as a sidecar",
        );
        // The kept palette still marks transparency at the SOURCE's index; every FRM consumer reads
        // index 0 as transparent, so re-index (lossless 0 <-> t swap) before the palette ships.
        const normalized = normalizeTransparentToZero(paletteFrames, palette, transparentIndexOf(source.meta));
        paletteFrames = normalized.frames;
        palette = normalized.palette;
    }
    // Clone rather than alias: the remapped branch returns the shared DEFAULT_FALLOUT_PALETTE constant,
    // and the sidecar branch returns anim.palette itself - either would let a caller's mutation of the
    // output palette corrupt shared state.
    const outputPalette = palette.map((c) => ({ ...c }));

    // Final frame shape: strip rawEncoding/rleEncoded unconditionally. A carried (sidecar-path) frame's
    // rawEncoding still describes source on-disk bytes (e.g. BAM RLE), which serializeFrm would otherwise
    // write verbatim as FRM pixel data and corrupt the output. The output is a PROPER feet-anchored FRM:
    // its anchor is each frame's bottom-centre, so the per-frame AND per-direction offsets are all 0.
    // (The BAM's own centre is not carried into the file; the editor re-frames the first frame to the
    // BAM's on-tile position at display time - see the webview anchor.ts.)
    const frames: Frame[] = paletteFrames.map((f) => ({
        width: f.width,
        height: f.height,
        pixels: f.pixels,
        offsetX: 0,
        offsetY: 0,
    }));

    const sequences: Sequence[] = FRM_FACINGS.map((facing, slot) => {
        const refs = frameRefsPerSlot[slot];
        if (!refs) throw new Error(`convertToFrm: missing frame refs for slot ${slot}`);
        return { frameRefs: [...refs], facing };
    });

    const animation: Animation = {
        palette: outputPalette,
        sequences,
        frames,
        meta: {
            sourceFormat: "frm",
            fps: source.meta.fps ?? 10,
            actionFrame: source.meta.actionFrame ?? 0,
            directionLayout: "frm6",
            frmVersion: 4,
            dirOffsetsX: [0, 0, 0, 0, 0, 0],
            dirOffsetsY: [0, 0, 0, 0, 0, 0],
        },
    };

    return { animation, report };
}
