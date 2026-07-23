import { type Animation, type Facing, type Frame, type Sequence, FRM_FACINGS } from "../model/animation.ts";
import { frmDirOffsetForAnchor, offsetToAnchor } from "../model/frame-anchor.ts";
import { LossReport } from "./loss-report.ts";
import { facingsForCycleCount, partitionForFrm, frmSlotOrder, FRM_FACING_SET } from "./directions.ts";
import { remapToDefault, remapToNearest } from "./palette-remap.ts";
import { DEFAULT_FALLOUT_PALETTE } from "../palette/default-palette.ts";

export interface FrmConvertOpts {
    layout?: Facing[];
    paletteMode?: "sidecar" | "nearest";
    /** Non-directional source only: the cycle index that fills all 6 FRM rotations (single-orientation). */
    singleCycle?: number;
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

function resolveFacings(anim: Animation, opts?: { layout?: Facing[] }): Facing[] {
    if (opts?.layout) {
        if (opts.layout.length !== anim.sequences.length) {
            throw new Error(
                `convertToFrm: opts.layout has ${opts.layout.length} entries, expected ${anim.sequences.length} (one per sequence)`,
            );
        }
        return [...opts.layout];
    }
    const derived = facingsForCycleCount(anim.sequences.length);
    if (derived) return derived;
    const ownFacings = anim.sequences.map((s) => s.facing);
    if (ownFacings.every((f) => f === "none")) {
        // Reached only for a multi-cycle non-directional source with no chosen cycle - the caller must
        // pass opts.singleCycle (a single-cycle source auto-resolves in convertToFrm).
        throw new Error(
            `Cannot save this ${anim.sequences.length}-cycle animation as FRM: it has no directions - choose which cycle to use for a single-orientation FRM.`,
        );
    }
    return ownFacings;
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
 * Directional slots: map the source's cycles onto the 6 FRM rotations by facing, duplicating any frame
 * shared across rotations (FRM cannot share a frame object across directions) and padding short
 * rotations to the longest with fully-transparent frames.
 */
function buildDirectionalSlots(
    anim: Animation,
    opts: { layout?: Facing[] } | undefined,
    report: LossReport,
): { pool: Frame[]; frameRefsPerSlot: number[][] } {
    const facings = resolveFacings(anim, opts);

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

    // Pad every direction to the longest one with synthesized fully-transparent frames.
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
            pool.push({ width, height, pixels: new Uint8Array(width * height), offsetX: 0, offsetY: 0 });
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

    // A non-directional single-cycle source auto-resolves to a single-orientation FRM; a multi-cycle
    // one needs an explicit cycle (opts.singleCycle) chosen by the caller.
    const singleCycle =
        opts?.singleCycle ??
        (frmDirectionMode(anim) === "single-orientation" && anim.sequences.length === 1 ? 0 : undefined);

    const { pool, frameRefsPerSlot } =
        singleCycle !== undefined
            ? buildSingleOrientationSlots(anim, singleCycle, report)
            : buildDirectionalSlots(anim, opts, report);

    const defaultRemap = remapToDefault(pool, anim.palette, anim.meta.transparentIndex ?? 0);
    let paletteFrames = defaultRemap.frames;
    let palette = defaultRemap.palette;
    if (defaultRemap.remapped) {
        report.add("palette-remapped-to-default", "palette losslessly remapped to the default Fallout palette");
    } else if (opts?.paletteMode === "nearest") {
        // Exact remap failed; lossily project every used color onto its nearest default-palette neighbor
        // instead of carrying the source palette as a sidecar.
        const nearestRemap = remapToNearest(
            { palette: anim.palette, frames: pool, sequences: anim.sequences, meta: anim.meta },
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
    }
    // Clone rather than alias: the remapped branch returns the shared DEFAULT_FALLOUT_PALETTE constant,
    // and the sidecar branch returns anim.palette itself - either would let a caller's mutation of the
    // output palette corrupt shared state.
    const outputPalette = palette.map((c) => ({ ...c }));

    // Final frame shape: strip rawEncoding/rleEncoded unconditionally. A carried (sidecar-path) frame's
    // rawEncoding still describes source on-disk bytes (e.g. BAM RLE), which serializeFrm would otherwise
    // write verbatim as FRM pixel data and corrupt the output. The per-FRAME offset is an FRM animation
    // motion delta, not the anchor, so a converted frame carries none - it is 0; the source's anchor (a
    // BAM centre) is preserved in the per-DIRECTION header offset below instead.
    const source = anim.meta.sourceFormat;
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

    // Preserve each rotation's anchor in its per-direction header offset, computed from that rotation's
    // frame-0 source anchor (a BAM centre). FRM's static anchor is per-rotation, not per-frame, so a
    // rotation whose frames have differing centres keeps only frame-0's; inter-frame motion (which would
    // live in the per-frame delta) is not carried - see INTERNALS. offsetToAnchor reads the source frame's
    // stored anchor (its BAM centre); frmDirOffsetForAnchor inverts it into FRM's header-offset field.
    const dirOffsetsX: number[] = [];
    const dirOffsetsY: number[] = [];
    for (let slot = 0; slot < FRM_FACINGS.length; slot++) {
        const first = frameRefsPerSlot[slot]?.[0];
        const f0 = first === undefined ? undefined : paletteFrames[first];
        if (!f0) {
            dirOffsetsX.push(0);
            dirOffsetsY.push(0);
            continue;
        }
        const dir = frmDirOffsetForAnchor(f0.width, f0.height, offsetToAnchor(source, f0));
        dirOffsetsX.push(dir.x);
        dirOffsetsY.push(dir.y);
    }

    const animation: Animation = {
        palette: outputPalette,
        sequences,
        frames,
        meta: {
            sourceFormat: "frm",
            fps: anim.meta.fps ?? 10,
            actionFrame: anim.meta.actionFrame ?? 0,
            directionLayout: "frm6",
            frmVersion: 4,
            dirOffsetsX,
            dirOffsetsY,
        },
    };

    return { animation, report };
}
