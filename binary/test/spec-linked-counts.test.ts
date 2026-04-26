import { describe, it, expect } from "vitest";
import { u32 } from "typed-binary";
import { arraySpec, enforceLinkedCounts, type FieldSpec } from "../src/spec/types";

describe("enforceLinkedCounts", () => {
    const spec = {
        numItems: { codec: u32 },
        items: arraySpec({ element: { codec: u32 }, count: { fromField: "numItems" } }),
    } satisfies Record<string, FieldSpec>;

    it("derives the linked count from the array's length", () => {
        const doc = { numItems: 0, items: [10, 20, 30] };
        expect(enforceLinkedCounts(spec, doc)).toEqual({ numItems: 3, items: [10, 20, 30] });
    });

    it("returns the original object when counts already match", () => {
        const doc = { numItems: 2, items: [10, 20] };
        expect(enforceLinkedCounts(spec, doc)).toBe(doc);
    });

    it("does not mutate the input", () => {
        const doc = { numItems: 0, items: [10, 20] };
        const result = enforceLinkedCounts(spec, doc);
        expect(doc.numItems).toBe(0);
        expect(result.numItems).toBe(2);
    });

    it("ignores fixed-count arrays", () => {
        const fixedSpec = {
            sentinel: { codec: u32 },
            tail: arraySpec({ element: { codec: u32 }, count: 3 }),
        } satisfies Record<string, FieldSpec>;
        const doc = { sentinel: 0, tail: [1, 2, 3] };
        expect(enforceLinkedCounts(fixedSpec, doc)).toBe(doc);
    });

    it("ignores fromCtx arrays — their count lives outside the doc", () => {
        const ctxSpec = {
            xs: arraySpec({ element: { codec: u32 }, count: { fromCtx: (ctx: { n: number }) => ctx.n } }),
        } satisfies Record<string, FieldSpec>;
        const doc = { xs: [10, 20] };
        expect(enforceLinkedCounts(ctxSpec, doc)).toBe(doc);
    });
});
