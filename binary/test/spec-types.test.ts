import { describe, it, expect } from "vitest";
import { u32, i32 } from "typed-binary";
import type { FieldSpec, StructSpec } from "../src/spec/types";

describe("FieldSpec", () => {
    it("accepts minimal numeric field", () => {
        const f: FieldSpec = { codec: u32 };
        expect(f.codec).toBe(u32);
    });

    it("accepts a field with domain", () => {
        const f: FieldSpec = { codec: u32, domain: { min: 0, max: 8 } };
        expect(f.domain).toEqual({ min: 0, max: 8 });
    });

    it("accepts a field with enum lookup", () => {
        const f: FieldSpec = { codec: u32, enum: { 0: "Item", 1: "Critter" } };
        expect(f.enum?.[0]).toBe("Item");
    });

    it("accepts a field with flags lookup", () => {
        const f: FieldSpec = { codec: u32, flags: { 1: "stat0", 2: "stat1" } };
        expect(f.flags?.[1]).toBe("stat0");
    });

    it("StructSpec is keyed by field name", () => {
        type S = { a: number; b: number };
        const spec: StructSpec<S> = { a: { codec: u32 }, b: { codec: i32 } };
        expect(Object.keys(spec)).toEqual(["a", "b"]);
    });
});

describe("ArrayFieldSpec capabilities", () => {
    it("arraySpec accepts and stores addable/removable/defaultElement metadata", async () => {
        const { arraySpec } = await import("../src/spec/types");
        const spec = arraySpec({
            element: { codec: i32 },
            count: { fromField: "n" },
            addable: true,
            removable: true,
            defaultElement: () => 0,
        });
        expect(spec.addable).toBe(true);
        expect(spec.removable).toBe(true);
        expect(spec.defaultElement?.()).toBe(0);
    });

    it("defaults addable/removable to undefined when omitted", async () => {
        const { arraySpec } = await import("../src/spec/types");
        const spec = arraySpec({ element: { codec: u32 }, count: 8 });
        expect(spec.addable).toBeUndefined();
        expect(spec.removable).toBeUndefined();
        expect(spec.defaultElement).toBeUndefined();
    });
});
