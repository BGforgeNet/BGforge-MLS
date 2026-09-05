import { describe, expect, it } from "vitest";
import { allocateAnimationId } from "../src/convert/allocate";

describe("allocating an animation id in the target", () => {
    /**
     * The sparse-target case: a target that has not claimed the id keeps it. Rare between stock installs,
     * where the id means the same creature in both and is therefore always taken - it is the shape a
     * mostly-empty or heavily-modded target takes.
     */
    it("keeps the source's own id when the target has not claimed it", () => {
        expect(allocateAnimationId([0x6000, 0x6001], 0x6004)).toBe(0x6004);
    });

    /** The normal path between two stock installs, where every source id is already declared. */
    it("takes the next free id when the source's own is claimed", () => {
        expect(allocateAnimationId([0x6004], 0x6004)).toBe(0x6005);
    });

    it("steps over a run of claimed ids rather than stopping at the first gap below the base", () => {
        expect(allocateAnimationId([0x6004, 0x6005, 0x6006, 0x6008], 0x6004)).toBe(0x6007);
    });

    it("allocates against an empty install", () => {
        expect(allocateAnimationId([], 0x6004)).toBe(0x6004);
    });
});
