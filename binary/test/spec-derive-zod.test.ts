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

    it("packed-field parts derive zod bounds from bit width, not codec width", () => {
        const spec = {
            destTile: { codec: u32, packedAs: "destTileAndElevation", bitRange: [0, 26] },
            destElevation: { codec: u32, packedAs: "destTileAndElevation", bitRange: [26, 6] },
            destMap: { codec: u32 },
        } satisfies Record<string, FieldSpec>;
        const z = toZodSchema(spec);

        // Within bit-width: passes.
        expect(z.parse({ destTile: 0x03ff_ffff, destElevation: 0x3f, destMap: 0 })).toEqual({
            destTile: 0x03ff_ffff,
            destElevation: 0x3f,
            destMap: 0,
        });

        // 26-bit max + 1 → reject.
        expect(() => z.parse({ destTile: 0x0400_0000, destElevation: 0, destMap: 0 })).toThrow();

        // 6-bit max + 1 → reject.
        expect(() => z.parse({ destTile: 0, destElevation: 0x40, destMap: 0 })).toThrow();

        // Negative values → reject (parts are unsigned bit fields).
        expect(() => z.parse({ destTile: -1, destElevation: 0, destMap: 0 })).toThrow();
    });

    it("lengthFrom array rejects when count field disagrees with array length", () => {
        const spec = {
            n: { codec: u32 },
            xs: arraySpec({ element: { codec: u8 }, count: { fromField: "n" } }),
        } satisfies Record<string, FieldSpec>;
        const z = toZodSchema(spec);

        expect(z.parse({ n: 3, xs: [1, 2, 3] })).toEqual({ n: 3, xs: [1, 2, 3] });
        expect(() => z.parse({ n: 3, xs: [1, 2] })).toThrow();
        expect(() => z.parse({ n: 0, xs: [1] })).toThrow();
    });

    it("packed-field part with domain narrows below the bit-width max", () => {
        const spec = {
            elevation: { codec: u32, packedAs: "w", bitRange: [0, 6], domain: { min: 0, max: 3 } },
            tile: { codec: u32, packedAs: "w", bitRange: [6, 26] },
        } satisfies Record<string, FieldSpec>;
        const z = toZodSchema(spec);

        expect(z.parse({ elevation: 3, tile: 0 })).toEqual({ elevation: 3, tile: 0 });
        // 4 fits in 6 bits but exceeds domain.max.
        expect(() => z.parse({ elevation: 4, tile: 0 })).toThrow();
    });
});
