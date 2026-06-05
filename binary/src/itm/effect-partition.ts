/**
 * ITM effect-partition invariant + surgical effect-reference shifter.
 *
 * An ITM canonical document is FLAT: { header, abilities[], effects[] }. The
 * single flat `effects[]` array (feature blocks) is addressed by absolute index
 * from two kinds of owner:
 *   - the HEADER's equipping range: header.featureBlocksIndex (start) +
 *     header.featureBlocksCount (count);
 *   - each ABILITY's range: ability.featureBlockIndex (start) +
 *     ability.featureBlockCount (count).
 *
 * The canonical writer (ie-common/ability-effects-writer.ts) recomputes only the
 * header's derived STRUCTURAL fields (abilities count, section offsets); it
 * passes each ability's featureBlockIndex/featureBlockCount THROUGH AS-IS, and
 * the strict canonical schema validates only the header, not per-ability ranges.
 * So per-ability effect-range correctness has no built-in safety net - that is
 * what `validateEffectPartition` guards.
 *
 * --- Characterization findings (real fixtures) ------------------------------
 * Sampled all 151 .itm fixtures under external/infinity-engine/ (parsed via
 * itmParser -> getItmCanonicalDocument). For every file:
 *   (a) ORDERING: equipping range always starts at index 0; ability ranges
 *       follow in ability order (non-decreasing starts). No ordering violation.
 *   (b) CONTIGUITY: the ranges partition [0, effects.length) exactly - no gap
 *       (every index owned), no uncovered tail, no out-of-bounds range.
 *   (c) SHARING/OVERLAP: NO index is owned by more than one range in any file.
 * Zero-count ranges occur normally (equipping [0,0) when all effects are
 * ability-triggered; an ability [k,0) with no effects of its own).
 *
 * Because real data is a clean, overlap-free, contiguous, equipping-first
 * partition, the conservative SURGICAL shift model below is sufficient: an
 * edit adjusts one owner's count and shifts the starts of ranges that begin at
 * or after the edit point, never globally reordering effects. This preserves
 * byte-identical round-trip for unedited files (itm-roundtrip.test.ts).
 * `validateEffectPartition` still DETECTS overlap defensively, because a
 * hand-edited canonical doc could introduce it and overlap would make
 * remove/reorder ambiguous (one effect owned by two ranges).
 */

/** Owner of an effect index: the header equipping range, or a specific ability. */
export type EffectOwner = { kind: "equipping" } | { kind: "ability"; index: number };

/**
 * Minimal structural shape the partition functions operate on: just the header
 * equipping range, each ability's range, and the effects length. Kept
 * structurally typed (not the full zod canonical type) so lightweight doc stubs
 * and the real ItmCanonicalDocument both satisfy it.
 */
export interface EffectPartitionHeader {
    featureBlocksIndex: number;
    featureBlocksCount: number;
}

export interface EffectPartitionAbility {
    featureBlockIndex: number;
    featureBlockCount: number;
}

export interface EffectPartitionDoc<
    H extends EffectPartitionHeader = EffectPartitionHeader,
    A extends EffectPartitionAbility = EffectPartitionAbility,
> {
    header: H;
    abilities: A[];
    effects: unknown[];
}

interface OwnedRange {
    owner: EffectOwner;
    start: number;
    count: number;
}

/** All effect-owning ranges, equipping first then abilities in order. */
function ownedRanges(doc: EffectPartitionDoc): OwnedRange[] {
    const ranges: OwnedRange[] = [
        { owner: { kind: "equipping" }, start: doc.header.featureBlocksIndex, count: doc.header.featureBlocksCount },
    ];
    doc.abilities.forEach((ability, index) => {
        ranges.push({
            owner: { kind: "ability", index },
            start: ability.featureBlockIndex,
            count: ability.featureBlockCount,
        });
    });
    return ranges;
}

/**
 * For each effect index 0..effects.length-1, the owner that claims it, or
 * `undefined` if no range covers it (orphan). On overlap (an index claimed by
 * more than one range), first-owner-wins: equipping is checked before
 * abilities, and lower-indexed abilities before higher. Overlap is abnormal in
 * real data (see findings) and is separately reported by
 * `validateEffectPartition`; this resolution only keeps the return total and is
 * not a license to treat overlap as valid.
 */
export function effectOwners(doc: EffectPartitionDoc): Array<EffectOwner | undefined> {
    const n = doc.effects.length;
    const owners = Array.from<EffectOwner | undefined>({ length: n });
    for (const range of ownedRanges(doc)) {
        if (range.count <= 0) continue;
        const end = range.start + range.count;
        for (let k = range.start; k < end; k++) {
            if (k < 0 || k >= n) continue;
            if (owners[k] === undefined) owners[k] = range.owner;
        }
    }
    return owners;
}

