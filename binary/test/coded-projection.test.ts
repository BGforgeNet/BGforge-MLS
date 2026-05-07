import { describe, it, expect } from "vitest";
import { compileFlagTable, flagDictToInt, intToFlagDict, slugifyCodedName } from "../src/spec/coded-projection";

describe("slugifyCodedName", () => {
    it("camelCases PascalCase names", () => {
        expect(slugifyCodedName("Flat")).toBe("flat");
        expect(slugifyCodedName("NoBlock")).toBe("noBlock");
        expect(slugifyCodedName("MultiHex")).toBe("multiHex");
        expect(slugifyCodedName("MagicHandsGrnd")).toBe("magicHandsGrnd");
    });

    it("camelCases space-separated names", () => {
        expect(slugifyCodedName("Magic Hands")).toBe("magicHands");
        expect(slugifyCodedName("Big Gun")).toBe("bigGun");
    });

    it("strips non-alphanumerics and joins as camelCase", () => {
        expect(slugifyCodedName("Trans-Energy")).toBe("transEnergy");
        expect(slugifyCodedName("North/South")).toBe("northSouth");
    });

    it("strips surrounding punctuation", () => {
        expect(slugifyCodedName("(none)")).toBe("none");
    });

    it("rejects names that produce empty or invalid identifiers", () => {
        expect(() => slugifyCodedName("")).toThrow(/empty key/);
        expect(() => slugifyCodedName("  ")).toThrow(/empty key/);
        expect(() => slugifyCodedName("2Hnd")).toThrow(/not a valid JS identifier/);
    });
});

describe("compileFlagTable", () => {
    it("compiles entries sorted alphabetically by canonical key", () => {
        const table = {
            0x01: "Hidden",
            0x02: "Big Gun",
            0x04: "PickUp",
        };
        const { entries, namedMask } = compileFlagTable(table);
        expect(entries.map((e) => e.key)).toEqual(["bigGun", "hidden", "pickUp"]);
        expect(namedMask).toBe(0x07);
    });

    it("produces an OR'd mask covering every named bit", () => {
        const table = { 0x08: "Flat", 0x10: "NoBlock", 0x80000000: "ShootThru" };
        const { namedMask } = compileFlagTable(table);
        expect(namedMask).toBe(0x80000018 >>> 0);
    });
});

describe("intToFlagDict", () => {
    const table = {
        0x01: "Hidden",
        0x02: "BigGun",
        0x04: "PickUp",
    };

    it("returns every named key as a boolean", () => {
        expect(intToFlagDict(table, 0x05, 8)).toEqual({
            bigGun: false,
            hidden: true,
            pickUp: true,
        });
    });

    it("captures unnamed bits in _bits as hex", () => {
        expect(intToFlagDict(table, 0x09, 8)).toEqual({
            bigGun: false,
            hidden: true,
            pickUp: false,
            _bits: "0x8",
        });
    });

    it("omits _bits when unnamed bits are zero", () => {
        const dict = intToFlagDict(table, 0x07, 8);
        expect(Object.keys(dict)).not.toContain("_bits");
    });

    it("masks _bits to the codec bit width", () => {
        // u16 codec; bit 31 of input is outside the wire word, must not surface.
        const dict = intToFlagDict({ 0x01: "Lo" }, 0x80000001 | 0, 16);
        expect(dict._bits).toBeUndefined();
        expect(dict.lo).toBe(true);
    });
});

describe("flagDictToInt", () => {
    const table = {
        0x01: "Hidden",
        0x02: "BigGun",
        0x04: "PickUp",
    };

    it("packs named-bit booleans back to int", () => {
        expect(flagDictToInt(table, { hidden: true, bigGun: false, pickUp: true })).toBe(0x05);
    });

    it("ORs _bits reservoir into the int", () => {
        expect(flagDictToInt(table, { hidden: true, bigGun: false, pickUp: false, _bits: "0x80" })).toBe(0x81);
    });

    it("rejects _bits overlapping named bits (strict-disjoint)", () => {
        expect(() => flagDictToInt(table, { hidden: false, bigGun: false, pickUp: false, _bits: "0x01" })).toThrow(
            /overlaps named-bit mask/,
        );
    });

    it("rejects malformed _bits strings", () => {
        expect(() => flagDictToInt(table, { hidden: false, bigGun: false, pickUp: false, _bits: "garbage" })).toThrow(
            /hex string/,
        );
    });

    it("round-trips int → dict → int through arbitrary bits", () => {
        const u32 = 0xdeadbeef >>> 0;
        const codecBits = 32;
        const tableLarge = {
            0x00000001: "A",
            0x00000010: "B",
            0x00000100: "C",
            0x00001000: "D",
        };
        const dict = intToFlagDict(tableLarge, u32, codecBits);
        const repacked = flagDictToInt(tableLarge, dict);
        expect(repacked).toBe(u32);
    });
});
