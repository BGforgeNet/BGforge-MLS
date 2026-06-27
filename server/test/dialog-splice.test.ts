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
});
