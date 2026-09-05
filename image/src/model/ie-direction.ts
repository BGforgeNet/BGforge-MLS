// Node-free on purpose (like frame-anchor.ts): the editor webview imports this subpath directly, so it
// must never pull in node:zlib via the barrel.
import type { DirectionLayout, Facing } from "./animation.ts";

// IE stored-cycle order within an 8-slot direction block: counterclockwise from due South through West
// to North (slots 0-4), then the eastern slots (5-7). Base files leave 5-7 as dummies - the engine
// mirrors the west cycles, or a separate *E.BAM ships the east - so only E-files populate them.
// (IESDP ini_anim.htm, "Available orientations".)
const IE_SLOT_FACINGS: Facing[] = ["S", "SW", "W", "NW", "N", "NE", "E", "SE"];

/**
 * The finer scheme: nine cycles covering the western half of the 16-point wheel, counterclockwise from
 * due South to due North. The eastern seven are never stored - the engine mirrors them - so unlike the
 * 8-slot scheme there are no dummy slots and no companion east file.
 */
const IE_WEST_ARC_FACINGS: Facing[] = ["S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW", "N"];

/**
 * The whole 16-point wheel, continuing the west arc's order back round through the east.
 *
 * Not a scheme the interpreter can choose: a 16-cycle band divides evenly into two 8-slot blocks, so
 * structure alone cannot tell the readings apart. It is reachable only through `ieBandsOfStride`, whose
 * caller holds the animation's declared type and therefore knows.
 */
const IE_WHEEL_FACINGS: Facing[] = [...IE_WEST_ARC_FACINGS, "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE"];

/** Cycles per direction block in the 8-slot scheme. */
export const IE_STRIDE = 8;
/** Slots 0-4 are the stored west arc (S..N); 5-7 are the eastern slots a base file leaves as dummies. */
export const IE_WEST_SLOTS = 5;

/**
 * Which stored-cycle scheme a block follows. A BAM says nothing about this - the engine picks it from
 * the creature's animation id and its data tables, neither of which is in reach of a lone file - so it
 * is inferred from block structure, and `scheme` records which reading won.
 */
export type IeScheme = "ie8" | "ie9";

interface SchemeShape {
    scheme: IeScheme;
    facings: Facing[];
    /** Leading slots that hold real per-direction cycles; the rest are the mirrored east. */
    arc: number;
}

const SCHEMES: SchemeShape[] = [
    { scheme: "ie8", facings: IE_SLOT_FACINGS, arc: IE_WEST_SLOTS },
    { scheme: "ie9", facings: IE_WEST_ARC_FACINGS, arc: IE_WEST_ARC_FACINGS.length },
];

/** The subset of a sequence this analysis reads - satisfied by both the model's Sequence and the
 *  editor's SequenceView. */
export interface SequenceShape {
    frameRefs: number[];
    facing: Facing;
}

export interface IeDirectionSlot {
    /** Index into the animation's sequences. */
    seqIndex: number;
    facing: Facing;
}

export interface IeDirectionAnalysis {
    /** One entry per direction block: its displayable slots (empty and dummy slots dropped). */
    groups: IeDirectionSlot[][];
    /** Which stored-cycle scheme the blocks were read under. */
    scheme: IeScheme;
    /**
     * Strong fingerprint for the chosen scheme - for `ie8`, stride-8 blocks whose eastern slots are ALL
     * dummies (empty, or a single repeated frame shared across every east slot) while each block has
     * real west cycles; for `ie9`, blocks whose nine cycles all carry frames. Confident enough to
     * resolve the animation's directionLayout at parse time; weaker shapes (a lone <=8-cycle set) stay
     * interpretable but undetected.
     */
    detected: boolean;
}

/**
 * Cycles per direction block for a resolved layout - the one place the "ie9 means nine" fact lives, so
 * a consumer sizing blocks cannot disagree with the interpreter. Undefined for a layout that is not an
 * IE creature scheme.
 */
export function ieBlockSize(layout: DirectionLayout | undefined): number | undefined {
    return SCHEMES.find((s) => s.scheme === layout)?.facings.length;
}

/** The scheme a stamped layout names, or undefined when the layout is not one - the narrowing a
 *  consumer holding a `DirectionLayout` needs before passing it anywhere scheme-shaped. */
export function ieSchemeOf(layout: DirectionLayout | undefined): IeScheme | undefined {
    return SCHEMES.find((s) => s.scheme === layout)?.scheme;
}

/**
 * The one mapping from an interpretation to the layout stamped on the animation, shared by both BAM
 * parsers so v1 and v2 cannot drift. Only a detected shape earns a directional layout; a weaker one is
 * still interpretable on demand, but is not what the file is declared to be.
 */
