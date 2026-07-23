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

interface SlotBuild {
    pool: Frame[];
    frameRefsPerSlot: number[][];
    dirOffsetsX: number[];
    dirOffsetsY: number[];
}

/** The union of a rotation's frames' boxes relative to the source's centre anchor (offsetX/offsetY);
 *  undefined for an empty rotation. */
interface AnchorBox {
    left: number;
    top: number;
    right: number;
    bottom: number;
}

function measureAnchorBox(pool: Frame[], refs: number[]): AnchorBox | undefined {
    if (refs.length === 0) return undefined;
    const box: AnchorBox = { left: Infinity, top: Infinity, right: -Infinity, bottom: -Infinity };
    for (const ref of refs) {
        const f = pool[ref];
        /* v8 ignore next -- callers build refs against the pool they pass */
        if (!f) throw new Error(`convertToFrm: frame ref ${ref} out of range`);
        box.left = Math.min(box.left, -f.offsetX);
        box.top = Math.min(box.top, -f.offsetY);
        box.right = Math.max(box.right, f.width - f.offsetX);
        box.bottom = Math.max(box.bottom, f.height - f.offsetY);
    }
    return box;
}

/**
 * Re-compose one rotation's frames onto a single shared canvas covering the union of their
 * anchor-aligned boxes. An FRM frame anchors statically at its own bottom-centre - the per-frame
 * offset is a motion delta, not an alignment channel - so frames of differing size or asymmetric
 * overhang would jitter around the anchor as the animation plays; identical geometry per rotation
 * removes the variance for the game and for every viewer. `bottom` is the anchor-relative bottom
 * edge SHARED across the whole conversion, so every rotation's feet line sits the same distance
 * below the anchor and the sprite stays put when turning. Replaces the composed pool entries in
 * place; returns the direction header x-offset that puts the bottom-CENTRE anchor on the content's
 * horizontal anchor column (the vertical anchor stays the canvas bottom - a proper feet-anchored FRM).
 */
function composeUniformCanvas(
    pool: Frame[],
    refs: number[],
    transparent: number,
    box: AnchorBox,
    bottom: number,
): number {
    const width = box.right - box.left;
    const height = bottom - box.top;
    for (const ref of refs) {
        const f = pool[ref];
        /* v8 ignore next -- same refs as the measuring pass */
        if (!f) throw new Error(`convertToFrm: frame ref ${ref} out of range`);
        const pixels = new Uint8Array(width * height).fill(transparent);
        const dx = -f.offsetX - box.left;
        const dy = -f.offsetY - box.top;
        for (let y = 0; y < f.height; y++) {
            pixels.set(f.pixels.subarray(y * f.width, (y + 1) * f.width), (dy + y) * width + dx);
        }
        pool[ref] = { width, height, pixels, offsetX: 0, offsetY: 0 };
    }
    return Math.round(width / 2 + box.left);
}

/**
 * Single-orientation slots: all six rotations share the chosen cycle's one animation. The pool holds
 * that cycle's frames once and every slot references the IDENTICAL frame-ref list, so serializeFrm
 * writes equal data_offsets (the FRM spec's shared-rotation form) rather than six copies.
 */
function buildSingleOrientationSlots(anim: Animation, cycleIndex: number, report: LossReport): SlotBuild {
    const seq = anim.sequences[cycleIndex];
    if (!seq) throw new Error(`convertToFrm: single-orientation cycle index ${cycleIndex} out of range`);
    const pool: Frame[] = seq.frameRefs.map((ref) => {
        const frame = anim.frames[ref];
        if (!frame) throw new Error(`convertToFrm: frame ref ${ref} out of range`);
        return frame;
    });
    const refs = pool.map((_, i) => i);
    // One composition covers all six slots - they share the identical ref list, so the canvas (and
    // thus the direction offset) is the same for every rotation.
    const box = measureAnchorBox(pool, refs);
    const dirOffsetX = box ? composeUniformCanvas(pool, refs, transparentIndexOf(anim.meta), box, box.bottom) : 0;
    const frameRefsPerSlot = FRM_FACINGS.map(() => [...refs]);
    if (anim.sequences.length > 1) {
        report.add(
            "dropped-direction",
            `used cycle ${cycleIndex} for a single-orientation FRM; dropped ${anim.sequences.length - 1} other cycle(s)`,
        );
    }
    return {
        pool,
        frameRefsPerSlot,
        dirOffsetsX: FRM_FACINGS.map(() => dirOffsetX),
        dirOffsetsY: FRM_FACINGS.map(() => 0),
    };
}

// Eastern FRM rotations and the stored west cycle each mirrors across the vertical axis - what the
// engine does at render time for animations without a *E companion file.
const MIRROR_EAST: ReadonlyArray<{ east: Facing; west: Facing }> = [
    { east: "NE", west: "NW" },
    { east: "E", west: "W" },
    { east: "SE", west: "SW" },
];

