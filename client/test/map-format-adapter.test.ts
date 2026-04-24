/**
 * Unit tests for map-format-adapter.ts.
 * Tests mapSemanticFieldKey branches not covered by existing parser tests:
 * script slot fields, object section object fields, shouldHideMapField, shouldHideMapGroup.
 */

import { describe, expect, it } from "vitest";
import { formatAdapterRegistry } from "../src/parsers/format-adapter";

const adapter = formatAdapterRegistry.get("map")!;

describe("map adapter toSemanticFieldKey", () => {
    it("returns undefined for empty segment list", () => {
        expect(adapter.toSemanticFieldKey([])).toBeUndefined();
    });

    it("maps Header segments", () => {
        expect(adapter.toSemanticFieldKey(["Header", "Version"])).toBe("map.header.version");
        expect(adapter.toSemanticFieldKey(["Header", "Default Elevation"])).toBe("map.header.defaultElevation");
    });

    it("maps Global Variables", () => {
        expect(adapter.toSemanticFieldKey(["Global Variables"])).toBe("map.globalVariables[]");
        expect(adapter.toSemanticFieldKey(["Global Variables", "Var 0"])).toBe("map.globalVariables[]");
    });

    it("maps Local Variables", () => {
        expect(adapter.toSemanticFieldKey(["Local Variables"])).toBe("map.localVariables[]");
    });

    it("maps tile elevation fields (Floor/Roof/Flags)", () => {
        expect(adapter.toSemanticFieldKey(["Elevation 0 Tiles", "Tile 0 Floor"])).toBe("map.tiles[].floorTileId");
        expect(adapter.toSemanticFieldKey(["Elevation 0 Tiles", "Tile 0 Floor Flags"])).toBe("map.tiles[].floorFlags");
        expect(adapter.toSemanticFieldKey(["Elevation 0 Tiles", "Tile 0 Roof"])).toBe("map.tiles[].roofTileId");
        expect(adapter.toSemanticFieldKey(["Elevation 0 Tiles", "Tile 0 Roof Flags"])).toBe("map.tiles[].roofFlags");
    });

    it("returns undefined for unrecognized tile sub-field", () => {
        expect(adapter.toSemanticFieldKey(["Elevation 0 Tiles", "Something Else"])).toBeUndefined();
    });

    it("maps Script Count", () => {
        expect(adapter.toSemanticFieldKey(["Spatial Scripts", "Script Count"])).toBe("map.scripts[].count");
    });

    it("maps script extent fields", () => {
        expect(adapter.toSemanticFieldKey(["Spatial Scripts", "Extent 0", "Extent Length"])).toBe(
            "map.scripts[].extents[].extentLength",
        );
        expect(adapter.toSemanticFieldKey(["Spatial Scripts", "Extent 0", "Extent Next"])).toBe(
            "map.scripts[].extents[].extentNext",
        );
    });

    it("maps script slot fields via Entry N prefix stripping", () => {
        // Line 55-56: /^Slot \d+$/ + Entry N prefix stripping
        expect(adapter.toSemanticFieldKey(["Spatial Scripts", "Extent 0", "Slot 0", "Entry 0 Sid"])).toBe(
            "map.scripts[].extents[].slots[].sid",
        );
        expect(adapter.toSemanticFieldKey(["Spatial Scripts", "Extent 0", "Slot 0", "Entry 0 Action"])).toBe(
            "map.scripts[].extents[].slots[].action",
        );
    });

    it("returns undefined for Scripts segment that doesn't match known sub-paths", () => {
        // Line 59: return undefined for scripts with unrecognized second segment
        expect(adapter.toSemanticFieldKey(["Spatial Scripts", "Unrecognized"])).toBeUndefined();
    });

    it("maps Objects Section - Total Objects", () => {
        expect(adapter.toSemanticFieldKey(["Objects Section", "Total Objects"])).toBe("map.objects.totalObjects");
    });

    it("maps Objects Section - elevation object count", () => {
        expect(adapter.toSemanticFieldKey(["Objects Section", "Elevation 0 Objects", "Object Count"])).toBe(
            "map.objects.elevations[].objectCount",
        );
    });

    it("maps Objects Section - object reference without fourth segment", () => {
        // Line 71-72: !fourth branch
        expect(adapter.toSemanticFieldKey(["Objects Section", "Elevation 0 Objects", "Object 0.0 (Item)"])).toBe(
            "map.objects.elevations[].objects[]",
        );
    });

    it("maps Objects Section - object base field (fourth segment is plain field name)", () => {
        // Line 92: base field fallback
        expect(adapter.toSemanticFieldKey(["Objects Section", "Elevation 0 Objects", "Object 0.0 (Item)", "PID"])).toBe(
            "map.objects.elevations[].objects[].base.pid",
        );
    });

    it("maps Objects Section - Inventory Header", () => {
        // Line 74-76
        expect(
            adapter.toSemanticFieldKey([
                "Objects Section",
                "Elevation 0 Objects",
                "Object 0.0 (Item)",
                "Inventory Header",
                "Quantity",
            ]),
        ).toBe("map.objects.elevations[].objects[].inventoryHeader.quantity");
    });

    it("maps Objects Section - Object Data", () => {
        // Line 77-79
        expect(
            adapter.toSemanticFieldKey([
                "Objects Section",
                "Elevation 0 Objects",
                "Object 0.0 (Item)",
                "Object Data",
                "Sub PID",
            ]),
        ).toBe("map.objects.elevations[].objects[].objectData.subPid");
    });

    it("maps Objects Section - Exit Grid", () => {
        // Line 80-82
        expect(
            adapter.toSemanticFieldKey([
                "Objects Section",
                "Elevation 0 Objects",
                "Object 0.0 (Item)",
                "Exit Grid",
                "Dest Tile",
            ]),
        ).toBe("map.objects.elevations[].objects[].exitGrid.destTile");
    });

    it("maps Objects Section - Critter Data", () => {
        // Line 83-85
        expect(
            adapter.toSemanticFieldKey([
                "Objects Section",
                "Elevation 0 Objects",
                "Object 0.0 (Critter)",
                "Critter Data",
                "Team Number",
            ]),
        ).toBe("map.objects.elevations[].objects[].critterData.teamNumber");
    });

    it("maps Objects Section - Inventory Entry Quantity", () => {
        // Line 87-89
        expect(
            adapter.toSemanticFieldKey([
                "Objects Section",
                "Elevation 0 Objects",
                "Object 0.0 (Item)",
                "Inventory Entry 0",
                "Quantity",
            ]),
        ).toBe("map.objects.elevations[].objects[].inventory[].quantity");
    });

    it("maps Objects Section - Inventory Entry other field", () => {
        // Line 90-91
        expect(
            adapter.toSemanticFieldKey([
                "Objects Section",
                "Elevation 0 Objects",
                "Object 0.0 (Item)",
                "Inventory Entry 0",
                "PID",
            ]),
        ).toBe("map.objects.elevations[].objects[].inventory[].pid");
    });

    it("falls back to generic dotted path for unrecognized top-level segment", () => {
        // Line 97: generic fallback
        const key = adapter.toSemanticFieldKey(["Unknown Section", "Some Field"]);
        expect(typeof key).toBe("string");
        expect(key).toContain("map.");
    });
});

