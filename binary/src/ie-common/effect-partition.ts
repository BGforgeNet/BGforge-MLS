/**
 * IE effect-partition invariant + surgical effect-reference shifter, shared by
 * the IE ability+effects formats (ITM, SPL).
 *
 * An IE canonical document is FLAT: { header, abilities[], effects[] }. The
 * single flat `effects[]` array (feature blocks) is addressed by absolute index
 * from two kinds of owner:
 *   - the HEADER's equipping range: a start field + a count field;
 *   - each ABILITY's range: a start field + a count field.
 *
 * ITM and SPL differ ONLY in the names of those four fields. The names are
 * injected via `IeEffectRangeFields` rather than hardcoded, so one body serves
 * both formats; every field read/write goes through the guarded `readNum` /
 * `setNum` accessors below.
 *
 * The canonical writer (ie-common/ability-effects-writer.ts) recomputes only the
 * header's derived STRUCTURAL fields (abilities count, section offsets); it
 * passes each ability's range start/count THROUGH AS-IS, and the strict
 * canonical schema validates only the header, not per-ability ranges. So
 * per-ability effect-range correctness has no built-in safety net - that is what
 * `validateEffectPartition` guards.
 *
 * --- Characterization findings (real fixtures) ------------------------------
 * These findings are ITM-specific: sampled all 151 .itm fixtures under
 * external/infinity-engine/ (parsed via itmParser -> getItmCanonicalDocument).
 * SPL shares the same engine model (an equipping/casting-first contiguous
 * feature-block layout) and is expected to hold the same invariant; it is
 * characterized separately against real .spl fixtures by a later step. For every
 * sampled file:
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

/**
 * Names the doc fields the partition/relink logic reads and writes, per format.
 *
 * The header equipping range (`headerStart`/`headerCount`) is OPTIONAL: ITM/SPL
 * have a header-level equipping/casting effect range that always sits first;
 * CRE's spellMemInfo->memorizedSpells relationship has NO such header range
 * (memorizedSpells is partitioned entirely by the per-owner spellMemInfo ranges).
 * Omit both header fields for the headerless case; supply both or neither.
 */
export interface IeEffectRangeFields {
    readonly headerStart?: string; // ITM "featureBlocksIndex" / SPL "castingFeatureBlocksIndex"; omit for CRE memo
    readonly headerCount?: string; // ITM "featureBlocksCount" / SPL "castingFeatureBlocksCount"; omit for CRE memo
    readonly abilityStart: string; // ITM "featureBlockIndex" / SPL "featureBlocksOffset" / CRE "firstMemorizedSpellIndex"
    readonly abilityCount: string; // ITM "featureBlockCount" / SPL "featureBlocksCount" / CRE "memorizedSpellCount"
}

/** Tuning for the partition factory. */
export interface EffectPartitionOptions {
    /**
     * When true (default), `validateEffectPartition` additionally requires the
     * populated ranges to tile contiguously in canonical owner order (the proven
     * ITM/SPL equipping-first invariant). CRE's memorization partition is complete
     * and non-overlapping but NOT necessarily owner-ordered (quayle4/quayle6
     * fixtures), so CRE passes false to keep the coverage/overlap/bounds checks
     * while dropping the ordering walk.
     */
    readonly requireContiguousOrder?: boolean;
    /** Diagnostic noun for a per-owner range ("ability" for ITM/SPL, "memorization entry" for CRE). Default "ability". */
    readonly ownerNoun?: string;
}

/** Loosely-typed structural views: a range record is any object carrying the named numeric fields. */
type RangeRecord = Record<string, unknown>;

export interface EffectPartitionDoc<H extends RangeRecord = RangeRecord, A extends RangeRecord = RangeRecord> {
    header: H;
    abilities: A[];
    effects: unknown[];
}

/**
 * Read a numeric range field by name. Throws on a non-number: the partition logic is the sole guard for effect
 * ranges, so a missing/malformed field must fail loud rather than coerce. Isolates the only narrowing the field-name
 * indirection needs.
 */
export function readNum(obj: RangeRecord, field: string): number {
    const v = obj[field];
    if (typeof v !== "number") {
        throw new TypeError(`effect-partition: expected numeric field "${field}" on range record, got ${typeof v}`);
    }
    return v;
}

/**
 * Return a copy of `obj` with `field` set to `value`. The `as T` is required because a computed-key spread widens the
 * inferred type; `field` is always one of the doc's own numeric range fields, so the runtime shape is unchanged. The
 * cast is isolated here so callers stay assertion-free.
 */
function setNum<T extends RangeRecord>(obj: T, field: string, value: number): T {
    return { ...obj, [field]: value } as T;
}

/** Owner of an effect index: the header equipping range, or a specific ability. */
export type EffectOwner = { kind: "equipping" } | { kind: "ability"; index: number };

