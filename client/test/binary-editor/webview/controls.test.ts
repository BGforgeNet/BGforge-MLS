import { describe, expect, it } from "vitest";
import type { Row } from "@bgforge/binary-editor";
import {
    enumOptionList,
    decomposeFlags,
    composeFlags,
    controlKind,
    filterOptions,
    parseCustomValue,
    valueTier,
    dropdownWidth,
} from "../../../src/binary-editor/webview/state/controls";

const enumRow: Row = {
    id: "0",
    namePath: ["Race"],
    depth: 1,
    kind: "field",
    name: "Race",
    valueType: "enum",
    rawValue: 1,
    displayValue: "Mutant",
    editable: true,
    enumOptions: { "0": "Human", "1": "Mutant" },
};
// flagOptions are keyed by bit MASK, matching real producer output (walkStruct emits
// stringifyKeys(fs.flags), and every PRO/IE flag table is mask-keyed: { "1": ..., "4": ... }).
const flagRow: Row = {
    id: "1",
    namePath: ["Flags"],
    depth: 1,
    kind: "field",
    name: "Flags",
    valueType: "flags",
    rawValue: 5,
    displayValue: "5",
    editable: true,
    flagOptions: { "1": "Visible", "4": "Dead" },
};

describe("controls", () => {
    it("classifies control kind by valueType", () => {
        expect(controlKind(enumRow)).toBe("enum");
        expect(controlKind(flagRow)).toBe("flags");
        expect(controlKind({ ...enumRow, valueType: "uint16", enumOptions: undefined })).toBe("number");
        expect(controlKind({ ...enumRow, valueType: "string", enumOptions: undefined })).toBe("string");
    });

    it("builds an enum option list with value-prefixed labels, injecting '<n> Unknown' for an out-of-range value", () => {
        // Every option label carries its stored value as a prefix ("<value> <name>"), so a dropdown reads
        // against the raw byte uniformly across formats; the synthetic out-of-range option follows the same form.
        expect(enumOptionList(enumRow)).toEqual([
            { value: 0, label: "0 Human" },
            { value: 1, label: "1 Mutant" },
        ]);
        const oor = enumOptionList({ ...enumRow, rawValue: 9 });
        expect(oor).toContainEqual({ value: 9, label: "9 Unknown" });
        // A blank label (e.g. an item with no ResRef) renders as just the value, with no trailing space.
        expect(enumOptionList({ ...enumRow, enumOptions: { "5": "" }, rawValue: 5 })).toContainEqual({
            value: 5,
            label: "5",
        });
    });

    it("renders just the value when the name already carries it, instead of doubling the number", () => {
        // MapElevation names ARE the elevation number ("0"); CRE "Ability N" embeds the index. Prefixing would
        // show the number twice ("0 0", "0 Ability 0"), so the option renders the value alone.
        expect(enumOptionList({ ...enumRow, enumOptions: { "0": "0", "1": "1" }, rawValue: 0 })).toEqual([
            { value: 0, label: "0" },
            { value: 1, label: "1" },
        ]);
        expect(
            enumOptionList({ ...enumRow, enumOptions: { "0": "Ability 0", "1": "Ability 1" }, rawValue: 0 }),
        ).toEqual([
            { value: 0, label: "0" },
            { value: 1, label: "1" },
        ]);
        // A name that merely contains the digit as part of a larger token is NOT a double (value 1 vs "BOW03").
        expect(enumOptionList({ ...enumRow, enumOptions: { "1": "BOW03" }, rawValue: 1 })).toEqual([
            { value: 1, label: "1 BOW03" },
        ]);
    });

    it("decomposes and recomposes flag bits by mask", () => {
        // rawValue 5 = masks 0x1 and 0x4 set
        expect(decomposeFlags(flagRow)).toEqual([
            { mask: 1, label: "Visible", set: true },
            { mask: 4, label: "Dead", set: true },
        ]);
        expect(composeFlags(5, 1, false)).toBe(4); // clear mask 0x1
        expect(composeFlags(4, 1, true)).toBe(5); // set mask 0x1
    });

    it("handles a high-bit mask without producing a negative value", () => {
        // 0x80000000 would go negative under signed bitwise ops without the unsigned guard.
        expect(composeFlags(0, 0x80000000, true)).toBe(0x80000000);
        expect(composeFlags(0xffffffff, 0x80000000, false)).toBe(0x7fffffff);
        const highRow: Row = { ...flagRow, rawValue: 0x80000000, flagOptions: { "2147483648": "High" } };
        expect(decomposeFlags(highRow)).toEqual([{ mask: 0x80000000, label: "High", set: true }]);
    });
});

