import { describe, expect, it } from "vitest";
import {
    formatEditableNumberValue,
    formatNumericValue,
    parseEditableNumberValue,
    sanitizeEditableNumberValue,
    sanitizeEditableStringValue,
} from "../src/editors/binaryEditor-formatting";
import { resolveNumericFormat } from "../src/editors/binaryEditor-numericFormat";

describe("binaryEditor-formatting", () => {
    it("uses hex32 formatting for MAP PID/FID/CID/SID fields", () => {
        expect(resolveNumericFormat("map", "map.objects.elevations[].objects[].base.pid", "PID")).toBe("hex32");
        expect(resolveNumericFormat("map", "map.objects.elevations[].objects[].base.fid", "FID")).toBe("hex32");
        expect(resolveNumericFormat("map", "map.objects.elevations[].objects[].base.cid", "CID")).toBe("hex32");
        expect(resolveNumericFormat("map", "map.scripts[].extents[].slots[].sid", "Entry 0 SID")).toBe("hex32");
        expect(resolveNumericFormat("map", "map.header.defaultOrientation", "Default Orientation")).toBe("decimal");
    });

    it("formats signed 32-bit values as raw hex bit patterns", () => {
        expect(formatNumericValue(-1, "hex32")).toBe("0xFFFFFFFF");
        expect(formatNumericValue(0x05_00_00_0c, "hex32")).toBe("0x500000C");
    });

    it("formats editable numeric values without a hex prefix", () => {
        expect(formatEditableNumberValue(42, "decimal")).toBe("42");
        expect(formatEditableNumberValue(0x05_00_00_0c, "hex32")).toBe("500000C");
    });

    it("sanitizes editable values by numeric format", () => {
        expect(sanitizeEditableNumberValue("12a-3", "decimal")).toBe("123");
        expect(sanitizeEditableNumberValue("-123", "decimal")).toBe("-123");
        expect(sanitizeEditableNumberValue("5g0x2z6", "hex32")).toBe("5026");
        expect(sanitizeEditableNumberValue("abCD", "hex32")).toBe("ABCD");
    });

    it("parses editable values by numeric format", () => {
        expect(parseEditableNumberValue("-12", "decimal")).toBe(-12);
        expect(parseEditableNumberValue("5000026", "hex32")).toBe(0x5_00_00_26);
        expect(Number.isNaN(parseEditableNumberValue("", "hex32"))).toBe(true);
        expect(Number.isNaN(parseEditableNumberValue("xyz", "hex32"))).toBe(true);
    });

    it("parses hex32 values according to the backing integer type", () => {
        expect(parseEditableNumberValue("FFFFFFFF", "hex32", "uint32")).toBe(0xff_ff_ff_ff);
        expect(parseEditableNumberValue("FFFFFFFF", "hex32", "int32")).toBe(-1);
        expect(parseEditableNumberValue("80000000", "hex32", "uint32")).toBe(0x80_00_00_00);
        expect(parseEditableNumberValue("80000000", "hex32", "int32")).toBe(-2_147_483_648);
    });

    describe("sanitizeEditableStringValue", () => {
        it("passes through valid printable ASCII unchanged", () => {
            expect(sanitizeEditableStringValue("HELLO.SAV", 16, "ascii-printable")).toBe("HELLO.SAV");
            expect(sanitizeEditableStringValue("a b ~", 16, "ascii-printable")).toBe("a b ~");
        });

        it("strips non-printable-ASCII when charset is ascii-printable", () => {
            expect(sanitizeEditableStringValue("café", 16, "ascii-printable")).toBe("caf");
            expect(sanitizeEditableStringValue("a\tb\nc", 16, "ascii-printable")).toBe("abc");
            expect(sanitizeEditableStringValue("hi\u0000there", 16, "ascii-printable")).toBe("hithere");
        });

        it("clamps to the byte budget under ascii-printable (1 byte per char)", () => {
            expect(sanitizeEditableStringValue("0123456789abcdefg", 16, "ascii-printable")).toBe("0123456789abcdef");
        });

        it("preserves UTF-8 input but clamps the byte budget when charset is utf8", () => {
            // "é" is 2 bytes; eight é's = 16 bytes (just fits).
            expect(sanitizeEditableStringValue("éééééééé", 16, "utf8")).toBe("éééééééé");
            // Adding one more must drop the trailing codepoint, not split it.
            expect(sanitizeEditableStringValue("ééééééééé", 16, "utf8")).toBe("éééééééé");
        });
    });
});