describe("map adapter shouldHideField", () => {
    it("hides Padding (field_3C)", () => {
        const field = { name: "Padding (field_3C)", value: 0, offset: 0, size: 4, type: "int32" as const };
        expect(adapter.shouldHideField?.(field)).toBe(true);
    });

    it("hides Field 74", () => {
        const field = { name: "Field 74", value: 0, offset: 0, size: 4, type: "int32" as const };
        expect(adapter.shouldHideField?.(field)).toBe(true);
    });

    it("hides Entry N Next Script Link (legacy)", () => {
        const field = {
            name: "Entry 0 Next Script Link (legacy)",
            value: 0,
            offset: 0,
            size: 4,
            type: "int32" as const,
        };
        expect(adapter.shouldHideField?.(field)).toBe(true);
    });

    it("does not hide normal fields", () => {
        const field = { name: "Version", value: 20, offset: 0, size: 4, type: "uint32" as const };
        expect(adapter.shouldHideField?.(field)).toBe(false);
    });
});

describe("map adapter shouldHideGroup", () => {
    it("hides a scripts group when it only has a Script Count field with value 0", () => {
        const group = {
            name: "Spatial Scripts",
            fields: [{ name: "Script Count", value: 0, offset: 0, size: 4, type: "int32" as const }],
        };
        expect(adapter.shouldHideGroup?.(group)).toBe(true);
    });

    it("does not hide a scripts group when Script Count is > 0", () => {
        const group = {
            name: "Spatial Scripts",
            fields: [{ name: "Script Count", value: 3, offset: 0, size: 4, type: "int32" as const }],
        };
        expect(adapter.shouldHideGroup?.(group)).toBe(false);
    });

    it("does not hide non-scripts groups", () => {
        const group = {
            name: "Header",
            fields: [{ name: "Version", value: 20, offset: 0, size: 4, type: "uint32" as const }],
        };
        expect(adapter.shouldHideGroup?.(group)).toBe(false);
    });

    it("does not hide scripts group with multiple fields", () => {
        const group = {
            name: "Spatial Scripts",
            fields: [
                { name: "Script Count", value: 0, offset: 0, size: 4, type: "int32" as const },
                { name: "Extra", value: 0, offset: 4, size: 4, type: "int32" as const },
            ],
        };
        expect(adapter.shouldHideGroup?.(group)).toBe(false);
    });
});
