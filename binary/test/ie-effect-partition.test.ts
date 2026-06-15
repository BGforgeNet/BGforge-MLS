import { describe, expect, it } from "vitest";
import { createEffectPartition, type IeEffectRangeFields } from "../src/ie-common/effect-partition";

// The header equipping range is optional in IeEffectRangeFields (CRE memo omits it).
// The ITM/SPL describe.each block always supplies it, so this local type narrows the
// header fields to required strings - keeping them usable as computed property keys.
interface FullRangeFields extends IeEffectRangeFields {
    readonly headerStart: string;
    readonly headerCount: string;
}

const ITM_FIELDS: FullRangeFields = {
    headerStart: "featureBlocksIndex",
    headerCount: "featureBlocksCount",
    abilityStart: "featureBlockIndex",
    abilityCount: "featureBlockCount",
};

const SPL_FIELDS: FullRangeFields = {
    headerStart: "castingFeatureBlocksIndex",
    headerCount: "castingFeatureBlocksCount",
    abilityStart: "featureBlocksOffset",
    abilityCount: "featureBlocksCount",
};

function makeDoc(fields: FullRangeFields) {
    return (equip: [number, number], abilities: Array<[number, number]>, effectCount: number) => ({
        header: { [fields.headerStart]: equip[0], [fields.headerCount]: equip[1] },
        abilities: abilities.map(([start, count]) => ({ [fields.abilityStart]: start, [fields.abilityCount]: count })),
        effects: Array.from({ length: effectCount }, (_, i) => i),
    });
}

