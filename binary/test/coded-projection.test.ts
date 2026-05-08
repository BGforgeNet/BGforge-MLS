import { describe, it, expect } from "vitest";
import {
    compileFlagTable,
    emptyFlagArray,
    flagArrayToInt,
    intToFlagArray,
    slugifyCodedName,
} from "../src/spec/coded-projection";
import { flagArrayZodSchema } from "../src/spec/derive-zod";

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

    it("rejects display names whose slug collides with the bit<N> sentinel", () => {
        // Cases that slugify to lowercase `bit<N>` and would shadow the
        // sentinel namespace.
        expect(() => slugifyCodedName("Bit13")).toThrow(/reserved sentinel/);
        expect(() => slugifyCodedName("Bit 0")).toThrow(/reserved sentinel/);
        expect(() => slugifyCodedName("bit 5")).toThrow(/reserved sentinel/);
        // Mixed-case variants that don't slugify to `bit<N>` are unaffected.
        expect(slugifyCodedName("BitFoo")).toBe("bitFoo");
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

describe("intToFlagArray", () => {
    const table = {
        0x01: "Hidden",
        0x02: "BigGun",
        0x04: "PickUp",
    };

    it("returns named slugs of set bits, sorted alphabetically", () => {
        expect(intToFlagArray(table, 0x05, 8)).toEqual(["hidden", "pickUp"]);
    });

    it("returns an empty array when no bits are set", () => {
        expect(intToFlagArray(table, 0x00, 8)).toEqual([]);
    });

    it("appends bit<N> entries for unnamed set bits, in numeric order after the named slugs", () => {
        expect(intToFlagArray(table, 0x09, 8)).toEqual(["hidden", "bit3"]);
    });

    it("emits no bit<N> entries when all set bits are named", () => {
        const result = intToFlagArray(table, 0x07, 8);
        expect(result.some((entry) => /^bit\d+$/.test(entry))).toBe(false);
    });

    it("masks unnamed bits to the codec bit width", () => {
        // u16 codec; bit 31 of input is outside the wire word, must not surface.
        const result = intToFlagArray({ 0x01: "Lo" }, 0x80000001 | 0, 16);
        expect(result).toEqual(["lo"]);
    });

    it("emits a bit<N> for each set unnamed bit, numerically ordered", () => {
        // bits 5 and 13 are unnamed in `{ 0x1: "a" }`.
        const result = intToFlagArray({ 0x01: "a" }, 0x2021, 16);
        expect(result).toEqual(["a", "bit5", "bit13"]);
    });
});

describe("flagArrayToInt", () => {
    const table = {
        0x01: "Hidden",
        0x02: "BigGun",
        0x04: "PickUp",
    };

    it("packs named slugs back to int", () => {
        expect(flagArrayToInt(table, ["hidden", "pickUp"], 8)).toBe(0x05);
    });

    it("treats an empty array as zero", () => {
        expect(flagArrayToInt(table, [], 8)).toBe(0);
    });

    it("ORs bit<N> sentinels into the result", () => {
        expect(flagArrayToInt(table, ["hidden", "bit7"], 8)).toBe(0x81);
    });

    it("rejects bit<N> that occupies a named-bit position (strict-disjoint)", () => {
        expect(() => flagArrayToInt(table, ["bit0"], 8)).toThrow(/overlaps named-bit mask/);
    });

    it("rejects bit<N> with N >= codecBitWidth", () => {
        expect(() => flagArrayToInt(table, ["bit8"], 8)).toThrow(/exceeds codec width/);
    });

    it("rejects unknown flag names not in the table and not bit<N>", () => {
        expect(() => flagArrayToInt(table, ["unknownBit"], 8)).toThrow(/unknown flag/i);
    });

    it("rejects duplicate entries in the array", () => {
        expect(() => flagArrayToInt(table, ["hidden", "hidden"], 8)).toThrow(/duplicate/i);
    });

    it("round-trips int -> array -> int through arbitrary bits", () => {
        const u32 = 0xdeadbeef >>> 0;
        const codecBits = 32;
        const tableLarge = {
            0x00000001: "A",
            0x00000010: "B",
            0x00000100: "C",
            0x00001000: "D",
        };
        const projected = intToFlagArray(tableLarge, u32, codecBits);
        const repacked = flagArrayToInt(tableLarge, projected, codecBits);
        expect(repacked).toBe(u32);
    });
});

describe("emptyFlagArray", () => {
    it("returns an empty array", () => {
        const table = { 0x01: "Hidden", 0x02: "BigGun" };
        expect(emptyFlagArray(table)).toEqual([]);
    });
});

describe("flagArrayZodSchema", () => {
    const table = {
        0x01: "Hidden",
        0x02: "BigGun",
        0x04: "PickUp",
    };

    it("accepts an empty array", () => {
        const schema = flagArrayZodSchema(table, 8);
        expect(() => schema.parse([])).not.toThrow();
    });

    it("accepts known names in any order", () => {
        const schema = flagArrayZodSchema(table, 8);
        expect(() => schema.parse(["bigGun", "hidden"])).not.toThrow();
        expect(() => schema.parse(["hidden", "bigGun"])).not.toThrow();
    });

    it("rejects unknown flag names", () => {
        const schema = flagArrayZodSchema(table, 8);
        expect(() => schema.parse(["unknown"])).toThrow();
    });

    it("rejects duplicate entries", () => {
        const schema = flagArrayZodSchema(table, 8);
        expect(() => schema.parse(["hidden", "hidden"])).toThrow();
    });

    it("rejects non-array shapes", () => {
        const schema = flagArrayZodSchema(table, 8);
        expect(() => schema.parse("hidden")).toThrow();
        expect(() => schema.parse({ flags: [] })).toThrow();
    });

    it("accepts bit<N> for unnamed positions within codec width", () => {
        const schema = flagArrayZodSchema(table, 8);
        expect(() => schema.parse(["bit7"])).not.toThrow();
        expect(() => schema.parse(["hidden", "bit3"])).not.toThrow();
    });

    it("rejects bit<N> with N >= codecBitWidth", () => {
        // u8 codec -> N must be in [0, 8).
        const schema = flagArrayZodSchema(table, 8);
        expect(() => schema.parse(["bit8"])).toThrow();
    });

    it("rejects bit<N> overlapping a named-bit position", () => {
        const schema = flagArrayZodSchema(table, 8);
        // bit 0 is named "hidden" (mask 0x01); a literal "bit0" must use the slug.
        expect(() => schema.parse(["bit0"])).toThrow();
    });
});
