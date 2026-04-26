import { describe, it, expect } from "vitest";
import { BufferReader, BufferWriter } from "typed-binary";
import { toTypedBinarySchema } from "../src/spec/derive-typed-binary";
import { varSectionSpec, type VarSectionCtx } from "../src/map/specs/variables";

describe("varSectionSpec", () => {
    const codec = toTypedBinarySchema<typeof varSectionSpec, VarSectionCtx>(varSectionSpec);

    it("reads N int32 values where N is supplied via ctx", () => {
        const buf = new ArrayBuffer(12);
        const w = new BufferWriter(buf, { endianness: "big" });
        w.writeInt32(-1);
        w.writeInt32(42);
        w.writeInt32(0);

        const r = new BufferReader(buf, { endianness: "big" });
        expect(codec.read(r, { count: 3 })).toEqual({ values: [-1, 42, 0] });
    });

    it("zero-count read returns an empty array without consuming bytes", () => {
        const r = new BufferReader(new ArrayBuffer(0), { endianness: "big" });
        expect(codec.read(r, { count: 0 })).toEqual({ values: [] });
    });

    it("writes the doc's array verbatim, regardless of ctx", () => {
        const buf = new ArrayBuffer(8);
        const w = new BufferWriter(buf, { endianness: "big" });
        codec.write(w, { values: [100, -200] });

        const r = new BufferReader(buf, { endianness: "big" });
        expect(r.readInt32()).toBe(100);
        expect(r.readInt32()).toBe(-200);
    });
});