describe.each([
    { label: "ITM", fields: ITM_FIELDS },
    { label: "SPL", fields: SPL_FIELDS },
])("effect-partition ($label config)", ({ fields }) => {
    const { effectOwners, validateEffectPartition, shiftEffectRefs, relinkAbilityEffectIndices } =
        createEffectPartition(fields);
    const doc = makeDoc(fields);

    describe("validateEffectPartition", () => {
        it("accepts an in-order contiguous partition", () => {
            expect(
                validateEffectPartition(
                    doc(
                        [0, 2],
                        [
                            [2, 1],
                            [3, 2],
                        ],
                        5,
                    ),
                ),
            ).toEqual([]);
        });
        it("accepts an empty effects array with zero-count ranges", () => {
            expect(validateEffectPartition(doc([0, 0], [[0, 0]], 0))).toEqual([]);
        });
        it("accepts an ability with a zero-count range", () => {
            expect(validateEffectPartition(doc([0, 3], [[3, 0]], 3))).toEqual([]);
        });
        it("flags an orphan tail", () => {
            expect(
                validateEffectPartition(
                    doc(
                        [0, 2],
                        [
                            [2, 1],
                            [3, 1],
                        ],
                        5,
                    ),
                ).length,
            ).toBeGreaterThan(0);
        });
        it("flags a range past effects.length", () => {
            expect(validateEffectPartition(doc([0, 2], [[2, 5]], 4)).length).toBeGreaterThan(0);
        });
        it("flags a negative index", () => {
            expect(validateEffectPartition(doc([-1, 2], [], 2)).length).toBeGreaterThan(0);
        });
        it("flags a negative count", () => {
            expect(validateEffectPartition(doc([0, -2], [], 2)).length).toBeGreaterThan(0);
        });
        it("flags equipping/ability overlap", () => {
            expect(validateEffectPartition(doc([0, 3], [[2, 3]], 5)).length).toBeGreaterThan(0);
        });
        it("flags two-ability overlap", () => {
            expect(
                validateEffectPartition(
                    doc(
                        [0, 0],
                        [
                            [0, 3],
                            [2, 3],
                        ],
                        5,
                    ),
                ).length,
            ).toBeGreaterThan(0);
        });
        it("flags a contiguous-but-out-of-order partition", () => {
            expect(validateEffectPartition(doc([3, 2], [[0, 3]], 5)).length).toBeGreaterThan(0);
        });
    });

    describe("effectOwners", () => {
        it("assigns each effect index to its owning range", () => {
            expect(
                effectOwners(
                    doc(
                        [0, 2],
                        [
                            [2, 1],
                            [3, 2],
                        ],
                        5,
                    ),
                ),
            ).toEqual([
                { kind: "equipping" },
                { kind: "equipping" },
                { kind: "ability", index: 0 },
                { kind: "ability", index: 1 },
                { kind: "ability", index: 1 },
            ]);
        });
        it("leaves an orphan index undefined", () => {
            expect(
                effectOwners(
                    doc(
                        [0, 2],
                        [
                            [2, 1],
                            [3, 1],
                        ],
                        5,
                    ),
                )[4],
            ).toBeUndefined();
        });
    });

    describe("shiftEffectRefs", () => {
        it("grows the owner count and shifts later ranges on insert", () => {
            const after = shiftEffectRefs(
                doc(
                    [0, 2],
                    [
                        [2, 1],
                        [3, 2],
                    ],
                    5,
                ),
                {
                    at: 3,
                    delta: 1,
                    owner: { kind: "ability", index: 1 },
                },
            );
            expect(after.abilities[1]![fields.abilityCount]).toBe(3);
            expect(after.abilities[1]![fields.abilityStart]).toBe(3);
            expect(after.abilities[0]![fields.abilityStart]).toBe(2);
        });
        it("shifts a later ability when an earlier ability grows", () => {
            const after = shiftEffectRefs(
                doc(
                    [0, 2],
                    [
                        [2, 2],
                        [4, 1],
                    ],
                    5,
                ),
                {
                    at: 4,
                    delta: 1,
                    owner: { kind: "ability", index: 0 },
                },
            );
            expect(after.abilities[0]![fields.abilityCount]).toBe(3);
            expect(after.abilities[1]![fields.abilityStart]).toBe(5);
        });
        it("shrinks the owner and shifts later ranges down on remove", () => {
            const after = shiftEffectRefs(
                doc(
                    [0, 2],
                    [
                        [2, 2],
                        [4, 1],
                    ],
                    5,
                ),
                {
                    at: 2,
                    delta: -1,
                    owner: { kind: "ability", index: 0 },
                },
            );
            expect(after.abilities[0]![fields.abilityCount]).toBe(1);
            expect(after.abilities[1]![fields.abilityStart]).toBe(3);
        });
        it("grows the equipping range and shifts all ability starts", () => {
            const after = shiftEffectRefs(
                doc(
                    [0, 2],
                    [
                        [2, 1],
                        [3, 2],
                    ],
                    5,
                ),
                {
                    at: 2,
                    delta: 1,
                    owner: { kind: "equipping" },
                },
            );
            expect(after.header[fields.headerCount]).toBe(3);
            expect(after.header[fields.headerStart]).toBe(0);
            expect(after.abilities[0]![fields.abilityStart]).toBe(3);
            expect(after.abilities[1]![fields.abilityStart]).toBe(4);
        });
        it("does not mutate the input", () => {
            const input = doc(
                [0, 2],
                [
                    [2, 1],
                    [3, 2],
                ],
                5,
            );
            const before = JSON.stringify(input);
            shiftEffectRefs(input, { at: 3, delta: 1, owner: { kind: "ability", index: 1 } });
            expect(JSON.stringify(input)).toBe(before);
        });
        it("throws when the edit point is outside the owner's range", () => {
            expect(() =>
                shiftEffectRefs(doc([0, 2], [[2, 3]], 5), { at: 1, delta: 1, owner: { kind: "ability", index: 0 } }),
            ).toThrow();
        });
        it("throws when removing at the owner's exclusive end boundary", () => {
            expect(() =>
                shiftEffectRefs(doc([0, 2], [[2, 2]], 4), { at: 4, delta: -1, owner: { kind: "ability", index: 0 } }),
            ).toThrow();
        });
        it("clamps an empty equipping range to 0 instead of -1 on owner remove at index 0", () => {
            const after = shiftEffectRefs(doc([0, 0], [[0, 1]], 1), {
                at: 0,
                delta: -1,
                owner: { kind: "ability", index: 0 },
            });
            expect(after.header[fields.headerStart]).toBe(0);
            expect(after.header[fields.headerCount]).toBe(0);
            expect(after.abilities[0]![fields.abilityStart]).toBe(0);
            expect(after.abilities[0]![fields.abilityCount]).toBe(0);
            expect(validateEffectPartition({ ...after, effects: [] })).toEqual([]);
        });
        it("keeps an empty equipping range valid (clamped) on owner insert at index 0", () => {
            const after = shiftEffectRefs(doc([0, 0], [[0, 1]], 1), {
                at: 0,
                delta: 1,
                owner: { kind: "ability", index: 0 },
            });
            expect(after.header[fields.headerCount]).toBe(0);
            expect(after.header[fields.headerStart]).toBe(1);
            expect(after.abilities[0]![fields.abilityStart]).toBe(0);
            expect(after.abilities[0]![fields.abilityCount]).toBe(2);
            expect(validateEffectPartition({ ...after, effects: [0, 0] })).toEqual([]);
        });
    });

    describe("relinkAbilityEffectIndices", () => {
        it("re-derives ability starts as a running offset after the equipping range", () => {
            const relinked = relinkAbilityEffectIndices(
                doc(
                    [0, 2],
                    [
                        [99, 1],
                        [99, 2],
                    ],
                    5,
                ),
            );
            expect(relinked.header[fields.headerStart]).toBe(0);
            expect(relinked.abilities[0]![fields.abilityStart]).toBe(2);
            expect(relinked.abilities[1]![fields.abilityStart]).toBe(3);
        });
    });
});