function ownerLabel(owner: EffectOwner): string {
    return owner.kind === "equipping" ? "equipping range" : `ability ${owner.index}`;
}

/**
 * Validate the effect partition. Returns an array of human-readable issue
 * strings (empty = consistent). Detects:
 *   - a negative start index or negative count on any range;
 *   - a range whose [start, start+count) runs past effects.length (out of bounds);
 *   - an effect index owned by NO range (orphan);
 *   - overlap: an effect index owned by more than one range;
 *   - ordering: walking populated ranges in canonical owner order (equipping
 *     first, then abilities by index), their starts must be non-decreasing and
 *     tile contiguously (each populated range's start == the previous one's end).
 *     shiftEffectRefs cannot produce a violation, but external hand-editing can,
 *     and this validator defends hand-edited docs.
 */
export function validateEffectPartition(doc: EffectPartitionDoc): string[] {
    const issues: string[] = [];
    const n = doc.effects.length;
    const ranges = ownedRanges(doc);

    // Per-index owner count, for orphan + overlap detection.
    const ownerCount = Array.from<number>({ length: n }).fill(0);

    for (const range of ranges) {
        const label = ownerLabel(range.owner);
        if (range.start < 0) {
            issues.push(`${label} has negative start index ${range.start}`);
        }
        if (range.count < 0) {
            issues.push(`${label} has negative count ${range.count}`);
        }
        if (range.count <= 0) continue; // empty range claims no indices
        const end = range.start + range.count;
        if (range.start >= 0 && end > n) {
            issues.push(`${label} range [${range.start}, ${end}) runs past effects.length (${n})`);
        }
        for (let k = range.start; k < end; k++) {
            if (k >= 0 && k < n) ownerCount[k]!++;
        }
    }

    for (let k = 0; k < n; k++) {
        const c = ownerCount[k]!;
        if (c === 0) {
            issues.push(`effect index ${k} is owned by no range (orphan)`);
        } else if (c > 1) {
            issues.push(`effect index ${k} is owned by ${c} ranges (overlap)`);
        }
    }

    // Ordering/contiguity: walk POPULATED ranges (count > 0) in canonical owner
    // order. Each must start exactly where the previous populated one ended.
    // Empty ranges carry no position constraint and are skipped. This catches
    // contiguous-but-out-of-order hand edits the coverage check above accepts.
    let expectedStart = 0;
    for (const range of ranges) {
        if (range.count <= 0 || range.start < 0) continue; // negative/empty handled above
        if (range.start !== expectedStart) {
            issues.push(
                `${ownerLabel(range.owner)} starts at ${range.start} but the canonical order expects ${expectedStart} (out-of-order or non-contiguous)`,
            );
        }
        expectedStart = range.start + range.count;
    }

    return issues;
}

export interface ShiftEffectRefsArgs {
    /**
     * Effect index at which effects are inserted (delta>0) or removed (delta<0).
     * Precondition: `at` must fall within the owner's pre-edit range.
     *   - insert (delta > 0): `owner.start <= at <= owner.start + owner.count`
     *   - remove (delta < 0): `owner.start <= at < owner.start + owner.count`
     * A caller passing `at` outside the owner's range produces a result that
     * validates clean but is corrupt (the physical effect lands under a
     * different owner while the named owner's count grows). Since this module
     * is the sole guard for per-ability ranges, `shiftEffectRefs` throws on
     * violation rather than silently corrupting.
     */
    at: number;
    /** Number of effects added (positive) or removed (negative). */
    delta: number;
    /** The range that gains/loses the effects. */
    owner: EffectOwner;
}

/** Resolve the owner's pre-edit [start, count) range from the doc. */
function ownerRange(doc: EffectPartitionDoc, owner: EffectOwner): { start: number; count: number } {
    if (owner.kind === "equipping") {
        return { start: doc.header.featureBlocksIndex, count: doc.header.featureBlocksCount };
    }
    const ability = doc.abilities[owner.index];
    if (ability === undefined) {
        throw new Error(
            `shiftEffectRefs: owner ability index ${owner.index} is out of range (abilities.length ${doc.abilities.length})`,
        );
    }
    return { start: ability.featureBlockIndex, count: ability.featureBlockCount };
}

