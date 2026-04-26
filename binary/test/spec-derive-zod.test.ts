import { describe, it, expect } from "vitest";
import { u32, i32, u8 } from "typed-binary";
import { toZodSchema } from "../src/spec/derive-zod";
import { arraySpec, type FieldSpec } from "../src/spec/types";

describe("toZodSchema", () => {
    it("derives a strict object schema with type-bounded numbers", () => {
        const spec = { a: { codec: u32 }, b: { codec: i32 } } satisfies Record<string, FieldSpec>;
        const z = toZodSchema(spec);

        expect(z.parse({ a: 0, b: 0 })).toEqual({ a: 0, b: 0 });
        expect(z.parse({ a: 4_294_967_295, b: -2_147_483_648 })).toEqual({
            a: 4_294_967_295,
            b: -2_147_483_648,
        });
    });

    it("rejects out-of-range values per codec", () => {
        const spec = { a: { codec: u32 } } satisfies Record<string, FieldSpec>;
        expect(() => toZodSchema(spec).parse({ a: -1 })).toThrow();
        expect(() => toZodSchema(spec).parse({ a: 4_294_967_296 })).toThrow();
    });

    it("rejects non-integer values", () => {
        const spec = { a: { codec: u32 } } satisfies Record<string, FieldSpec>;
        expect(() => toZodSchema(spec).parse({ a: 1.5 })).toThrow();
    });

    it("applies domain bounds tighter than the codec range", () => {
        const spec = {
            x: { codec: u32, domain: { min: 0, max: 8 } },
        } satisfies Record<string, FieldSpec>;
        const z = toZodSchema(spec);
        expect(z.parse({ x: 8 })).toEqual({ x: 8 });
        expect(() => z.parse({ x: 9 })).toThrow();
    });

    it("rejects unknown fields (strict object)", () => {
        const spec = { a: { codec: u8 } } satisfies Record<string, FieldSpec>;
        expect(() => toZodSchema(spec).parse({ a: 1, extra: 2 })).toThrow();
    });

    it("supports fixed-count arrays with element validation", () => {
        const spec = {
            values: arraySpec({ element: { codec: u8 }, count: 3 }),
        } satisfies Record<string, FieldSpec>;
        const z = toZodSchema(spec);
        expect(z.parse({ values: [0, 100, 255] })).toEqual({ values: [0, 100, 255] });
        expect(() => z.parse({ values: [0, 100] })).toThrow(); // wrong length
        expect(() => z.parse({ values: [0, 100, 256] })).toThrow(); // element OOR
    });
});