describe("valueTier", () => {
    // A plain numeric field (not enum/flags/string). controlKind() -> "number".
    const numberRow: Row = { ...enumRow, valueType: "uint16", enumOptions: undefined, rawValue: 5, displayValue: "5" };
    const stringRow = (size: number): Row => ({ ...numberRow, valueType: "string", size, displayValue: "x" });

    it("puts plain decimal numbers in the small tier regardless of byte size", () => {
        expect(valueTier(numberRow)).toBe("s");
        expect(valueTier({ ...numberRow, valueType: "uint32", size: 4 })).toBe("s");
    });

    it("puts hex-formatted numbers in the medium tier", () => {
        expect(valueTier({ ...numberRow, numericFormat: "hex32" })).toBe("m");
    });

    it("sizes string fields by their char-array length", () => {
        expect(valueTier(stringRow(4))).toBe("s"); // <= 6 chars
        expect(valueTier(stringRow(6))).toBe("s");
        expect(valueTier(stringRow(8))).toBe("m"); // resref: 7-12 chars
        expect(valueTier(stringRow(12))).toBe("m");
        expect(valueTier(stringRow(16))).toBe("ml"); // 13-20 chars -> mid-large
        expect(valueTier(stringRow(32))).toBe("l"); // long char array
    });

    // Enums no longer route through valueTier - they have their own measured `dropdownWidth` (decoupled from
    // the text tiers). Its bucketing needs real text metrics (canvas), so it is verified in the Playwright
    // render harnesses (render-itm/render-cre), not here. In jsdom (no 2d context) it fails wide to dd-5.
});

describe("dropdownWidth", () => {
    it("fails wide when text metrics are unavailable (jsdom has no 2d canvas context)", () => {
        // Without a measurable font the width can't be computed, so a dropdown must never clip - it picks dd-5.
        expect(dropdownWidth(enumRow)).toBe("dd-5");
    });
});

const sampleOptions = [
    { value: 0, label: "None" },
    { value: 1, label: "Fire Damage" },
    { value: 2, label: "Cold Damage" },
    { value: 3, label: "Fireball" },
    { value: 100, label: "Charm Animal" },
];

describe("filterOptions", () => {
    it("returns all options for an empty query", () => {
        expect(filterOptions(sampleOptions, "")).toEqual(sampleOptions);
    });

    it("returns all options for a whitespace-only query", () => {
        expect(filterOptions(sampleOptions, "   ")).toEqual(sampleOptions);
    });

    it("filters case-insensitively", () => {
        const result = filterOptions(sampleOptions, "fire");
        expect(result).toContainEqual({ value: 1, label: "Fire Damage" });
        expect(result).toContainEqual({ value: 3, label: "Fireball" });
        expect(result).not.toContainEqual({ value: 2, label: "Cold Damage" });
    });

    it("matches substrings, not just prefixes", () => {
        const result = filterOptions(sampleOptions, "damage");
        expect(result).toContainEqual({ value: 1, label: "Fire Damage" });
        expect(result).toContainEqual({ value: 2, label: "Cold Damage" });
        expect(result).not.toContainEqual({ value: 3, label: "Fireball" });
    });

    it("returns empty array when no options match", () => {
        expect(filterOptions(sampleOptions, "zzznomatch")).toEqual([]);
    });
});

describe("parseCustomValue", () => {
    it("returns a finite integer for a numeric string", () => {
        expect(parseCustomValue("0")).toBe(0);
        expect(parseCustomValue("42")).toBe(42);
        expect(parseCustomValue("-5")).toBe(-5);
    });

    it("returns undefined for non-numeric input", () => {
        expect(parseCustomValue("fire")).toBeUndefined();
        expect(parseCustomValue("")).toBeUndefined();
        expect(parseCustomValue("  ")).toBeUndefined();
    });

    it("accepts a leading plus sign", () => {
        expect(parseCustomValue("+5")).toBe(5);
    });

    it("returns undefined for non-integer numeric strings", () => {
        expect(parseCustomValue("3.14")).toBeUndefined();
        expect(parseCustomValue("1e2")).toBeUndefined();
    });

    it("returns undefined for hex strings (Number would coerce 0xff -> 255)", () => {
        expect(parseCustomValue("0xff")).toBeUndefined();
        expect(parseCustomValue("0xef")).toBeUndefined();
    });

    it("returns undefined for Infinity and NaN", () => {
        expect(parseCustomValue("Infinity")).toBeUndefined();
        expect(parseCustomValue("NaN")).toBeUndefined();
    });
});
