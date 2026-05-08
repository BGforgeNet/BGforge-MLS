import { describe, it, expect } from "vitest";
import { u32 } from "typed-binary";
import { arraySpec, enforceDerivedFields, validateDerivedFields, type FieldSpec } from "../src/spec/types";

describe("enforceDerivedFields", () => {
    const spec = {
        numItems: { codec: u32 },
        items: arraySpec({ element: { codec: u32 }, count: { fromField: "numItems" } }),
    } satisfies Record<string, FieldSpec>;

    it("derives the linked count from the array's length", () => {
        const doc = { numItems: 0, items: [10, 20, 30] };
        expect(enforceDerivedFields(spec, doc)).toEqual({ numItems: 3, items: [10, 20, 30] });
    });

    it("returns the original object when counts already match", () => {
        const doc = { numItems: 2, items: [10, 20] };
        expect(enforceDerivedFields(spec, doc)).toBe(doc);
    });

    it("does not mutate the input", () => {
        const doc = { numItems: 0, items: [10, 20] };
        const result = enforceDerivedFields(spec, doc);
        expect(doc.numItems).toBe(0);
        expect(result.numItems).toBe(2);
    });

    it("ignores fixed-count arrays", () => {
        const fixedSpec = {
            sentinel: { codec: u32 },
            tail: arraySpec({ element: { codec: u32 }, count: 3 }),
        } satisfies Record<string, FieldSpec>;
        const doc = { sentinel: 0, tail: [1, 2, 3] };
        expect(enforceDerivedFields(fixedSpec, doc)).toBe(doc);
    });

    it("ignores fromCtx arrays - their count lives outside the doc", () => {
        const ctxSpec = {
            xs: arraySpec({ element: { codec: u32 }, count: { fromCtx: (ctx: { n: number }) => ctx.n } }),
        } satisfies Record<string, FieldSpec>;
        const doc = { xs: [10, 20] };
        expect(enforceDerivedFields(ctxSpec, doc)).toBe(doc);
    });

    describe("role-driven recompute (cross-struct via ctx)", () => {
        // Counts/offsets that live in a header struct but reference an array
        // or section at the canonical-doc level. The format-specific writer
        // assembles `ctx` from the surrounding doc shape and section layout.
        it("recomputes derivedCount from ctx.arrays", () => {
            const headerSpec = {
                abilityCount: {
                    codec: u32,
                    role: "derivedCount" as const,
                    derivedFrom: { array: "abilities" } as const,
                },
            } satisfies Record<string, FieldSpec>;
            const header = { abilityCount: 0 };
            const ctx = { arrays: { abilities: [{ id: 1 }, { id: 2 }, { id: 3 }] } };
            expect(enforceDerivedFields(headerSpec, header, ctx)).toEqual({ abilityCount: 3 });
        });

        it("recomputes derivedOffset from ctx.sectionOffsets", () => {
            const headerSpec = {
                abilitiesOffset: {
                    codec: u32,
                    role: "derivedOffset" as const,
                    derivedFrom: { section: "abilities" } as const,
                },
            } satisfies Record<string, FieldSpec>;
            const header = { abilitiesOffset: 0 };
            const ctx = { sectionOffsets: { abilities: 0x72 } };
            expect(enforceDerivedFields(headerSpec, header, ctx)).toEqual({ abilitiesOffset: 0x72 });
        });

        it("leaves role: data fields alone", () => {
            const headerSpec = {
                version: { codec: u32 },
                custom: { codec: u32, role: "data" as const },
            } satisfies Record<string, FieldSpec>;
            const header = { version: 1, custom: 42 };
            expect(enforceDerivedFields(headerSpec, header, {})).toBe(header);
        });

        it("returns same reference when all derived values already match", () => {
            const headerSpec = {
                count: { codec: u32, role: "derivedCount" as const, derivedFrom: { array: "xs" } as const },
            } satisfies Record<string, FieldSpec>;
            const header = { count: 2 };
            const ctx = { arrays: { xs: [10, 20] } };
            expect(enforceDerivedFields(headerSpec, header, ctx)).toBe(header);
        });

        it("ignores derivedCount when ctx.arrays does not name the source", () => {
            // A spec author may tag a field that the writer doesn't (yet)
            // recompute. The helper is permissive: missing context = leave
            // the value as-is. The zod refinement (slice 5) is the place to
            // assert truth.
            const headerSpec = {
                count: { codec: u32, role: "derivedCount" as const, derivedFrom: { array: "missing" } as const },
            } satisfies Record<string, FieldSpec>;
            const header = { count: 99 };
            expect(enforceDerivedFields(headerSpec, header, { arrays: {} })).toBe(header);
        });
    });
});

describe("validateDerivedFields", () => {
    // The validation counterpart to enforceDerivedFields: returns the list of
    // fields whose doc value diverges from the recomputed truth, with both
    // values surfaced for issue reporting. Empty list = doc is consistent.
    it("returns an empty list when every derived field matches", () => {
        const spec = {
            count: { codec: u32, role: "derivedCount" as const, derivedFrom: { array: "items" } as const },
        } satisfies Record<string, FieldSpec>;
        const doc = { count: 3 };
        const ctx = { arrays: { items: [1, 2, 3] } };
        expect(validateDerivedFields(spec, doc, ctx)).toEqual([]);
    });

    it("reports each mismatched field with actual + expected", () => {
        const spec = {
            count: { codec: u32, role: "derivedCount" as const, derivedFrom: { array: "items" } as const },
            offset: { codec: u32, role: "derivedOffset" as const, derivedFrom: { section: "items" } as const },
        } satisfies Record<string, FieldSpec>;
        const doc = { count: 99, offset: 0 };
        const ctx = { arrays: { items: [1, 2] }, sectionOffsets: { items: 0x14 } };
        expect(validateDerivedFields(spec, doc, ctx)).toEqual([
            { field: "count", actual: 99, expected: 2 },
            { field: "offset", actual: 0, expected: 0x14 },
        ]);
    });

    it("ignores role: data fields (user values that need not match anything)", () => {
        const spec = {
            x: { codec: u32 },
            y: { codec: u32, role: "data" as const },
        } satisfies Record<string, FieldSpec>;
        expect(validateDerivedFields(spec, { x: 1, y: 2 }, {})).toEqual([]);
    });

    it("ignores derived fields whose source is not supplied in ctx", () => {
        // Mirrors enforceDerivedFields' permissive-on-missing-context behaviour:
        // the validator can only assert against truth it has access to. Fields
        // without a derivable source pass through.
        const spec = {
            count: { codec: u32, role: "derivedCount" as const, derivedFrom: { array: "missing" } as const },
        } satisfies Record<string, FieldSpec>;
        expect(validateDerivedFields(spec, { count: 99 }, { arrays: {} })).toEqual([]);
    });
});
