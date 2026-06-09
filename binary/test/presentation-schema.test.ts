import { describe, expect, it } from "vitest";
import { getFormatPresentationSchema, resolveFieldPresentation, toNumericOptionMap } from "../src/presentation-schema";

describe("presentation-schema", () => {
    it("exposes per-format presentation metadata for external consumers", () => {
        expect(getFormatPresentationSchema("pro")).toMatchObject({
            schemaVersion: 1,
            format: "pro",
        });
        expect(getFormatPresentationSchema("map")).toMatchObject({
            schemaVersion: 1,
            format: "map",
        });
        expect(getFormatPresentationSchema("frm")).toBeUndefined();
    });

    it("resolves exact field metadata", () => {
        expect(resolveFieldPresentation("pro", "pro.header.objectType", "Object Type")).toEqual({
            label: "Object Type",
            presentationType: "enum",
            enumOptions: expect.objectContaining({
                "0": "Item",
                "2": "Scenery",
            }),
        });
    });

    it("renders the CRE selected-weapon slot as the engine weapon-slot enum", () => {
        // IESDP cre_v1.htm: selected weapon = slots.ids index - 35 (weapon slots begin at 35), so 0-3 are
        // Weapon 1-4; 1000 = fist. A fixed engine enum, not a document-derived item reference.
        expect(resolveFieldPresentation("cre", "cre.itemSlots.selectedWeapon", "Selected weapon")).toEqual({
            label: "Selected weapon",
            editable: true,
            presentationType: "enum",
            enumOptions: {
                "0": "Weapon 1",
                "1": "Weapon 2",
                "2": "Weapon 3",
                "3": "Weapon 4",
                "1000": "Fist",
            },
        });
    });

    it("merges pattern metadata for dynamic MAP fields", () => {
        expect(resolveFieldPresentation("map", "map.objects.elevations[].objects[].base.pid", "PID")).toEqual({
            numericFormat: "hex32",
        });

        expect(resolveFieldPresentation("map", "map.scripts[].extents[].slots[].flags", "Entry 0 Flags")).toEqual({
            presentationType: "flags",
            flagOptions: expect.objectContaining({
                "1": "Loaded",
                "16": "NoRemove",
            }),
        });
    });

    it("converts string-keyed options to numeric lookup tables", () => {
        expect(toNumericOptionMap({ "1": "One", "16": "Sixteen" })).toEqual({
            1: "One",
            16: "Sixteen",
        });
        expect(toNumericOptionMap()).toBeUndefined();
    });
});