export function directionLayoutOf(analysis: IeDirectionAnalysis | undefined): DirectionLayout {
    return analysis?.detected ? analysis.scheme : "non-directional";
}

/**
 * Interpret an untagged (all facings "none") cycle list as IE direction blocks. Returns undefined when
 * the shape maps onto no scheme's block size (tagged facings, zero cycles, or a >8 count divisible by
 * neither stride) - then only a flat cycle view makes sense.
 */
export function interpretIeDirections(sequences: SequenceShape[], frameCount: number): IeDirectionAnalysis | undefined {
    if (sequences.length === 0) return undefined;
    if (!sequences.every((seq) => seq.facing === "none")) return undefined;

    // A ref past the frame table (e.g. the 0xFFFF "no frame" sentinel some E-files carry) is no frame.
    const realRefs = (seq: SequenceShape): number[] => seq.frameRefs.filter((r) => r >= 0 && r < frameCount);
    const lengths = sequences.map((seq) => realRefs(seq).length);

    const shape = chooseScheme(sequences, lengths, realRefs);
    if (shape === undefined) return undefined;

    const detected =
        shape.scheme === "ie8"
            ? detectBaseFile(lengths, realRefs, sequences)
            : blockArcUniformity(lengths, shape.facings.length, shape.arc) === 1;

    // In a detected base file the east slots hold filler frames, not east-facing data - drop them.
    const groups = partitionBlocks(shape.facings, lengths, detected ? shape.arc : undefined);
    return { groups, scheme: shape.scheme, detected };
}

/**
 * Cut a cycle list into blocks of one facing each, dropping cycles that hold no frames.
 *
 * `arc`, when given, is how many leading slots hold real per-direction cycles; the rest are the unstored
 * east and are dropped. Absent, every non-empty slot is kept.
 */
function partitionBlocks(facings: Facing[], lengths: number[], arc?: number): IeDirectionSlot[][] {
    const stride = facings.length;
    const groups: IeDirectionSlot[][] = [];
    for (let g = 0; g < Math.ceil(lengths.length / stride); g++) {
        const slots: IeDirectionSlot[] = [];
        for (const [slot, facing] of facings.entries()) {
            const seqIndex = g * stride + slot;
            if ((lengths[seqIndex] ?? 0) === 0) continue;
            if (arc !== undefined && slot >= arc) continue;
            slots.push({ seqIndex, facing });
        }
        groups.push(slots);
    }
    return groups;
}

/** The facing order each stride stores its cycles in. */
const FACINGS_BY_STRIDE = new Map<number, Facing[]>([
    [IE_SLOT_FACINGS.length, IE_SLOT_FACINGS],
    [IE_WEST_ARC_FACINGS.length, IE_WEST_ARC_FACINGS],
    [IE_WHEEL_FACINGS.length, IE_WHEEL_FACINGS],
]);

/**
 * The facings a stride stores its cycles in, in stored order; empty for a stride no IE scheme uses.
 *
 * The one published reading of these orders, so a caller describing what a target holds names a stride
 * rather than restating the wheel - a second copy of a facing order is how two layers come to disagree
 * about which cycle is west.
 */
export function ieFacingsForStride(stride: number): readonly Facing[] {
    return FACINGS_BY_STRIDE.get(stride) ?? [];
}

/**
 * Cut a cycle list into direction bands of a stride the CALLER names, rather than one inferred.
 *
 * `interpretIeDirections` reads the stride off block structure, which is all a lone file offers - and a
 * 16-cycle band divides evenly into two 8-slot blocks, so it reads such a file as twice as many stances
 * at half the facings. A caller holding the animation's declared type knows the stride outright and
 * should say so. Returns undefined for a stride no IE scheme stores.
 */
export function ieBandsOfStride(
    sequences: SequenceShape[],
    frameCount: number,
    stride: number,
): IeDirectionSlot[][] | undefined {
    const facings = FACINGS_BY_STRIDE.get(stride);
    if (facings === undefined || sequences.length === 0) return undefined;
    const realRefs = (seq: SequenceShape): number[] => seq.frameRefs.filter((r) => r >= 0 && r < frameCount);
    const lengths = sequences.map((seq) => realRefs(seq).length);
    return partitionBlocks(facings, lengths, storedArc(stride, sequences, realRefs));
}

/**
 * How many leading slots hold real per-direction cycles.
 *
 * How much of the wheel a file stores varies with the animation, not just its stride - one quadrant set
 * ships all sixteen facings while its sibling ships ten and pads the rest - so this is read off content
 * rather than tabled. A slot is padding when its cycle is one frame repeated (or empty), the same
 * convention the base-file fingerprint reads; a slot only counts as unstored when EVERY band pads it,
 * so a stance whose east genuinely holds one frame does not drop that facing for the others.
 */
