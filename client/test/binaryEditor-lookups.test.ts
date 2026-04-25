import { describe, expect, it } from "vitest";
import {
    formatEnumDisplayValue,
    resolveDisplayValue,
    resolveEnumLookup,
    resolveFlagLookup,
} from "../src/editors/binaryEditor-lookups";
import { resolveRawValueFromDisplay, resolveStoredFieldValue } from "@bgforge/binary";

describe("binaryEditor-lookups", () => {
    it("resolves MAP enum lookups by exact field name", () => {
        expect(resolveEnumLookup("map", "map.header.defaultElevation", "Default Elevation")).toEqual({
            0: "0",
            1: "1",
            2: "2",
        });
        expect(resolveEnumLookup("map", "map.header.defaultOrientation", "Default Orientation")).toEqual({
            0: "NE",
            1: "E",
            2: "SE",
            3: "SW",
            4: "W",
            5: "NW",
        });
    });

    it("resolves MAP dynamic enums for script action fields", () => {
        expect(resolveEnumLookup("map", "map.scripts[].extents[].slots[].action", "Entry 0 Action")).toMatchObject({
            0: "no_p_proc",
            6: "use_p_proc",
            8: "use_skill_on_p_proc",
        });
        expect(resolveEnumLookup("map", "map.scripts[].extents[].slots[].action", "Entry 0 Action")).not.toHaveProperty(
            "9",
        );
        expect(resolveEnumLookup("map", "map.scripts[].extents[].slots[].action", "Entry 0 Action")).not.toHaveProperty(
            "10",
        );
        expect(resolveEnumLookup("map", "map.scripts[].extents[].slots[].action", "Entry 0 Action")).not.toHaveProperty(
            "19",
        );
        expect(resolveEnumLookup("map", "map.scripts[].extents[].slots[].action", "Entry 0 Action")).not.toHaveProperty(
            "20",
        );

        expect(
            resolveEnumLookup("map", "map.scripts[].extents[].slots[].actionBeingUsed", "Entry 0 Action Being Used"),
        ).toMatchObject({
            0: "Small Guns",
            8: "Sneak",
            17: "Outdoorsman",
        });
    });

    it("resolves MAP flag lookups for dynamic script entries and object flags", () => {
        expect(resolveFlagLookup("map", "map.scripts[].extents[].slots[].flags", "Entry 0 Flags")).toEqual({
            0x01: "Loaded",
            0x02: "NoSpatial",
            0x04: "Executed",
            0x08: "NoSave",
            0x10: "NoRemove",
        });

        expect(resolveFlagLookup("map", "map.header.mapFlags", "Map Flags")).toEqual({
            0x1: "Savegame",
            0x2: "Has Elevation 0",
            0x4: "Has Elevation 1",
            0x8: "Has Elevation 2",
        });

        expect(resolveFlagLookup("map", "map.objects.elevations[].objects[].base.flags", "Flags")).toMatchObject({
            0x01: "Hidden",
            0x20_00_00_00: "LightThru",
            0x80_00_00_00: "ShootThru",
        });
    });

    it("keeps PRO Flags separate from MAP object Flags", () => {
        expect(resolveFlagLookup("pro", "pro.header.flags", "Flags")).toMatchObject({
            0x08: "Flat",
        });
        expect(resolveDisplayValue("pro", "pro.header.flags", "Flags", 0x08)).toContain("Flat");
        expect(resolveDisplayValue("map", "map.header.mapFlags", "Map Flags", 0)).toContain("Has Elevation 0");
        expect(
            resolveDisplayValue("map", "map.objects.elevations[].objects[].base.flags", "Flags", 0x20_00_00_00),
        ).toContain("LightThru");
    });

    it("formats enum display values with numeric suffixes only when helpful", () => {
        expect(formatEnumDisplayValue("NE", 0)).toBe("NE (0)");
        expect(formatEnumDisplayValue("0", 0)).toBe("0");
        expect(formatEnumDisplayValue("17", 17)).toBe("17");
    });

    it("uses formatted enum display values for resolved displays", () => {
        expect(resolveDisplayValue("map", "map.header.defaultOrientation", "Default Orientation", 0)).toBe("NE (0)");
        expect(resolveDisplayValue("map", "map.header.defaultElevation", "Default Elevation", 0)).toBe("0");
    });

    it("derives inverted MAP header flags entirely from presentation metadata", () => {
        expect(resolveDisplayValue("map", "map.header.mapFlags", "Map Flags", 0)).toBe(
            "Has Elevation 0, Has Elevation 1, Has Elevation 2",
        );
        expect(resolveStoredFieldValue("map", "map.header.mapFlags", "Map Flags", 0x1)).toBe(
            "Savegame, Has Elevation 0, Has Elevation 1, Has Elevation 2",
        );
        expect(resolveRawValueFromDisplay("map", "map.header.mapFlags", "Map Flags", "Savegame, Has Elevation 1")).toBe(
            0xb,
        );
        expect(
            resolveRawValueFromDisplay(
                "map",
                "map.header.mapFlags",
                "Map Flags",
                "Has Elevation 0, Has Elevation 1, Has Elevation 2",
            ),
        ).toBe(0);
    });
});
