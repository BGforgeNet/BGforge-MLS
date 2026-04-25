import { describe, expect, it } from "vitest";
import type { ParsedField } from "@bgforge/binary";
import { isEditableFieldForFormat } from "../src/editors/binaryEditor-editability";

function makeField(name: string, type: ParsedField["type"]): ParsedField {
    return {
        name,
        type,
        value: 0,
        rawValue: 0,
        offset: 0,
        size: 4,
    };
}

describe("binaryEditor-editability", () => {
    it("keeps non-numeric display-only fields non-editable", () => {
        expect(isEditableFieldForFormat("pro", "pro.header.label", makeField("Label", "string"))).toBe(false);
    });

    it("uses presentation schema editability rules for MAP fields", () => {
        expect(isEditableFieldForFormat("map", "map.header.version", makeField("Version", "uint32"))).toBe(false);
        expect(isEditableFieldForFormat("map", "map.header.filename", makeField("Filename", "string"))).toBe(false);
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