interface OwnedRange {
    owner: EffectOwner;
    start: number;
    count: number;
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

export function createEffectPartition<H extends RangeRecord = RangeRecord, A extends RangeRecord = RangeRecord>(
    fields: IeEffectRangeFields,
    options: EffectPartitionOptions = {},
) {
    const { requireContiguousOrder = true, ownerNoun = "ability" } = options;
    // Supply both header fields or neither; partial config is a programming error.
    if ((fields.headerStart === undefined) !== (fields.headerCount === undefined)) {
        throw new Error("createEffectPartition: headerStart and headerCount must be supplied together or both omitted");
    }
    // Single narrowable handle for the optional equipping-range field names: present
    // for ITM/SPL, undefined for CRE memorization. Bundling the two names lets TS
    // narrow both at once at each `if (headerFields)` guard (no non-null assertions).
    const headerFields =
        fields.headerStart !== undefined && fields.headerCount !== undefined
            ? { start: fields.headerStart, count: fields.headerCount }
            : undefined;

    function ownerLabel(owner: EffectOwner): string {
        return owner.kind === "equipping" ? "equipping range" : `${ownerNoun} ${owner.index}`;
    }

    /** All effect-owning ranges, equipping first (when present) then abilities in order. */
    function ownedRanges(doc: EffectPartitionDoc<H, A>): OwnedRange[] {
        const ranges: OwnedRange[] = [];
        if (headerFields) {
            ranges.push({
                owner: { kind: "equipping" },
                start: readNum(doc.header, headerFields.start),
                count: readNum(doc.header, headerFields.count),
            });
        }
        doc.abilities.forEach((ability, index) => {
            ranges.push({
                owner: { kind: "ability", index },
                start: readNum(ability, fields.abilityStart),
                count: readNum(ability, fields.abilityCount),
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
    function effectOwners(doc: EffectPartitionDoc<H, A>): Array<EffectOwner | undefined> {
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
    function validateEffectPartition(doc: EffectPartitionDoc<H, A>): string[] {
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
        //
        // Gated by requireContiguousOrder: CRE's memorization partition is complete
        // and non-overlapping but may be laid out out of owner order (quayle4/6), so
        // CRE drops this walk while keeping the coverage/overlap/bounds checks above.
        if (requireContiguousOrder) {
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
        }

        return issues;
    }

    /** Resolve the owner's pre-edit [start, count) range from the doc. */
    function ownerRange(doc: EffectPartitionDoc<H, A>, owner: EffectOwner): { start: number; count: number } {
        if (owner.kind === "equipping") {
            if (!headerFields) {
                throw new Error("shiftEffectRefs: equipping owner used on a headerless partition (no header range)");
            }
            return { start: readNum(doc.header, headerFields.start), count: readNum(doc.header, headerFields.count) };
        }
        const ability = doc.abilities[owner.index];
        if (ability === undefined) {
            throw new Error(
                `shiftEffectRefs: owner ability index ${owner.index} is out of range (abilities.length ${doc.abilities.length})`,
            );
        }
        return { start: readNum(ability, fields.abilityStart), count: readNum(ability, fields.abilityCount) };
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
    function shiftEffectRefs(
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

        // Headerless partition (CRE memo): there is no header range to shift; the
        // header is passed through untouched and every owner is an "ability".
        const newHeader: H = !headerFields
            ? doc.header
            : ((): H => {
                  const hStart = readNum(doc.header, headerFields.start);
                  const hCount = readNum(doc.header, headerFields.count);
                  return setNum(
                      setNum(
                          doc.header,
                          headerFields.start,
                          ownerIsEquipping
                              ? hStart // owner: start absorbs nothing, count carries the change
                              : shiftStart(hStart, hCount, at, delta, newEffectCount),
                      ),
                      headerFields.count,
                      ownerIsEquipping ? hCount + delta : hCount,
                  );
              })();

        const newAbilities = doc.abilities.map((ability, index): A => {
            const isOwner = owner.kind === "ability" && owner.index === index;
            const abilityStart = readNum(ability, fields.abilityStart);
            const abilityCount = readNum(ability, fields.abilityCount);
            return setNum(
                setNum(
                    ability,
                    fields.abilityStart,
                    isOwner
                        ? abilityStart // owner start does not move
                        : shiftStart(abilityStart, abilityCount, at, delta, newEffectCount),
                ),
                fields.abilityCount,
                isOwner ? abilityCount + delta : abilityCount,
            );
        });

        return { ...doc, header: newHeader, abilities: newAbilities, effects: doc.effects };
    }

    /**
     * Re-derive every ability's start as a running offset over the flat effects
     * array, returning a NEW doc (no mutation of the input).
     *
     * The equipping range always sits first (index 0); abilities own contiguous
     * slices in order after it. So the authoritative layout is fully determined by
     * the per-owner COUNTS: walk equipping, then each ability in order, advancing a
     * running cursor by each owner's count and stamping the cursor as that owner's
     * start.
     *
     * Why re-derive instead of shiftEffectRefs: an ability op moves a whole effect
     * SLICE (reorder swaps two adjacent slices, duplicate clones one, remove deletes
     * an owner entirely). shiftEffectRefs is a per-position count adjust around a
     * single edit point; it cannot express a slice move or an owner vanishing.
     * Running-offset re-derivation from the counts is the slice-correct relink and
     * is safe because the contiguous-in-order, equipping-first invariant is proven
     * to hold for all real IE data (see the characterization findings above). It is
     * idempotent: on an unedited doc it reproduces the identical indices, so a no-op
     * round-trips byte-identically.
     *
     * The caller is responsible for keeping each ability's count in sync with the
     * actual effects slice it splices; this helper trusts those counts.
     */
    function relinkAbilityEffectIndices(doc: EffectPartitionDoc<H, A>): EffectPartitionDoc<H, A> {
        // Running offset starts after the equipping range's count (0 when headerless).
        let running = headerFields ? readNum(doc.header, headerFields.count) : 0;
        const abilities = doc.abilities.map((ability) => {
            const next = setNum(ability, fields.abilityStart, running);
            running += readNum(ability, fields.abilityCount);
            return next;
        });
        return {
            ...doc,
            header: headerFields ? setNum(doc.header, headerFields.start, 0) : doc.header,
            abilities,
        };
    }

    return { effectOwners, validateEffectPartition, shiftEffectRefs, relinkAbilityEffectIndices };
}
