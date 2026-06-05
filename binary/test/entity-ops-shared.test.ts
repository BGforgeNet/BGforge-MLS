import { describe, expect, it } from "vitest";
import { applyEntryMutation } from "../src/spec/entity-ops";

const def = () => 0;
describe("applyEntryMutation", () => {
    it("add appends and reports delta +1", () => {
        const m = applyEntryMutation([1, 2], "add", 0, def)!;
        expect(m.next).toEqual([1, 2, 0]);
        expect([m.index, m.delta]).toEqual([2, 1]);
    });
    it("insert before/after places the default and reports the slot", () => {
        expect(applyEntryMutation([1, 2], "insert", 1, def, "before")!.next).toEqual([1, 0, 2]);
        expect(applyEntryMutation([1, 2], "insert", 0, def, "after")!.next).toEqual([1, 0, 2]);
    });
    it("remove drops the entry, delta -1", () => {
        const m = applyEntryMutation([1, 2, 3], "remove", 1, def)!;
        expect(m.next).toEqual([1, 3]);
        expect(m.delta).toBe(-1);
    });
    it("duplicate clones in place after the source", () => {
        expect(applyEntryMutation([5, 6], "duplicate", 0, def)!.next).toEqual([5, 5, 6]);
    });
    it("reorder swaps; returns undefined at the boundary", () => {
        expect(applyEntryMutation([1, 2, 3], "reorder", 0, def, undefined, "down")!.next).toEqual([2, 1, 3]);
        expect(applyEntryMutation([1, 2, 3], "reorder", 0, def, undefined, "up")).toBeUndefined();
    });
    it("index-consuming ops return undefined for an out-of-range index", () => {
        expect(applyEntryMutation([1, 2], "duplicate", 5, def)).toBeUndefined();
        expect(applyEntryMutation([1, 2], "remove", 5, def)).toBeUndefined();
    });
});
