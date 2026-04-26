import { describe, it, expect } from "vitest";
import { u32 } from "typed-binary";
import { toPresentationEntries } from "../src/spec/derive-presentation";
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
            // c has no overrides — should be omitted entirely.
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
});
