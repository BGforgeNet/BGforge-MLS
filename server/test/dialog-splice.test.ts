import { describe, expect, it } from "vitest";
import { applySplices, type SpliceOp } from "../../shared/dialog-splice";

describe("applySplices", () => {
    it("applies non-overlapping replacements regardless of op order", () => {
        const text = "abcdefgh";
        const ops: SpliceOp[] = [
            { start: 4, end: 6, replacement: "XY" }, // ef -> XY
            { start: 1, end: 2, replacement: "" }, // delete b
        ];
        expect(applySplices(text, ops)).toBe("acdXYgh");
    });

    it("inserts at a zero-width range", () => {
        expect(applySplices("ac", [{ start: 1, end: 1, replacement: "b" }])).toBe("abc");
    });

    it("is a no-op for an empty op list", () => {
        expect(applySplices("abc", [])).toBe("abc");
    });

    it("applies correctly regardless of input op order (smallest-start first)", () => {
        const text = "abcdefgh";
        const ops: SpliceOp[] = [
            { start: 1, end: 2, replacement: "" }, // delete b (given first this time)
            { start: 4, end: 6, replacement: "XY" }, // ef -> XY
        ];
        expect(applySplices(text, ops)).toBe("acdXYgh");
    });

    it("allows adjacent (touching, non-overlapping) ranges", () => {
        const text = "abcdef";
        const ops: SpliceOp[] = [
            { start: 0, end: 2, replacement: "X" }, // [0,2)
            { start: 2, end: 4, replacement: "Y" }, // [2,4) - touches the previous at 2, no overlap
        ];
        expect(applySplices(text, ops)).toBe("XYef");
    });

    it("handles a single-character text and an empty-string text", () => {
        expect(applySplices("a", [{ start: 0, end: 1, replacement: "b" }])).toBe("b");
        expect(applySplices("", [{ start: 0, end: 0, replacement: "x" }])).toBe("x");
    });

    it("throws on overlapping ops (the silent-corruption class made loud)", () => {
        const ops: SpliceOp[] = [
            { start: 1, end: 5, replacement: "X" },
            { start: 3, end: 7, replacement: "Y" }, // overlaps [1,5) at [3,5)
        ];
        expect(() => applySplices("abcdefghij", ops)).toThrow(/overlap/i);
    });

    it("throws on a zero-width insert that lands inside another op's range", () => {
        const ops: SpliceOp[] = [
            { start: 0, end: 4, replacement: "" }, // delete [0,4)
            { start: 2, end: 2, replacement: "Z" }, // insert at 2 - inside the deletion
        ];
        expect(() => applySplices("abcdef", ops)).toThrow(/overlap/i);
    });

    it("throws on a malformed op with start > end", () => {
        expect(() => applySplices("abc", [{ start: 2, end: 1, replacement: "x" }])).toThrow(/start.*end|malformed/i);
    });
});