// ---------------------------------------------------------------------------
// Headerless + orderless config (CRE memorization: spellMemInfo -> memorizedSpells).
// No header equipping range; the partition may be complete-but-out-of-owner-order
// (quayle4/6 fixtures), so requireContiguousOrder is false.
// ---------------------------------------------------------------------------
const CRE_MEMO_FIELDS: IeEffectRangeFields = {
    abilityStart: "firstMemorizedSpellIndex",
    abilityCount: "memorizedSpellCount",
};

describe("effect-partition (headerless, orderless CRE memo config)", () => {
    const { effectOwners, validateEffectPartition, shiftEffectRefs } = createEffectPartition(CRE_MEMO_FIELDS, {
        requireContiguousOrder: false,
        ownerNoun: "memorization entry",
    });
    // No header range: doc.header carries no range fields; owners are the abilities array.
    const memoDoc = (owners: Array<[number, number]>, total: number) => ({
        header: {},
        abilities: owners.map(([start, count]) => ({
            firstMemorizedSpellIndex: start,
            memorizedSpellCount: count,
        })),
        effects: Array.from({ length: total }, (_, i) => i),
    });

    it("throws when only one header field is supplied", () => {
        expect(() => createEffectPartition({ headerStart: "x", abilityStart: "a", abilityCount: "c" })).toThrow();
    });

    it("accepts an in-order contiguous partition", () => {
        expect(
            validateEffectPartition(
                memoDoc(
                    [
                        [0, 3],
                        [3, 2],
                    ],
                    5,
                ),
            ),
        ).toEqual([]);
    });

    it("ACCEPTS a complete out-of-order partition (the quayle case)", () => {
        // starts=[0,5,3,7,8] counts=[3,2,2,1,1] covers [0,9) exactly, out of owner order.
        expect(
            validateEffectPartition(
                memoDoc(
                    [
                        [0, 3],
                        [5, 2],
                        [3, 2],
                        [7, 1],
                        [8, 1],
                    ],
                    9,
                ),
            ),
        ).toEqual([]);
    });

    it("still flags an orphan even when ordering is not required", () => {
        expect(validateEffectPartition(memoDoc([[0, 2]], 4)).length).toBeGreaterThan(0);
    });

    it("still flags overlap even when ordering is not required", () => {
        expect(
            validateEffectPartition(
                memoDoc(
                    [
                        [0, 3],
                        [2, 3],
                    ],
                    5,
                ),
            ).length,
        ).toBeGreaterThan(0);
    });

    it("effectOwners attributes each index to its owner with no equipping range", () => {
        const owners = effectOwners(
            memoDoc(
                [
                    [0, 2],
                    [2, 1],
                ],
                3,
            ),
        );
        expect(owners).toEqual([
            { kind: "ability", index: 0 },
            { kind: "ability", index: 0 },
            { kind: "ability", index: 1 },
        ]);
    });

    it("shiftEffectRefs grows the owner and shifts later owners, leaving header untouched", () => {
        const base = memoDoc(
            [
                [0, 2],
                [2, 2],
            ],
            4,
        );
        const after = shiftEffectRefs(base, { at: 1, delta: 1, owner: { kind: "ability", index: 0 } });
        expect(after.header).toEqual({}); // no header range to touch
        expect(after.abilities[0]).toEqual({ firstMemorizedSpellIndex: 0, memorizedSpellCount: 3 });
        expect(after.abilities[1]).toEqual({ firstMemorizedSpellIndex: 3, memorizedSpellCount: 2 });
    });
});
