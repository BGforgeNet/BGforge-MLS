/**
 * Unit tests for binary editor field validation.
 * Tests range checks, enum membership, and flag mask validation.
 */

import { describe, expect, it } from "vitest";
import {
    validateNumericRange,
    validateEnum,
    validateFlags,
    validateString,
    validateFieldEdit,
} from "../src/editors/binaryEditor-validation";

describe("validateNumericRange", () => {
    it("accepts valid uint8 values", () => {
        expect(validateNumericRange(0, "uint8")).toBeUndefined();
        expect(validateNumericRange(255, "uint8")).toBeUndefined();
        expect(validateNumericRange(128, "uint8")).toBeUndefined();
    });

    it("rejects out-of-range uint8 values", () => {
        expect(validateNumericRange(-1, "uint8")).toBeDefined();
        expect(validateNumericRange(256, "uint8")).toBeDefined();
    });

    it("accepts valid uint16 values", () => {
        expect(validateNumericRange(0, "uint16")).toBeUndefined();
        expect(validateNumericRange(65_535, "uint16")).toBeUndefined();
    });

    it("rejects out-of-range uint16 values", () => {
        expect(validateNumericRange(-1, "uint16")).toBeDefined();
        expect(validateNumericRange(65_536, "uint16")).toBeDefined();
    });

    it("accepts valid uint24 values", () => {
        expect(validateNumericRange(0, "uint24")).toBeUndefined();
        expect(validateNumericRange(0xff_ff_ff, "uint24")).toBeUndefined();
    });

    it("rejects out-of-range uint24 values", () => {
        expect(validateNumericRange(-1, "uint24")).toBeDefined();
        expect(validateNumericRange(0x1_00_00_00, "uint24")).toBeDefined();
    });

    it("accepts valid uint32 values", () => {
        expect(validateNumericRange(0, "uint32")).toBeUndefined();
        expect(validateNumericRange(0xff_ff_ff_ff, "uint32")).toBeUndefined();
    });

    it("rejects out-of-range uint32 values", () => {
        expect(validateNumericRange(-1, "uint32")).toBeDefined();
        expect(validateNumericRange(0x1_00_00_00_00, "uint32")).toBeDefined();
    });

    it("accepts valid int32 values", () => {
        expect(validateNumericRange(0, "int32")).toBeUndefined();
        expect(validateNumericRange(-2_147_483_648, "int32")).toBeUndefined();
        expect(validateNumericRange(2_147_483_647, "int32")).toBeUndefined();
    });

    it("rejects out-of-range int32 values", () => {
        expect(validateNumericRange(-2_147_483_649, "int32")).toBeDefined();
        expect(validateNumericRange(2_147_483_648, "int32")).toBeDefined();
    });

    it("rejects non-integer values", () => {
        expect(validateNumericRange(1.5, "uint32")).toBeDefined();
        expect(validateNumericRange(NaN, "int32")).toBeDefined();
    });

    it("returns undefined for unknown types", () => {
        expect(validateNumericRange(42, "unknown")).toBeUndefined();
    });

    it("applies domain-specific ranges when field context is provided", () => {
        expect(
            validateNumericRange(8, "uint32", { format: "pro", fieldKey: "pro.header.lightRadius" }),
        ).toBeUndefined();
        expect(validateNumericRange(9, "uint32", { format: "pro", fieldKey: "pro.header.lightRadius" })).toContain(
            "allowed range",
        );
        expect(
            validateNumericRange(2, "int32", { format: "map", fieldKey: "map.header.defaultElevation" }),
        ).toBeUndefined();
        expect(validateNumericRange(3, "int32", { format: "map", fieldKey: "map.header.defaultElevation" })).toContain(
            "allowed range",
        );
    });
});

describe("validateEnum", () => {
    const lookup: Record<number, string> = { 0: "A", 1: "B", 2: "C" };

    it("accepts valid enum values", () => {
        expect(validateEnum(0, lookup)).toBeUndefined();
        expect(validateEnum(1, lookup)).toBeUndefined();
        expect(validateEnum(2, lookup)).toBeUndefined();
    });

    it("rejects invalid enum values", () => {
        expect(validateEnum(3, lookup)).toBeDefined();
        expect(validateEnum(-1, lookup)).toBeDefined();
        expect(validateEnum(99, lookup)).toBeDefined();
    });
});

