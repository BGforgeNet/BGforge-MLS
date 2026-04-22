import { describe, expect, it } from "vitest";
import {
    formatEditableNumberValue,
    formatNumericValue,
    parseEditableNumberValue,
    sanitizeEditableNumberValue,
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
        expect(formatNumericValue(0x05_00_00_0C, "hex32")).toBe("0x500000C");
    });

    it("formats editable numeric values without a hex prefix", () => {
        expect(formatEditableNumberValue(42, "decimal")).toBe("42");
        expect(formatEditableNumberValue(0x05_00_00_0C, "hex32")).toBe("500000C");
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
        expect(parseEditableNumberValue("FFFFFFFF", "hex32", "uint32")).toBe(0xFF_FF_FF_FF);
        expect(parseEditableNumberValue("FFFFFFFF", "hex32", "int32")).toBe(-1);
        expect(parseEditableNumberValue("80000000", "hex32", "uint32")).toBe(0x80_00_00_00);
        expect(parseEditableNumberValue("80000000", "hex32", "int32")).toBe(-2_147_483_648);
    });
});
