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

    it("builds an enum option list, injecting Unknown(N) for an out-of-range value", () => {
        expect(enumOptionList(enumRow)).toEqual([
            { value: 0, label: "Human" },
            { value: 1, label: "Mutant" },
        ]);
        const oor = enumOptionList({ ...enumRow, rawValue: 9 });
        expect(oor).toContainEqual({ value: 9, label: "Unknown (9)" });
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
        expect(valueTier(stringRow(32))).toBe("l"); // long char array
    });

    it("sizes plain enum dropdowns at medium; a long option ellipsizes rather than forcing the wide L tier", () => {
        expect(valueTier(enumRow)).toBe("m"); // short labels -> m
        const longEnum: Row = { ...enumRow, enumOptions: { "0": "A very long dropdown option label" } };
        expect(valueTier(longEnum)).toBe("m"); // a long option no longer widens the box; it ellipsizes in m
    });

    it("keeps the searchable combobox (e.g. the effect opcode) at the wide L tier", () => {
        const searchable: Row = { ...enumRow, searchableEnum: true };
        expect(valueTier(searchable)).toBe("l");
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
