import { describe, it, expect } from "vitest";
import { BufferReader, BufferWriter, object, u8, u16, u32, i32 } from "typed-binary";
import { toTypedBinarySchema } from "../src/spec/derive-typed-binary";
import { arraySpec, type FieldSpec } from "../src/spec/types";

describe("toTypedBinarySchema", () => {
    it("derived scalar struct reads identically to a handwritten one", () => {
        const handwritten = object({ a: u32, b: i32, c: u16, d: u8 });
        const spec = {
            a: { codec: u32 },
            b: { codec: i32 },
            c: { codec: u16 },
            d: { codec: u8 },
        } satisfies Record<string, FieldSpec>;
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
        const spec = { a: { codec: u32 }, b: { codec: i32 } } satisfies Record<string, FieldSpec>;
        const derived = toTypedBinarySchema(spec);

        const sample = { a: 100, b: -200 };
        const out1 = new ArrayBuffer(8);
        const out2 = new ArrayBuffer(8);
        handwritten.write(new BufferWriter(out1, { endianness: "big" }), sample);
        derived.write(new BufferWriter(out2, { endianness: "big" }), sample);

        expect(new Uint8Array(out2)).toEqual(new Uint8Array(out1));
    });

    it("derived schema with fixed-count array reads correctly", () => {
        const spec = {
            count: { codec: u32 },
            values: arraySpec({ element: { codec: u32 }, count: 3 }),
        } satisfies Record<string, FieldSpec>;
        const derived = toTypedBinarySchema(spec);

        const buf = new ArrayBuffer(16);
        const w = new BufferWriter(buf, { endianness: "big" });
        derived.write(w, { count: 3, values: [10, 20, 30] });

        const r = new BufferReader(buf, { endianness: "big" });
        expect(derived.read(r)).toEqual({ count: 3, values: [10, 20, 30] });
    });

    it("supports length-from-field arrays: count field drives array length on read and write", () => {
        const spec = {
            count: { codec: u32 },
            values: arraySpec({ element: { codec: u32 }, count: { fromField: "count" } }),
        } satisfies Record<string, FieldSpec>;
        const derived = toTypedBinarySchema(spec);

        const buf = new ArrayBuffer(16); // 4 (count) + 3*4 (values).
        const w = new BufferWriter(buf, { endianness: "big" });
        derived.write(w, { count: 3, values: [10, 20, 30] });

        const r = new BufferReader(buf, { endianness: "big" });
        expect(derived.read(r)).toEqual({ count: 3, values: [10, 20, 30] });
    });

    it("length-from-field array with zero count reads as empty", () => {
        const spec = {
            n: { codec: u32 },
            xs: arraySpec({ element: { codec: u8 }, count: { fromField: "n" } }),
        } satisfies Record<string, FieldSpec>;
        const derived = toTypedBinarySchema(spec);

        const buf = new ArrayBuffer(4);
        const w = new BufferWriter(buf, { endianness: "big" });
        derived.write(w, { n: 0, xs: [] });

        const r = new BufferReader(buf, { endianness: "big" });
        expect(derived.read(r)).toEqual({ n: 0, xs: [] });
    });

    it("length-from-field array referencing an unknown sibling field throws on read", () => {
        const spec = {
            count: { codec: u32 },
            values: arraySpec({ element: { codec: u8 }, count: { fromField: "missing" } }),
        } satisfies Record<string, FieldSpec>;
        const derived = toTypedBinarySchema(spec);

        const buf = new ArrayBuffer(4);
        new BufferWriter(buf, { endianness: "big" }).writeUint32(3);
        expect(() => derived.read(new BufferReader(buf, { endianness: "big" }))).toThrow(/missing/);
    });

    it("caches derived schema by spec reference", () => {
        const spec = { a: { codec: u32 } } satisfies Record<string, FieldSpec>;
        expect(toTypedBinarySchema(spec)).toBe(toTypedBinarySchema(spec));
    });

    it("packed-field parts read as flat properties from the shared wire slot", () => {
        const spec = {
            destTile: { codec: u32, packedAs: "destTileAndElevation", bitRange: [0, 26] },
            destElevation: { codec: u32, packedAs: "destTileAndElevation", bitRange: [26, 6] },
            destMap: { codec: u32 },
        } satisfies Record<string, FieldSpec>;
        const derived = toTypedBinarySchema(spec);

        // tile=5 in low 26 bits, elevation=2 in high 6 bits → packed = 0x0800_0005.
        const buf = new ArrayBuffer(8);
        const w = new BufferWriter(buf, { endianness: "big" });
        object({ packed: u32, destMap: u32 }).write(w, { packed: 0x0800_0005, destMap: 0x1234_5678 });

        const r = new BufferReader(buf, { endianness: "big" });
        expect(derived.read(r)).toEqual({ destTile: 5, destElevation: 2, destMap: 0x1234_5678 });
    });

    it("packed-field parts write back into the shared wire slot", () => {
        const spec = {
            destTile: { codec: u32, packedAs: "destTileAndElevation", bitRange: [0, 26] },
            destElevation: { codec: u32, packedAs: "destTileAndElevation", bitRange: [26, 6] },
            destMap: { codec: u32 },
        } satisfies Record<string, FieldSpec>;
        const derived = toTypedBinarySchema(spec);

        const buf = new ArrayBuffer(8);
        const w = new BufferWriter(buf, { endianness: "big" });
        derived.write(w, { destTile: 5, destElevation: 2, destMap: 0x1234_5678 });

        const expected = new ArrayBuffer(8);
        object({ packed: u32, destMap: u32 }).write(new BufferWriter(expected, { endianness: "big" }), {
            packed: 0x0800_0005,
            destMap: 0x1234_5678,
        });
        expect(new Uint8Array(buf)).toEqual(new Uint8Array(expected));
    });

    it("packed-field group with gaps reads zero for the gap bits", () => {
        // 16-bit gap: low 8 bits = lo, top 8 bits = hi, middle 16 bits ignored.
        const spec = {
            lo: { codec: u32, packedAs: "word", bitRange: [0, 8] },
            hi: { codec: u32, packedAs: "word", bitRange: [24, 8] },
        } satisfies Record<string, FieldSpec>;
        const derived = toTypedBinarySchema(spec);

        const buf = new ArrayBuffer(4);
        // Wire word: hi=0xAB at bit 24, lo=0xCD at bit 0, middle = 0xFFFF.
        new BufferWriter(buf, { endianness: "big" }).writeUint32((0xab << 24) | (0xffff << 8) | 0xcd);

        const r = new BufferReader(buf, { endianness: "big" });
        expect(derived.read(r)).toEqual({ lo: 0xcd, hi: 0xab });
    });

    it("rejects a packed-field part missing bitRange", () => {
        const spec = {
            a: { codec: u32, packedAs: "w", bitRange: [0, 16] },
            b: { codec: u32, packedAs: "w" },
        } satisfies Record<string, FieldSpec>;
        expect(() => toTypedBinarySchema(spec)).toThrow(/missing bitRange/);
    });

    it("rejects a packed-field group with mismatched codecs across parts", () => {
        const spec = {
            a: { codec: u32, packedAs: "w", bitRange: [0, 16] },
            b: { codec: u16, packedAs: "w", bitRange: [16, 16] },
        } satisfies Record<string, FieldSpec>;
        expect(() => toTypedBinarySchema(spec)).toThrow(/wire codec/);
    });

    it("rejects a packed-field bitRange that exceeds the wire codec width", () => {
        const spec = {
            a: { codec: u32, packedAs: "w", bitRange: [0, 24] },
            b: { codec: u32, packedAs: "w", bitRange: [16, 24] },
        } satisfies Record<string, FieldSpec>;
        expect(() => toTypedBinarySchema(spec)).toThrow(/exceeds 32-bit wire codec/);
    });

    it("rejects a packed-field group whose parts overlap", () => {
        const spec = {
            a: { codec: u32, packedAs: "w", bitRange: [0, 20] },
            b: { codec: u32, packedAs: "w", bitRange: [16, 16] },
        } satisfies Record<string, FieldSpec>;
        expect(() => toTypedBinarySchema(spec)).toThrow(/overlap/);
    });

    it("rejects a packed-field group with only one part", () => {
        const spec = {
            a: { codec: u32, packedAs: "w", bitRange: [0, 32] },
            b: { codec: u32 },
        } satisfies Record<string, FieldSpec>;
        expect(() => toTypedBinarySchema(spec)).toThrow(/at least two/);
    });

    it("supports fromCtx arrays: ctx callback drives length on read", () => {
        const spec = {
            values: arraySpec({
                element: { codec: u32 },
                count: { fromCtx: (ctx: { n: number }) => ctx.n },
            }),
        } satisfies Record<string, FieldSpec>;
        const derived = toTypedBinarySchema<typeof spec, { n: number }>(spec);

        const buf = new ArrayBuffer(12);
        const w = new BufferWriter(buf, { endianness: "big" });
        w.writeUint32(10);
        w.writeUint32(20);
        w.writeUint32(30);

        const r = new BufferReader(buf, { endianness: "big" });
        expect(derived.read(r, { n: 3 })).toEqual({ values: [10, 20, 30] });
    });

    it("fromCtx arrays write all elements regardless of ctx", () => {
        const spec = {
            values: arraySpec({
                element: { codec: u32 },
                count: { fromCtx: (ctx: { n: number }) => ctx.n },
            }),
        } satisfies Record<string, FieldSpec>;
        const derived = toTypedBinarySchema<typeof spec, { n: number }>(spec);

        const buf = new ArrayBuffer(8);
        const w = new BufferWriter(buf, { endianness: "big" });
        derived.write(w, { values: [10, 20] });

        const r = new BufferReader(buf, { endianness: "big" });
        expect(r.readUint32()).toBe(10);
        expect(r.readUint32()).toBe(20);
    });

    it("fromCtx read without ctx throws a clear error", () => {
        const spec = {
            values: arraySpec({
                element: { codec: u32 },
                count: { fromCtx: (ctx: { n: number }) => ctx.n },
            }),
        } satisfies Record<string, FieldSpec>;
        const derived = toTypedBinarySchema<typeof spec, { n: number }>(spec);
        const buf = new ArrayBuffer(0);
        const r = new BufferReader(buf, { endianness: "big" });
        expect(() => derived.read(r)).toThrow(/ctx/i);
    });

    it("fromCtx with zero count reads as empty", () => {
        const spec = {
            values: arraySpec({
                element: { codec: u32 },
                count: { fromCtx: (ctx: { n: number }) => ctx.n },
            }),
        } satisfies Record<string, FieldSpec>;
        const derived = toTypedBinarySchema<typeof spec, { n: number }>(spec);
        const buf = new ArrayBuffer(0);
        const r = new BufferReader(buf, { endianness: "big" });
        expect(derived.read(r, { n: 0 })).toEqual({ values: [] });
    });
});
