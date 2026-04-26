import { describe, it, expect } from "vitest";
import { u32, i32 } from "typed-binary";
import { arraySpec, isArraySpec, type FieldSpec, type StructSpec } from "../src/spec/types";

describe("arraySpec", () => {
    it("constructs a fixed-count array spec", () => {
        const spec = arraySpec({ element: { codec: u32 }, count: 44 });
        expect(spec.kind).toBe("array");
        expect(spec.count).toBe(44);
        expect(spec.element.codec).toBe(u32);
    });

    it("constructs a length-from-field array spec", () => {
        const spec = arraySpec({ element: { codec: i32 }, count: { fromField: "numTiles" } });
        expect(spec.count).toEqual({ fromField: "numTiles" });
    });

    it("isArraySpec discriminates scalar from array", () => {
        const scalar: FieldSpec = { codec: u32 };
        const arr: FieldSpec = arraySpec({ element: { codec: u32 }, count: 4 });
        expect(isArraySpec(scalar)).toBe(false);
        expect(isArraySpec(arr)).toBe(true);
    });

    it("StructSpec accepts arrays alongside scalars", () => {
        type S = { count: number; values: number[] };
        const spec: StructSpec<S> = {
            count: { codec: u32 },
            values: arraySpec({ element: { codec: u32 }, count: { fromField: "count" } }),
        };
        expect(isArraySpec(spec.values)).toBe(true);
    });
});
