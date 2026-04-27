import { describe, expect, it } from "vitest";
import type { ParsedField } from "@bgforge/binary";
import { isEditableFieldForFormat } from "../src/editors/binaryEditor-editability";

function makeField(name: string, type: ParsedField["type"], size = 4): ParsedField {
    return {
        name,
        type,
        value: 0,
        rawValue: 0,
        offset: 0,
        size,
    };
}

describe("binaryEditor-editability", () => {
    it("keeps display-only field types non-editable", () => {
        // padding and note rows are synthetic; there is no underlying byte to write.
        expect(isEditableFieldForFormat("map", "map.header.padding", makeField("Padding", "padding", 4))).toBe(false);
        expect(isEditableFieldForFormat("map", "map.header.note", makeField("Note", "note", 0))).toBe(false);
    });

    it("treats a fixed-width string with no presentation override as editable", () => {
        // No presentation entry for this hypothetical key, so only the type+size gate applies.
        expect(isEditableFieldForFormat("pro", "pro.header.label", makeField("Label", "string", 16))).toBe(true);
    });

    it("treats a zero-width string as non-editable", () => {
        expect(isEditableFieldForFormat("pro", "pro.header.label", makeField("Label", "string", 0))).toBe(false);
    });

    it("uses presentation schema editability rules for MAP fields", () => {
        expect(isEditableFieldForFormat("map", "map.header.version", makeField("Version", "uint32"))).toBe(false);
        // Filename is a 16-byte fixed string with a presentation label but no editable:false override.
        expect(isEditableFieldForFormat("map", "map.header.filename", makeField("Filename", "string", 16))).toBe(true);
        expect(
            isEditableFieldForFormat(
                "map",
                "map.objects.elevations[].objects[].inventoryHeader.inventoryPointer",
                makeField("Inventory Pointer", "uint32"),
            ),
        ).toBe(false);
        expect(
            isEditableFieldForFormat("map", "map.objects.elevations[].objects[].base.pid", makeField("PID", "uint32")),
        ).toBe(true);
    });
});