describe("validateFlags", () => {
    const flagDefs: Record<number, string> = { 0x01: "A", 0x02: "B", 0x04: "C" };

    it("accepts valid flag combinations", () => {
        expect(validateFlags(0, flagDefs)).toBeUndefined();
        expect(validateFlags(0x01, flagDefs)).toBeUndefined();
        expect(validateFlags(0x03, flagDefs)).toBeUndefined();
        expect(validateFlags(0x07, flagDefs)).toBeUndefined();
    });

    it("rejects flags with invalid bits set", () => {
        expect(validateFlags(0x08, flagDefs)).toBeDefined();
        expect(validateFlags(0xff, flagDefs)).toBeDefined();
    });

    it("accepts zero flags even with no zero key", () => {
        expect(validateFlags(0, { 0x01: "A" })).toBeUndefined();
    });
});

describe("validateString", () => {
    it("accepts strings within the byte budget", () => {
        expect(validateString("", 16)).toBeUndefined();
        expect(validateString("abcd", 16)).toBeUndefined();
        expect(validateString("0123456789abcdef", 16)).toBeUndefined();
    });

    it("rejects strings exceeding the byte budget", () => {
        expect(validateString("0123456789abcdefg", 16)).toContain("16 bytes");
    });

    it("counts UTF-8 byte length, not character count", () => {
        // "é" is 2 bytes in UTF-8; eight of them is 16 bytes (just fits).
        expect(validateString("éééééééé", 16)).toBeUndefined();
        // Nine is 18 bytes (overflows).
        expect(validateString("ééééééééé", 16)).toContain("16 bytes");
    });

    it("accepts any UTF-8 within budget when charset is utf8 (default)", () => {
        expect(validateString("café", 16, "utf8")).toBeUndefined();
        expect(validateString("hello", 16)).toBeUndefined();
    });

    it("rejects non-printable-ASCII when charset is ascii-printable", () => {
        expect(validateString("hello", 16, "ascii-printable")).toBeUndefined();
        expect(validateString("café", 16, "ascii-printable")).toContain("ASCII");
        expect(validateString("hello\tworld", 16, "ascii-printable")).toContain("ASCII");
        expect(validateString("hi\u0000there", 16, "ascii-printable")).toContain("ASCII");
    });

    it("accepts the printable-ASCII range boundaries", () => {
        // 0x20 (space) through 0x7E (tilde) inclusive.
        expect(validateString(" ~", 16, "ascii-printable")).toBeUndefined();
    });
});

describe("validateFieldEdit", () => {
    it("rejects out-of-range numeric edits before writing", () => {
        expect(validateFieldEdit(256, "uint8")).toContain("out of range");
        expect(validateFieldEdit(-1, "uint32")).toContain("out of range");
    });

    it("validates enum fields against both range and lookup", () => {
        expect(validateFieldEdit(1, "enum", { 0: "A", 1: "B" })).toBeUndefined();
        expect(validateFieldEdit(2, "enum", { 0: "A", 1: "B" })).toContain("Invalid value");
    });

    it("validates flag fields against the declared mask", () => {
        expect(validateFieldEdit(0x03, "flags", undefined, { 0x01: "A", 0x02: "B" })).toBeUndefined();
        expect(validateFieldEdit(0x08, "flags", undefined, { 0x01: "A", 0x02: "B" })).toContain("Invalid flag bits");
    });

    it("enforces domain-specific constraints for numeric field edits", () => {
        expect(
            validateFieldEdit(9, "uint32", undefined, undefined, { format: "pro", fieldKey: "pro.header.lightRadius" }),
        ).toContain("allowed range");
    });

    it("validates string fields against byte budget and charset", () => {
        expect(
            validateFieldEdit("MAP_NAME.SAV", "string", undefined, undefined, {
                format: "map",
                fieldKey: "map.header.filename",
                maxBytes: 16,
                stringCharset: "ascii-printable",
            }),
        ).toBeUndefined();
        expect(
            validateFieldEdit("café", "string", undefined, undefined, {
                format: "map",
                fieldKey: "map.header.filename",
                maxBytes: 16,
                stringCharset: "ascii-printable",
            }),
        ).toContain("ASCII");
        expect(
            validateFieldEdit("0123456789abcdefg", "string", undefined, undefined, {
                format: "map",
                fieldKey: "map.header.filename",
                maxBytes: 16,
                stringCharset: "ascii-printable",
            }),
        ).toContain("16 bytes");
    });
});
