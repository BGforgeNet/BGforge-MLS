import { describe, it, expect } from "vitest";
import { u8, u16, u32, i8, i16, i32 } from "typed-binary";
import { codecNumericTypeName, codecByteLength } from "../src/spec/codec-meta";

describe("codecNumericTypeName", () => {
    it.each([
        [u8, "uint8"],
        [u16, "uint16"],
        [u32, "uint32"],
        [i8, "int8"],
        [i16, "int16"],
        [i32, "int32"],
    ] as const)("primitive -> %s", (codec, name) => {
        expect(codecNumericTypeName(codec)).toBe(name);
    });

    it("throws on unknown codec", () => {
        expect(() => codecNumericTypeName({} as never)).toThrow(/Unknown/);
    });
});

describe("codecByteLength", () => {
    it.each([
        [u8, 1],
        [u16, 2],
        [u32, 4],
        [i8, 1],
        [i16, 2],
        [i32, 4],
    ] as const)("primitive -> %i bytes", (codec, n) => {
        expect(codecByteLength(codec)).toBe(n);
    });
});
