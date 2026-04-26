import { describe, it, expect } from "vitest";
import { BufferReader, BufferWriter, object, u8, u16, u32, i32, type Parsed } from "typed-binary";
import { toTypedBinarySchema } from "../src/spec/derive-typed-binary";
import { arraySpec, type StructSpec } from "../src/spec/types";

describe("toTypedBinarySchema", () => {
    it("derived scalar struct reads identically to a handwritten one", () => {
        const handwritten = object({ a: u32, b: i32, c: u16, d: u8 });
        type T = Parsed<typeof handwritten>;
        const spec: StructSpec<T> = {
            a: { codec: u32 },
            b: { codec: i32 },
            c: { codec: u16 },
            d: { codec: u8 },
        };
        const derived = toTypedBinarySchema(spec);

        const buf = new ArrayBuffer(11);
        const w = new BufferWriter(buf, { endianness: "big" });
        handwritten.write(w, { a: 0xdeadbeef, b: -1, c: 42, d: 7 });

        const r1 = new BufferReader(buf, { endianness: "big" });
        const r2 = new BufferReader(buf, { endianness: "big" });
        expect(derived.read(r2)).toEqual(handwritten.read(r1));
    });

    it("derived struct writes identically to a handwritten one", () => {
        const handwritten = object({ a: u32, b: i32 });
        type T = Parsed<typeof handwritten>;
        const spec: StructSpec<T> = { a: { codec: u32 }, b: { codec: i32 } };
        const derived = toTypedBinarySchema(spec);

        const sample = { a: 100, b: -200 };
        const out1 = new ArrayBuffer(8);
        const out2 = new ArrayBuffer(8);
        handwritten.write(new BufferWriter(out1, { endianness: "big" }), sample);
        derived.write(new BufferWriter(out2, { endianness: "big" }), sample);

        expect(new Uint8Array(out2)).toEqual(new Uint8Array(out1));
    });

    it("derived schema with fixed-count array reads correctly", () => {
        type T = { count: number; values: number[] };
        const spec: StructSpec<T> = {
            count: { codec: u32 },
            values: arraySpec({ element: { codec: u32 }, count: 3 }),
        };
        const derived = toTypedBinarySchema(spec);

        const buf = new ArrayBuffer(16);
        const w = new BufferWriter(buf, { endianness: "big" });
        derived.write(w, { count: 3, values: [10, 20, 30] });

        const r = new BufferReader(buf, { endianness: "big" });
        expect(derived.read(r)).toEqual({ count: 3, values: [10, 20, 30] });
    });

    it("rejects length-from-field arrays at raw schema level", () => {
        type T = { count: number; values: number[] };
        const spec: StructSpec<T> = {
            count: { codec: u32 },
            values: arraySpec({ element: { codec: u32 }, count: { fromField: "count" } }),
        };
        expect(() => toTypedBinarySchema(spec)).toThrow(/lengthFrom/);
    });

    it("caches derived schema by spec reference", () => {
        const spec: StructSpec<{ a: number }> = { a: { codec: u32 } };
        expect(toTypedBinarySchema(spec)).toBe(toTypedBinarySchema(spec));
    });
});
