import { describe, expect, it } from "vitest";
import { enumValueLabel, enumSelectedLabel, enumHexDigits } from "../../shared/enum-label";

describe("enumValueLabel", () => {
    it("prefixes the stored value before the name", () => {
        expect(enumValueLabel(10, "Stat: Constitution Modifier")).toBe("10 Stat: Constitution Modifier");
        expect(enumValueLabel(0, "None")).toBe("0 None");
        expect(enumValueLabel(-1, "None")).toBe("-1 None");
    });

    it("renders just the value when the name already carries it, instead of doubling the number", () => {
        // MapElevation names ARE the elevation number ("0"); CRE "Ability N" embeds the index. Prefixing would
        // show the number twice ("0 0", "0 Ability 0"), so the label renders the value alone.
        expect(enumValueLabel(0, "0")).toBe("0");
        expect(enumValueLabel(1, "Ability 1")).toBe("1");
    });

    it("treats only a whole whitespace token as a double, not a digit inside a larger token", () => {
        expect(enumValueLabel(1, "BOW03")).toBe("1 BOW03");
    });

    it("renders just the value for a blank name, with no trailing space", () => {
        expect(enumValueLabel(5, "")).toBe("5");
    });

    it("hex-formats the prefix to the requested digit width, for packed values", () => {
        // A CRE kit is a packed dword (0x00800000 = Conjurer); decimal 8388608 is meaningless. 8 digits for a
        // 4-byte field.
        expect(enumValueLabel(0x00800000, "Conjurer", 8)).toBe("0x00800000 Conjurer");
        expect(enumValueLabel(0x40010000, "Berserker", 8)).toBe("0x40010000 Berserker");
        // A CRE alignment is a packed BYTE (0x13 = lawful|evil); 2 digits, not "0x00000013".
        expect(enumValueLabel(0x13, "Lawful evil", 2)).toBe("0x13 Lawful evil");
    });

    it("treats a high-bit hex value as unsigned (no negative sign)", () => {
        // 0x80000000 read as i32 would be negative; the hex prefix is unsigned.
        expect(enumValueLabel(0x80000000, "X", 8)).toBe("0x80000000 X");
    });

    it("hexDigits 0 (the default) renders decimal", () => {
        expect(enumValueLabel(19, "Lawful evil", 0)).toBe("19 Lawful evil");
        expect(enumValueLabel(19, "Lawful evil")).toBe("19 Lawful evil");
    });
});

describe("enumHexDigits", () => {
    it("is 0 (decimal) unless the field declares hex32", () => {
        expect(enumHexDigits(undefined, 4)).toBe(0);
        expect(enumHexDigits("decimal", 4)).toBe(0);
    });

    it("follows the field's byte size: a u8 -> 2 digits, a u32 -> 8", () => {
        expect(enumHexDigits("hex32", 1)).toBe(2); // packed byte (alignment) -> 0x13
        expect(enumHexDigits("hex32", 4)).toBe(8); // packed dword (kit) -> 0x00800000
        expect(enumHexDigits("hex32", undefined)).toBe(8); // missing size: assume 4-byte
    });
});

describe("enumSelectedLabel", () => {
    const options = { "10": "Stat: Constitution Modifier", "20": "State: Invisibility" };

    it("uses the mapped option name for a known value", () => {
        expect(enumSelectedLabel(10, options)).toBe("10 Stat: Constitution Modifier");
    });

    it("falls back to a clean '<value> Unknown' for an out-of-range value, not the parser's 'Unknown (N)'", () => {
        expect(enumSelectedLabel(0, options)).toBe("0 Unknown");
        expect(enumSelectedLabel(99, undefined)).toBe("99 Unknown");
    });
});
