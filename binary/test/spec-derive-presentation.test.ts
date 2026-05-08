import { describe, it, expect } from "vitest";
import { u32 } from "typed-binary";
import { toPresentationEntries, toPresentationPatterns } from "../src/spec/derive-presentation";
import { type StructSpec } from "../src/spec/types";
import { type StructPresentation } from "../src/spec/presentation";

describe("toPresentationEntries", () => {
    it("emits enum entries with stringified keys", () => {
        type T = { kind: number };
        const spec: StructSpec<T> = {
            kind: { codec: u32, enum: { 0: "Item", 1: "Critter" } },
        };
        const pres: StructPresentation<T> = { kind: { label: "Object Type" } };

        expect(toPresentationEntries(spec, pres, "pro.header")).toEqual({
            "pro.header.kind": {
                label: "Object Type",
                presentationType: "enum",
                enumOptions: { 0: "Item", 1: "Critter" },
            },
        });
    });

    it("emits flags entries with stringified bit keys", () => {
        type T = { f: number };
        const spec: StructSpec<T> = { f: { codec: u32, flags: { 1: "A", 2: "B" } } };

        expect(toPresentationEntries(spec, {}, "pro.header")).toEqual({
            "pro.header.f": {
                presentationType: "flags",
                flagOptions: { 1: "A", 2: "B" },
            },
        });
    });

    it("emits scalar entries when label/numericFormat/editable differ from defaults", () => {
        type T = { a: number; b: number; c: number };
        const spec: StructSpec<T> = {
            a: { codec: u32 },
            b: { codec: u32 },
            c: { codec: u32 },
        };
        const pres: StructPresentation<T> = {
            a: { format: "hex32" },
            b: { editable: false },
            // c has no overrides - should be omitted entirely.
        };

        expect(toPresentationEntries(spec, pres, "pro.header")).toEqual({
            "pro.header.a": { numericFormat: "hex32" },
            "pro.header.b": { editable: false },
        });
    });

    it("does not emit a label entry when default humanization would suffice", () => {
        // Labels live in the walker (which uses humanize). exactFields entries
        // only carry labels when they need to override the walker's behavior,
        // not for scalar fields where presentation overrides already apply.
        type T = { x: number };
        const spec: StructSpec<T> = { x: { codec: u32 } };
        expect(toPresentationEntries(spec, {}, "pro.header")).toEqual({});
    });

    it("emits editable: false for fields with a non-data role", () => {
        // Structural fields (offsets, counts, indexes into sibling tables) are
        // declared with a `role` on the spec. The role is the source of truth
        // for "this is a derived field, not user-meaningful data" - the editor
        // must lock such fields, and the canonical writer must recompute them.
        // Presentation derivation translates the role into `editable: false`
        // so the editor's existing presentation pipeline picks it up without
        // needing a parallel role-aware path.
        type T = { offset: number; count: number; idx: number };
        const spec: StructSpec<T> = {
            offset: { codec: u32, role: "derivedOffset", derivedFrom: { section: "abilities" } },
            count: { codec: u32, role: "derivedCount", derivedFrom: { array: "abilities" } },
            idx: { codec: u32, role: "derivedIndex", derivedFrom: { table: "effects" } },
        };
        expect(toPresentationEntries(spec, {}, "itm.header")).toEqual({
            "itm.header.offset": { editable: false },
            "itm.header.count": { editable: false },
            "itm.header.idx": { editable: false },
        });
    });
});

describe("toPresentationPatterns", () => {
    // The path-aware counterpart to toPresentationEntries. Used by formats
    // whose canonical paths nest through array indices (e.g., MAP's
    // map.scripts[].extents[].slots[].localVarsOffset). The path template
    // carries the unescaped path with literal "[]" markers; the helper
    // emits PatternFieldPresentation entries with regex-escaped patterns.
    it("emits an editable: false pattern entry for each non-data role field", () => {
        type T = { localVarsOffset: number; numLocalVars: number };
        const spec: StructSpec<T> = {
            localVarsOffset: {
                codec: u32,
                role: "derivedOffset",
                derivedFrom: { section: "localVars" },
            },
            numLocalVars: {
                codec: u32,
                role: "derivedCount",
                derivedFrom: { array: "localVars" },
            },
        };
        const patterns = toPresentationPatterns(spec, {}, "map.scripts[].extents[].slots[]");
        expect(patterns).toEqual([
            {
                pathPattern: "^map\\.scripts\\[\\]\\.extents\\[\\]\\.slots\\[\\]\\.localVarsOffset$",
                editable: false,
            },
            {
                pathPattern: "^map\\.scripts\\[\\]\\.extents\\[\\]\\.slots\\[\\]\\.numLocalVars$",
                editable: false,
            },
        ]);
    });

    it("emits enum / flags pattern entries when the spec carries those tables", () => {
        type T = { kind: number; flags: number };
        const spec: StructSpec<T> = {
            kind: { codec: u32, enum: { 0: "Item", 1: "Critter" } },
            flags: { codec: u32, flags: { 1: "A", 2: "B" } },
        };
        expect(toPresentationPatterns(spec, {}, "pro.header")).toEqual([
            {
                pathPattern: "^pro\\.header\\.kind$",
                presentationType: "enum",
                enumOptions: { 0: "Item", 1: "Critter" },
            },
            {
                pathPattern: "^pro\\.header\\.flags$",
                presentationType: "flags",
                flagOptions: { 1: "A", 2: "B" },
            },
        ]);
    });

    it("omits scalar fields with no role / no enum / no flags", () => {
        type T = { plain: number; offset: number };
        const spec: StructSpec<T> = {
            plain: { codec: u32 },
            offset: { codec: u32, role: "derivedOffset", derivedFrom: { section: "x" } },
        };
        expect(toPresentationPatterns(spec, {}, "fmt.struct[]")).toEqual([
            { pathPattern: "^fmt\\.struct\\[\\]\\.offset$", editable: false },
        ]);
    });

    it("skips array and chars fields (mirrors toPresentationEntries)", () => {
        type T = { count: number };
        const spec: StructSpec<T> = {
            count: { codec: u32, role: "derivedCount", derivedFrom: { array: "items" } },
        };
        expect(toPresentationPatterns(spec, {}, "fmt.struct").length).toBe(1);
    });
});
