import { type Animation, type Facing, type Frame, type Sequence, FRM_FACINGS } from "../model/animation.ts";
import { LossReport } from "./loss-report.ts";
import { facingsForCycleCount, partitionForFrm, frmSlotOrder, FRM_FACING_SET } from "./directions.ts";
import { remapToDefault, remapToNearest } from "./palette-remap.ts";
import { DEFAULT_FALLOUT_PALETTE } from "../palette/default-palette.ts";

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
        throw new Error(
            `convertToFrm: ${anim.sequences.length}-cycle BAM has no standard direction mapping; pass opts.layout (one facing per cycle)`,
        );
    }
    return ownFacings;
}

// Converts any Animation to an FRM-shaped one: 6 fixed hex directions, uniform frame count per
// direction, no frame shared across directions, index-0-transparent palette. Already-FRM input
// is a no-op (still a new object per the shallow-clone contract, matching convertToBam).
export function convertToFrm(
    anim: Animation,
    opts?: { layout?: Facing[]; paletteMode?: "sidecar" | "nearest" },
): { animation: Animation; report: LossReport } {
    const report = new LossReport();

    if (anim.meta.sourceFormat === "frm") {
        // Shallow clone: shares frames/sequences/palette arrays with the input, unlike the conversion
        // paths below which deep-copy. A no-op has nothing to convert, so aliasing is acceptable here.
        return { animation: { ...anim, meta: { ...anim.meta } }, report };
    }

    const facings = resolveFacings(anim, opts);

    const { dropped } = partitionForFrm(facings);
    // Reject an ambiguous layout: two source directions claiming the same FRM facing cannot both
    // occupy that single FRM slot, and keeping only the first would silently drop the other with no
    // record. (Unreachable from the sourced 6/8-cycle paths, whose facings are unique.)
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

    // Resolve each FRM slot's source sequence index; an unfilled (-1) slot reuses slot 0's
    // resolved source, since FRM requires all six directions to be present.
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

    // Build the 6 output frame-ref lists, duplicating any frame referenced more than once across
    // (or within) the chosen sequences - FRM cannot share frame objects across directions.
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

    const defaultRemap = remapToDefault(pool, anim.palette, anim.meta.transparentIndex ?? 0);
    let paletteFrames = defaultRemap.frames;
    let palette = defaultRemap.palette;
    if (defaultRemap.remapped) {
        report.add("palette-remapped-to-default", "palette losslessly remapped to the default Fallout palette");
    } else if (opts?.paletteMode === "nearest") {
        // Exact remap failed; lossily project every used color onto its nearest default-palette
        // neighbor instead of carrying the source palette as a sidecar.
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
    // Clone rather than alias: the remapped branch returns the shared DEFAULT_FALLOUT_PALETTE
    // constant, and the sidecar branch returns anim.palette itself - either would let a caller's
    // mutation of the output palette corrupt shared state.
    const outputPalette = palette.map((c) => ({ ...c }));

    // Final frame shape: strip rawEncoding/rleEncoded unconditionally. A carried (sidecar-path)
    // frame's rawEncoding still describes source on-disk bytes (e.g. BAM RLE), which serializeFrm
    // would otherwise write verbatim as FRM pixel data and corrupt the output.
    const frames: Frame[] = paletteFrames.map((f) => ({
        width: f.width,
        height: f.height,
        pixels: f.pixels,
        offsetX: f.offsetX,
        offsetY: f.offsetY,
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
            fps: anim.meta.fps ?? 10,
            actionFrame: anim.meta.actionFrame ?? 0,
            directionLayout: "frm6",
            frmVersion: 4,
            dirOffsetsX: [0, 0, 0, 0, 0, 0],
            dirOffsetsY: [0, 0, 0, 0, 0, 0],
        },
    };

    return { animation, report };
}