function storedArc(stride: number, sequences: SequenceShape[], realRefs: (seq: SequenceShape) => number[]): number {
    const bands = Math.ceil(sequences.length / stride);
    let arc = stride;
    for (let slot = stride - 1; slot >= 0; slot--) {
        let padded = true;
        for (let band = 0; band < bands && padded; band++) {
            const seq = sequences[band * stride + slot];
            if (seq === undefined) continue;
            // `every` is true for an empty cycle, which is the other shape padding takes.
            padded = realRefs(seq).every((ref, _, refs) => ref === refs[0]);
        }
        if (!padded) break;
        arc = slot;
    }
    // Every slot flat is a still animation, not a file that stores no directions at all.
    return arc === 0 ? stride : arc;
}

/**
 * Pick the block size the cycle list is actually laid out in.
 *
 * Both strides divide some counts (72 is nine 8-blocks or eight 9-blocks), and reading one as the other
 * silently relabels every direction. The discriminator is block-internal uniformity: one action at N
 * orientations stores the same frame count in each of its cycles, so only the true stride cuts the list
 * into blocks whose arc slots agree. A count that only one stride divides needs no contest.
 */
function chooseScheme(
    sequences: SequenceShape[],
    lengths: number[],
    realRefs: (seq: SequenceShape) => number[],
): SchemeShape | undefined {
    const count = sequences.length;
    const fits = SCHEMES.filter((s) => count % s.facings.length === 0);
    // A short lone set is a partial 8-slot block - the coarse scheme's first cycles, nothing to contest.
    if (fits.length === 0) return count < IE_STRIDE ? SCHEMES[0] : undefined;
    const [first, ...rest] = fits;
    if (first === undefined) return undefined;
    let best = first;
    let bestScore = blockArcUniformity(lengths, first.facings.length, first.arc);
    for (const shape of rest) {
        const score = blockArcUniformity(lengths, shape.facings.length, shape.arc);
        // A tie is only broken in the fine scheme's favour when both readings actually FOUND block
        // structure and the coarse one lacks its own base-file fingerprint. A tie at zero means neither
        // reading found anything - an east companion, whose west slots are empty, is the usual case -
        // and there the coarse scheme stands, being the only shape such a file can have.
        const beatsTie = bestScore > 0 && !detectBaseFile(lengths, realRefs, sequences);
        if (score > bestScore || (score === bestScore && beatsTie)) {
            best = shape;
            bestScore = score;
        }
    }
    return best;
}

/** Fraction of blocks whose arc slots all carry the same (non-zero) frame count. */
function blockArcUniformity(lengths: number[], stride: number, arc: number): number {
    const blocks = Math.floor(lengths.length / stride);
    if (blocks === 0) return 0;
    let uniform = 0;
    for (let b = 0; b < blocks; b++) {
        const first = lengths[b * stride] ?? 0;
        if (first === 0) continue;
        let same = true;
        for (let slot = 1; slot < arc; slot++) same &&= lengths[b * stride + slot] === first;
        if (same) uniform++;
    }
    return uniform / blocks;
}

/**
 * The 8-slot base-file fingerprint: every east slot (5-7) is a dummy - empty, or a constant frame, with
 * at most ONE shared filler frame across all of them (usar1ca stuffs every east slot with the same
 * frame) - while every block still has a real west cycle.
 */
function detectBaseFile(
    lengths: number[],
    realRefs: (seq: SequenceShape) => number[],
    sequences: SequenceShape[],
): boolean {
    if (lengths.length % IE_STRIDE !== 0) return false;
    const fillerRefs = new Set<number>();
    let sawEastSlot = false;
    let eastDummy = true;
    let everyBlockHasWest = true;
    for (let g = 0; g < lengths.length / IE_STRIDE; g++) {
        let blockHasWest = false;
        for (let slot = 0; slot < IE_STRIDE; slot++) {
            const index = g * IE_STRIDE + slot;
            const seq = sequences[index];
            if (!seq) continue;
            if (slot < IE_WEST_SLOTS) {
                if ((lengths[index] ?? 0) > 0) blockHasWest = true;
                continue;
            }
            sawEastSlot = true;
            const refs = realRefs(seq);
            const first = refs[0];
            if (first === undefined) continue; // empty east slot = dummy
            if (refs.every((r) => r === first)) fillerRefs.add(first);
            else eastDummy = false;
        }
        if (!blockHasWest) everyBlockHasWest = false;
    }
    return eastDummy && everyBlockHasWest && sawEastSlot && fillerRefs.size <= 1;
}
