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

    it("renders both the weapon and ammo caliber as named dropdowns", () => {
        // Caliber is the same enum on the weapon and on the ammo that feeds it; PRO derives both from their
        // specs, so both semantic keys resolve through the API.
        for (const path of ["pro.weaponStats.caliber", "pro.ammoStats.caliber"] as const) {
            expect(resolveFieldPresentation("pro", path, "Caliber")).toEqual({
                label: "Caliber",
                presentationType: "enum",
                enumOptions: expect.objectContaining({ "0": "None", "6": "5mm", "8": "10mm" }),
            });
        }
    });

    it("renders the item attack-mode nibbles as named dropdowns", () => {
        for (const slot of ["attackModePrimary", "attackModeSecondary"] as const) {
            expect(resolveFieldPresentation("pro", `pro.itemProperties.${slot}`, "Attack Mode")).toMatchObject({
                presentationType: "enum",
                enumOptions: expect.objectContaining({ "0": "None", "1": "Punch", "8": "Continuous" }),
            });
        }
    });

    it("resolves custom-labeled IE flag fields at their real semantic key", () => {
        // The walker keys these by slugify(custom label): idRequired -> "Identification" -> "identification",
        // friendly -> "Disposition" -> "disposition". The derived schema must use the same key, which means it
        // must be derived with the REAL parsing presentation, not {}.
        expect(
            resolveFieldPresentation("itm", "itm.abilities[].identification", "Identification")?.presentationType,
        ).toBe("flags");
        expect(resolveFieldPresentation("spl", "spl.abilities[].disposition", "Disposition")?.presentationType).toBe(
            "flags",
        );
    });

    it("covers Fallout critter enums once PRO derives from spec", () => {
        // The hand-written PRO schema never listed critter fields (critter rendered spec-driven). Deriving PRO
        // from the same specs closes that gap - the critter's enum/flag fields now resolve through the API too.
        expect(resolveFieldPresentation("pro", "pro.critter.bodyType", "Body Type")?.presentationType).toBe("enum");
        expect(resolveFieldPresentation("pro", "pro.critter.critterFlags", "Critter Flags")?.presentationType).toBe(
            "flags",
        );
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
