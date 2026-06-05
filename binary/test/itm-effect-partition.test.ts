import { describe, expect, it } from "vitest";
import { effectOwners, shiftEffectRefs, validateEffectPartition } from "../src/itm/effect-partition";

// doc stub: header equipping range (featureBlocksIndex/featureBlocksCount) +
// abilities each with their range (featureBlockIndex/featureBlockCount) + an
// effects array of the given length. Matches the real ITM canonical field
// names so the structural shape the functions operate on is exercised.
function doc(equip: [number, number], abilities: Array<[number, number]>, effectCount: number) {
    return {
        header: { featureBlocksIndex: equip[0], featureBlocksCount: equip[1] },
        abilities: abilities.map(([featureBlockIndex, featureBlockCount]) => ({
            featureBlockIndex,
            featureBlockCount,
        })),
        effects: Array.from({ length: effectCount }, (_, i) => i),
    };
}

describe("validateEffectPartition", () => {
    it("accepts an in-order contiguous partition", () => {
        // equipping [0,2), ability0 [2,3), ability1 [3,5)
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

    it("accepts an ability with a zero-count range (no effects of its own)", () => {
        // equipping [0,3), ability0 [3,0) - a real fixture shape (g_axe.itm).
        expect(validateEffectPartition(doc([0, 3], [[3, 0]], 3))).toEqual([]);
    });

    it("flags an effect owned by no range (orphan tail)", () => {
        // equipping [0,2), ability0 [2,1), ability1 [3,1) -> index 4 orphan.
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

    it("flags a range that runs past effects.length", () => {
        expect(validateEffectPartition(doc([0, 2], [[2, 5]], 4)).length).toBeGreaterThan(0);
    });

    it("flags a negative index", () => {
        expect(validateEffectPartition(doc([-1, 2], [], 2)).length).toBeGreaterThan(0);
    });

    it("flags a negative count", () => {
        expect(validateEffectPartition(doc([0, -2], [], 2)).length).toBeGreaterThan(0);
    });

    it("flags overlap between equipping and an ability range", () => {
        // equipping [0,3) and ability0 [2,3) both claim indices 2..2 (and 2..4).
        expect(validateEffectPartition(doc([0, 3], [[2, 3]], 5)).length).toBeGreaterThan(0);
    });

    it("flags overlap between two ability ranges", () => {
        // ability0 [0,3) and ability1 [2,3) overlap at index 2.
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
        // equipping [3,2), ability0 [0,3): fully covers [0,5) with no gap/overlap,
        // but the canonical order (equipping first) expects equipping to start at 0.
        expect(validateEffectPartition(doc([3, 2], [[0, 3]], 5)).length).toBeGreaterThan(0);
    });
});

describe("effectOwners", () => {
    it("assigns each effect index to its owning range", () => {
        const owners = effectOwners(
            doc(
                [0, 2],
                [
                    [2, 1],
                    [3, 2],
                ],
                5,
            ),
        );
        expect(owners).toEqual([
            { kind: "equipping" },
            { kind: "equipping" },
            { kind: "ability", index: 0 },
            { kind: "ability", index: 1 },
            { kind: "ability", index: 1 },
        ]);
    });

    it("leaves an orphan index unowned (undefined)", () => {
        const owners = effectOwners(
            doc(
                [0, 2],
                [
                    [2, 1],
                    [3, 1],
                ],
                5,
            ),
        );
        expect(owners[4]).toBeUndefined();
    });
});

describe("shiftEffectRefs", () => {
    it("grows the owner count and shifts later ranges on insert", () => {
        // insert 1 effect at index 3 owned by ability1 (range [3,5)):
        // ability1 count 2->3; ranges starting > 3 shift +1 (none here).
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
        expect(after.abilities[1]!.featureBlockCount).toBe(3);
        expect(after.abilities[1]!.featureBlockIndex).toBe(3);
        expect(after.abilities[0]!.featureBlockIndex).toBe(2);
    });

    it("shifts a later ability's start when an earlier ability grows", () => {
        // ability0 [2,2), ability1 [4,1). Insert at 4 (ability0's end boundary)
        // owned by ability0: ability0 grows to 3; ability1 start (>= at, not
        // owner) shifts +1 to 5.
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
        expect(after.abilities[0]!.featureBlockCount).toBe(3);
        expect(after.abilities[1]!.featureBlockIndex).toBe(5);
    });

    it("shrinks the owner count and shifts later ranges down on remove", () => {
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
        expect(after.abilities[0]!.featureBlockCount).toBe(1);
        expect(after.abilities[1]!.featureBlockIndex).toBe(3); // shifted down by 1
    });

    it("grows the equipping range and shifts all ability starts on insert", () => {
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
        expect(after.header.featureBlocksCount).toBe(3);
        expect(after.header.featureBlocksIndex).toBe(0);
        expect(after.abilities[0]!.featureBlockIndex).toBe(3); // 2 -> 3
        expect(after.abilities[1]!.featureBlockIndex).toBe(4); // 3 -> 4
    });

    it("does not mutate the input document", () => {
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

    it("throws when the edit point falls outside the owner's range", () => {
        // ability0 range is [2,5); inserting at index 1 attributes the effect to
        // ability0 but the physical effect would land before its range - corrupt.
        expect(() =>
            shiftEffectRefs(doc([0, 2], [[2, 3]], 5), { at: 1, delta: 1, owner: { kind: "ability", index: 0 } }),
        ).toThrow();
    });

    it("throws when removing at the owner's exclusive end boundary", () => {
        // ability0 range is [2,4); index 4 is one past the last owned effect, so
        // a remove there does not address an owned effect.
        expect(() =>
            shiftEffectRefs(doc([0, 2], [[2, 2]], 4), { at: 4, delta: -1, owner: { kind: "ability", index: 0 } }),
        ).toThrow();
    });

    it("clamps an empty equipping range to 0 instead of -1 when an owner removes at index 0", () => {
        // Equipping [0,0) (no equipping effects), ability0 [0,1) owns the single
        // effect. Remove that effect (at 0, delta -1, owner ability0). The empty
        // equipping range is a non-owner starting at 0 >= at, so a raw shift would
        // drive it to -1 (out of bounds, serializes to 0xFFFF). It must clamp to 0.
        const after = shiftEffectRefs(doc([0, 0], [[0, 1]], 1), {
            at: 0,
            delta: -1,
            owner: { kind: "ability", index: 0 },
        });
        expect(after.header.featureBlocksIndex).toBe(0); // clamped from -1
        expect(after.header.featureBlocksCount).toBe(0);
        expect(after.abilities[0]!.featureBlockIndex).toBe(0); // owner start does not move
        expect(after.abilities[0]!.featureBlockCount).toBe(0); // 1 -> 0
        // Reattach the post-splice effects (length 0) and confirm the partition is clean.
        expect(validateEffectPartition({ ...after, effects: [] })).toEqual([]);
    });

    it("clamps an empty equipping range to 0 (stays valid) when an owner inserts at index 0", () => {
        // Equipping [0,0), ability0 [0,1). Insert before ability0's effect (at 0,
        // delta +1, owner ability0). The empty equipping range shifts +1 to 1 under
        // the raw rule; clamping into [0, newEffectCount=2] keeps it valid. The
        // index is inert (count 0) but must not exceed the new effect length.
        const after = shiftEffectRefs(doc([0, 0], [[0, 1]], 1), {
            at: 0,
            delta: 1,
            owner: { kind: "ability", index: 0 },
        });
        expect(after.header.featureBlocksCount).toBe(0);
        // Clamp window is [0, 2]; the shifted value 1 is in range, so it is preserved.
        expect(after.header.featureBlocksIndex).toBe(1);
        expect(after.abilities[0]!.featureBlockIndex).toBe(0); // owner start does not move
        expect(after.abilities[0]!.featureBlockCount).toBe(2); // 1 -> 2
        expect(validateEffectPartition({ ...after, effects: [0, 0] })).toEqual([]);
    });
});