/**
 * Return a NEW doc reflecting an insert/remove of `delta` effects at index `at`
 * owned by `owner`, relinking every effect range surgically:
 *   - the owner's count is adjusted by `delta`;
 *   - every OTHER range whose START index is >= `at` is shifted by `delta`.
 *
 * Does not touch `effects` itself (the caller owns the actual array splice);
 * this only relinks the index/count references.
 *
 * Boundary semantics (the subtle cases):
 *   - "is not the owner's own start" is decided by owner IDENTITY, not by
 *     comparing start VALUES: the owner's start never shifts (the owner absorbs
 *     the change via its count), while any other range starting at or after
 *     `at` shifts. This matters when a zero-count range shares the owner's start
 *     value - identity keeps them distinct.
 *   - Insert AT a non-owner range's start (start === at): that range's content
 *     begins on or after the insertion point, so it shifts by +delta. Insert
 *     strictly inside the owner is absorbed by the owner's count and shifts only
 *     ranges that start later.
 *   - The equipping range can be the owner: its count grows/shrinks and every
 *     ability range (which by construction starts at or after the equipping
 *     range in real data) shifts.
 *   - Removing the owner's only effect drives its count to 0 (a valid empty
 *     range); later ranges shift down by 1. Callers are responsible for not
 *     driving a count negative; this function performs the arithmetic the edit
 *     describes and `validateEffectPartition` catches an inconsistent result.
 *
 * Throws when `at` falls outside the owner's pre-edit range (see
 * `ShiftEffectRefsArgs.at`) - a caller programming error that would otherwise
 * silently corrupt the file.
 */
export function shiftEffectRefs<H extends EffectPartitionHeader, A extends EffectPartitionAbility>(
    doc: EffectPartitionDoc<H, A>,
    { at, delta, owner }: ShiftEffectRefsArgs,
): EffectPartitionDoc<H, A> {
    // Precondition: `at` must land within the owner's pre-edit range. For
    // insert, `at` may sit at the owner's end boundary (appending one effect to
    // the owner); for remove, `at` must address an existing owned effect, so the
    // end boundary is exclusive. Throwing here is correct: this is the sole
    // guard for per-ability ranges, so a misattributed edit must fail loud.
    const { start: ownerStart, count: ownerCount } = ownerRange(doc, owner);
    const upperInclusive = delta >= 0; // insert/no-op tolerates the end boundary; remove does not
    const upperBound = ownerStart + ownerCount;
    const withinRange = at >= ownerStart && (upperInclusive ? at <= upperBound : at < upperBound);
    if (!withinRange) {
        throw new Error(
            `shiftEffectRefs: at=${at} is outside ${ownerLabel(owner)} range [${ownerStart}, ${upperBound})` +
                ` for delta=${delta}; the edit point must fall within the owner's pre-edit range`,
        );
    }

    const ownerIsEquipping = owner.kind === "equipping";
    // Post-edit effect count: this function is fed the PRE-splice doc, so the new
    // length is the pre-edit length plus delta. Used to clamp inert count-0 range
    // starts into [0, newEffectCount] (see shiftStart).
    const newEffectCount = doc.effects.length + delta;

    const newHeader: H = {
        ...doc.header,
        featureBlocksIndex: ownerIsEquipping
            ? doc.header.featureBlocksIndex // owner: start absorbs nothing, count carries the change
            : shiftStart(doc.header.featureBlocksIndex, doc.header.featureBlocksCount, at, delta, newEffectCount),
        featureBlocksCount: ownerIsEquipping ? doc.header.featureBlocksCount + delta : doc.header.featureBlocksCount,
    };

    const newAbilities = doc.abilities.map((ability, index): A => {
        const isOwner = owner.kind === "ability" && owner.index === index;
        return {
            ...ability,
            featureBlockIndex: isOwner
                ? ability.featureBlockIndex // owner start does not move
                : shiftStart(ability.featureBlockIndex, ability.featureBlockCount, at, delta, newEffectCount),
            featureBlockCount: isOwner ? ability.featureBlockCount + delta : ability.featureBlockCount,
        };
    });

    return { ...doc, header: newHeader, abilities: newAbilities, effects: doc.effects };
}

/**
 * Shift a non-owner range start by `delta` iff it begins at or after `at`.
 *
 * A count-0 (empty) range is positionless: it owns no effect index, so its stored
 * start is semantically inert. But the start must remain a VALID index in
 * [0, newEffectCount] - a negative or past-end start trips validateEffectPartition
 * and serializes to a bogus u16 (e.g. -1 becomes 0xFFFF). The shift can drive an
 * inert range out of bounds: an empty equipping range at start 0 shifted by an
 * owner remove at index 0 would land at -1. So count-0 ranges are CLAMPED into the
 * valid window after the raw shift.
 *
 * count>0 ranges keep the RAW shift (no clamp): a populated range driven negative
 * or past-end is a genuine relink bug, and validateEffectPartition must still trip
 * on it rather than have a clamp paper over real corruption.
 */
function shiftStart(start: number, count: number, at: number, delta: number, newEffectCount: number): number {
    const shifted = start >= at ? start + delta : start;
    if (count > 0) return shifted; // populated range: strict failsafe, no clamp
    return Math.max(0, Math.min(shifted, newEffectCount)); // inert range: keep the index valid
}
