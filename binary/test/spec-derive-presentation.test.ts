import { describe, it, expect } from "vitest";
import { u8, u32 } from "typed-binary";
import { toPresentationEntries, toPresentationPatterns } from "../src/spec/derive-presentation";
import { arraySpec, type StructSpec } from "../src/spec/types";
import { type StructPresentation } from "../src/spec/presentation";

describe("toPresentationEntries", () => {
    it("emits enum entries with stringified keys", () => {
        type T = { kind: number };
        const spec: StructSpec<T> = {
            kind: { codec: u32, enum: { 0: "Item", 1: "Critter" } },
        };
        const pres: StructPresentation<T> = { kind: { label: "Object Type" } };

        // Keyed by slugify(label) = "objectType" (what the consumer looks up), not the spec field name "kind".
        expect(toPresentationEntries(spec, pres, "pro.header")).toEqual({
            "pro.header.objectType": {
                label: "Object Type",
                presentationType: "enum",
                enumOptions: { 0: "Item", 1: "Critter" },
            },
        });
    });

    it("keys entries by slugify(label) so they match the consumer's semantic key", () => {
        // The consumer (resolveFieldPresentation) is called with the field's semantic key, which is
        // slugify(displayLabel) the same way walkStruct/toSemanticFieldKey derive it - NOT the spec field
        // name. A custom label that does not slugify back to the field name (idRequired -> "Identification")
        // must still resolve, so the entry must be keyed by slugify(label).
        type T = { idRequired: number };
        const spec: StructSpec<T> = { idRequired: { codec: u32, flags: { 1: "A" } } };
        const pres: StructPresentation<T> = { idRequired: { label: "Identification" } };
        expect(toPresentationEntries(spec, pres, "itm.abilities[]")).toEqual({
            "itm.abilities[].identification": {
                label: "Identification",
                presentationType: "flags",
                flagOptions: { 1: "A" },
            },
        });
    });

    it("nests a field's key under its walker subgroup", () => {
        // When the walker wraps fields in a named subgroup (e.g. PRO drug "Affected Stats"), the field's
        // semantic key gains that slugified segment. The deriver must mirror it so the keys still match.
        type T = { stat0: number; other: number };
        const spec: StructSpec<T> = {
            stat0: { codec: u32, enum: { 0: "None" } },
            other: { codec: u32, enum: { 0: "X" } },
        };
        expect(
            toPresentationEntries(spec, {}, "pro.drugStats", [{ name: "Affected Stats", fields: ["stat0"] }]),
        ).toEqual({
            "pro.drugStats.affectedStats.stat0": { presentationType: "enum", enumOptions: { 0: "None" } },
            "pro.drugStats.other": { presentationType: "enum", enumOptions: { 0: "X" } },
        });
    });

    it("descends into a slots-view array field with per-slot enum/flags", () => {
        // A "slots" array (e.g. ITM usabilityFlags) renders as a subgroup named by the array label, each child
        // named by its slot label and carrying that slot element's flags. The deriver mirrors that: one entry
        // per slot keyed `${prefix}.${slugify(arrayLabel)}.${slugify(slotLabel)}`.
        type T = { usabilityFlags: number[] };
        const spec: StructSpec<T> = {
            usabilityFlags: arraySpec({
                element: { codec: u8 },
                count: 2,
                view: "slots",
                slotLabels: ["Byte 1 (Class)", "Byte 2 (Race)"],
                slotElements: [
                    { codec: u8, flags: { 1: "A" } },
                    { codec: u8, flags: { 2: "B" } },
                ],
            }),
        };
        expect(toPresentationEntries(spec, {}, "itm.header")).toEqual({
            "itm.header.usabilityFlags.byte1Class": { presentationType: "flags", flagOptions: { 1: "A" } },
            "itm.header.usabilityFlags.byte2Race": { presentationType: "flags", flagOptions: { 2: "B" } },
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

    it("surfaces a description that adds info over the label plus its doc link, and drops a label-redundant one", () => {
        // A description that slugifies to the same key as the label ("Price" on a Price field) is the label
        // verbatim - redundant noise - so it is dropped, and its docUrl with it. A description that says more
        // (the Min Level note) is kept, and its docUrl rides along. This is the tooltip-suppression gate the
        // whole feature turns on; keeping it here guards it independent of the end-to-end render harness.
        type T = { minLevel: number; price: number };
        const url = "https://gibberlings3.github.io/iesdp/file_formats/ie_formats/itm_v1.htm";
        const spec: StructSpec<T> = {
            minLevel: { codec: u32, description: "Min Level - the average of all active class levels.", docUrl: url },
            price: { codec: u32, description: "Price", docUrl: url },
        };
        expect(toPresentationEntries(spec, {}, "itm.header")).toEqual({
            "itm.header.minLevel": { description: "Min Level - the average of all active class levels.", docUrl: url },
        });
    });

    it("keeps a surviving description even when it has no docUrl (a short-but-non-redundant note)", () => {
        // The Min Strength Bonus note is short enough to not be capped, so no docUrl - but it still adds info
        // over the "Strength Bonus" label, so the description surfaces on its own.
        type T = { minStrengthBonus: number };
        const spec: StructSpec<T> = {
            minStrengthBonus: { codec: u8, description: "Min Strength Bonus (unused in BG1)" },
        };
        expect(toPresentationEntries(spec, {}, "itm.header")).toEqual({
            "itm.header.minStrengthBonus": { description: "Min Strength Bonus (unused in BG1)" },
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