/** Horizontal flip. A BAM anchor is the centre PIXEL (offsetX = centerX), so it mirrors with the row. */
function mirrorFrame(frame: Frame): Frame {
    const pixels = new Uint8Array(frame.width * frame.height);
    for (let y = 0; y < frame.height; y++) {
        for (let x = 0; x < frame.width; x++) {
            pixels[y * frame.width + (frame.width - 1 - x)] = frame.pixels[y * frame.width + x] ?? 0;
        }
    }
    return {
        width: frame.width,
        height: frame.height,
        pixels,
        offsetX: frame.width - 1 - frame.offsetX,
        offsetY: frame.offsetY,
    };
}

/**
 * One IE direction block as a standalone facing-tagged source: the chosen group's slots become the
 * sequences (the interpretation already drops east dummies and empty slots), every other cycle is
 * reported dropped. An eastern slot the block does not store (a base file without its *E companion
 * loaded) is synthesized by mirroring its west counterpart, matching engine playback. Out-of-range
 * refs (the 0xFFFF "no frame" sentinel) are filtered the way the interpretation ignores them, so the
 * directional builder never chases a sentinel into the frame table.
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

    const frames = [...anim.frames];
    const mirroredByRef = new Map<number, number>();
    const present = new Set(sequences.map((s) => s.facing));
    const mirrored: Facing[] = [];
    for (const { east, west } of MIRROR_EAST) {
        if (present.has(east)) continue;
        const source = sequences.find((s) => s.facing === west);
        if (!source) continue;
        const refs = source.frameRefs.map((ref) => {
            let mirroredRef = mirroredByRef.get(ref);
            if (mirroredRef === undefined) {
                const frame = frames[ref];
                /* v8 ignore next -- source refs were range-filtered above */
                if (!frame) throw new Error(`convertToFrm: frame ref ${ref} out of range`);
                frames.push(mirrorFrame(frame));
                mirroredRef = frames.length - 1;
                mirroredByRef.set(ref, mirroredRef);
            }
            return mirroredRef;
        });
        sequences.push({ frameRefs: refs, facing: east });
        mirrored.push(east);
    }
    if (mirrored.length > 0) {
        report.add(
            "mirrored-directions",
            `eastern rotation(s) ${mirrored.join("/")} mirrored from the west cycles (the block stores no eastern data)`,
        );
    }
    return { ...anim, frames, sequences };
}

/**
 * Directional slots: map the source's cycles onto the 6 FRM rotations by facing, duplicating any frame
 * shared across rotations (FRM cannot share a frame object across directions) and padding short
 * rotations to the longest with fully-transparent frames.
 */
function buildDirectionalSlots(anim: Animation, report: LossReport): SlotBuild {
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

    const transparent = transparentIndexOf(anim.meta);

    // Uniform canvas per rotation BEFORE padding, so the pads below inherit the canvas geometry
    // (they size themselves from the rotation's last frame). Pool entries are exclusive to their
    // slot (the claim/duplicate loop above), so the in-place composition cannot cross rotations.
    // The bottom extent is shared across rotations: feet lines coincide when the sprite turns.
    const boxes = frameRefsPerSlot.map((refs) => measureAnchorBox(pool, refs));
    const sharedBottom = boxes.reduce((max, box) => Math.max(max, box?.bottom ?? -Infinity), -Infinity);
    const dirOffsetsX: number[] = [];
    const dirOffsetsY: number[] = [];
    for (let slot = 0; slot < frameRefsPerSlot.length; slot++) {
        const box = boxes[slot];
        const refs = frameRefsPerSlot[slot];
        dirOffsetsX.push(box && refs ? composeUniformCanvas(pool, refs, transparent, box, sharedBottom) : 0);
        dirOffsetsY.push(0);
    }

    // Pad every direction to the longest one with synthesized fully-transparent frames. The fill is
    // the SOURCE's transparent index: the palette paths below map that index to the FRM's slot 0
    // (a bare 0 would read as the source's color 0 whenever transparentIndex != 0).
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

    return { pool, frameRefsPerSlot, dirOffsetsX, dirOffsetsY };
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

    const { pool, frameRefsPerSlot, dirOffsetsX, dirOffsetsY } =
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
    // write verbatim as FRM pixel data and corrupt the output. Per-frame offsets stay 0 (they are
    // motion deltas in FRM); each rotation's frames already share one uniform canvas, and the source's
    // centre anchor is carried by the per-DIRECTION header offsets computed in composeUniformCanvas.
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
            dirOffsetsX,
            dirOffsetsY,
        },
    };

    return { animation, report };
}
