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

    it("returns slugified names of set bits, sorted alphabetically", () => {
        expect(intToFlagArray(table, 0x05, 8)).toEqual({ flags: ["hidden", "pickUp"] });
    });

    it("returns an empty array when no bits are set", () => {
        expect(intToFlagArray(table, 0x00, 8)).toEqual({ flags: [] });
    });

    it("returns flagsRaw alongside flags when unnamed bits are present", () => {
        expect(intToFlagArray(table, 0x09, 8)).toEqual({
            flags: ["hidden"],
            flagsRaw: "0x8",
        });
    });

    it("omits flagsRaw when all set bits are named", () => {
        const result = intToFlagArray(table, 0x07, 8);
        expect(result).not.toHaveProperty("flagsRaw");
    });

    it("masks unnamed bits to the codec bit width", () => {
        // u16 codec; bit 31 of input is outside the wire word, must not surface.
        const result = intToFlagArray({ 0x01: "Lo" }, 0x80000001 | 0, 16);
        expect(result).toEqual({ flags: ["lo"] });
    });
});

describe("flagArrayToInt", () => {
    const table = {
        0x01: "Hidden",
        0x02: "BigGun",
        0x04: "PickUp",
    };

    it("packs an array of slugified names back to int", () => {
        expect(flagArrayToInt(table, { flags: ["hidden", "pickUp"] })).toBe(0x05);
    });

    it("treats omitted flagsRaw as zero reservoir", () => {
        expect(flagArrayToInt(table, { flags: ["hidden"] })).toBe(0x01);
    });

    it("ORs flagsRaw into the result", () => {
        expect(flagArrayToInt(table, { flags: ["hidden"], flagsRaw: "0x80" })).toBe(0x81);
    });

    it("rejects flagsRaw bits that overlap named bits (strict-disjoint)", () => {
        expect(() => flagArrayToInt(table, { flags: [], flagsRaw: "0x01" })).toThrow(/overlaps named-bit mask/);
    });

    it("rejects malformed flagsRaw strings", () => {
        expect(() => flagArrayToInt(table, { flags: [], flagsRaw: "garbage" })).toThrow(/hex string/);
    });

    it("rejects unknown flag names not in the table", () => {
        expect(() => flagArrayToInt(table, { flags: ["unknownBit"] })).toThrow(/unknown flag/i);
    });

    it("rejects duplicate flag names in the array", () => {
        expect(() => flagArrayToInt(table, { flags: ["hidden", "hidden"] })).toThrow(/duplicate/i);
    });

    it("round-trips int → array → int through arbitrary bits", () => {
        const u32 = 0xdeadbeef >>> 0;
        const codecBits = 32;
        const tableLarge = {
            0x00000001: "A",
            0x00000010: "B",
            0x00000100: "C",
            0x00001000: "D",
        };
        const projected = intToFlagArray(tableLarge, u32, codecBits);
        const repacked = flagArrayToInt(tableLarge, projected);
        expect(repacked).toBe(u32);
    });
});

describe("emptyFlagArray", () => {
    it("returns a projection with an empty flags array and no flagsRaw", () => {
        const table = { 0x01: "Hidden", 0x02: "BigGun" };
        expect(emptyFlagArray(table)).toEqual({ flags: [] });
    });
});

describe("flagArrayZodSchema", () => {
    const table = {
        0x01: "Hidden",
        0x02: "BigGun",
        0x04: "PickUp",
    };

    it("accepts an empty flags array with no flagsRaw", () => {
        const schema = flagArrayZodSchema(table, 8);
        expect(() => schema.parse({ flags: [] })).not.toThrow();
    });

    it("accepts known names sorted alphabetically", () => {
        const schema = flagArrayZodSchema(table, 8);
        expect(() => schema.parse({ flags: ["bigGun", "hidden"] })).not.toThrow();
    });

    it("rejects unknown flag names", () => {
        const schema = flagArrayZodSchema(table, 8);
        expect(() => schema.parse({ flags: ["unknown"] })).toThrow();
    });

    it("rejects duplicate names in the array", () => {
        const schema = flagArrayZodSchema(table, 8);
        expect(() => schema.parse({ flags: ["hidden", "hidden"] })).toThrow();
    });

    it("rejects non-array flags field", () => {
        const schema = flagArrayZodSchema(table, 8);
        expect(() => schema.parse({ flags: "hidden" })).toThrow();
    });

    it("accepts an optional flagsRaw within codec width", () => {
        const schema = flagArrayZodSchema(table, 8);
        expect(() => schema.parse({ flags: [], flagsRaw: "0x80" })).not.toThrow();
    });

    it("rejects flagsRaw exceeding codec hex digits", () => {
        // u8 codec → max 2 hex digits.
        const schema = flagArrayZodSchema(table, 8);
        expect(() => schema.parse({ flags: [], flagsRaw: "0x100" })).toThrow();
    });

    it("rejects extra unknown keys (z.strictObject)", () => {
        const schema = flagArrayZodSchema(table, 8);
        expect(() => schema.parse({ flags: [], extra: true })).toThrow();
    });
});
