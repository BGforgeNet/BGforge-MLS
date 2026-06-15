import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { mapParser, type ParseResult } from "@bgforge/binary";
import { buildModel, setExpanded } from "../src/model";
import { getChildren, getWindow, projectRow } from "../src/window";

const MAP_FIXTURE = path.resolve(__dirname, "../../client/testFixture/maps/arcaves.map");
function model() {
    return buildModel(mapParser.parse(new Uint8Array(fs.readFileSync(MAP_FIXTURE))));
}

/**
 * Minimal synthetic ParseResult with:
 * - a locked child group (editingLocked: true) containing one uint8 field
 * - an unlocked sibling group containing one uint8 field
 * Used to test parentLocked threading and the editable predicate without
 * depending on the real fixture having a locked group.
 */
function syntheticLockedResult(): ParseResult {
    return {
        format: "test",
        formatName: "Test Format",
        root: {
            name: "Root",
            fields: [
                {
                    name: "LockedGroup",
                    editingLocked: true,
                    fields: [
                        {
                            name: "LockedField",
                            value: 42,
                            offset: 0,
                            size: 1,
                            type: "uint8",
                        },
                    ],
                },
                {
                    name: "UnlockedGroup",
                    fields: [
                        {
                            name: "UnlockedField",
                            value: 7,
                            offset: 1,
                            size: 1,
                            type: "uint8",
                        },
                    ],
                },
            ],
        },
    };
}

describe("getWindow", () => {
    it("returns a [start,end) slice of the visible rows", () => {
        const m = model();
        const all = getWindow(m, 0, 1000);
        const firstTwo = getWindow(m, 0, 2);
        expect(firstTwo).toEqual(all.slice(0, 2));
    });

    it("projects a group row with hasChildren and expanded flags", () => {
        const m = model();
        const gv = m.nodes.find((n) => n.name === "Global Variables"); // guard, no `!`
        expect(gv).toBeDefined();
        if (!gv) throw new Error("Global Variables group not found in model");
        setExpanded(m, gv.id, true);
        const rows = getWindow(m, 0, 1000);
        const row = rows.find((r) => r.id === gv.id);
        expect(row).toBeDefined();
        expect(row?.kind).toBe("group");
        expect(row?.hasChildren).toBe(true);
        expect(row?.expanded).toBe(true);
    });

    it("projects a field row with a display value", () => {
        const m = model();
        const gv = m.nodes.find((n) => n.name === "Global Variables");
        expect(gv).toBeDefined();
        if (!gv) throw new Error("Global Variables group not found in model");
        setExpanded(m, gv.id, true);
        const rows = getWindow(m, 0, 1000);
        const childIds = new Set(m.nodes.filter((n) => n.parentId === gv.id).map((n) => n.id));
        const field = rows.find((r) => childIds.has(r.id) && r.kind === "field");
        expect(field).toBeDefined();
        expect(typeof field?.displayValue).toBe("string");
    });

    it("marks fields inside an editingLocked ancestor group as not editable", () => {
        const m = buildModel(syntheticLockedResult());

        const lockedGroup = m.nodes.find((n) => n.name === "LockedGroup");
        expect(lockedGroup).toBeDefined();
        if (!lockedGroup) throw new Error("LockedGroup not found in synthetic model");

        const unlockedGroup = m.nodes.find((n) => n.name === "UnlockedGroup");
        expect(unlockedGroup).toBeDefined();
        if (!unlockedGroup) throw new Error("UnlockedGroup not found in synthetic model");

        // Expand both groups so their child fields appear in the window.
        setExpanded(m, lockedGroup.id, true);
        setExpanded(m, unlockedGroup.id, true);

        const rows = getWindow(m, 0, 1000);

        // Find the field inside the locked group.
        const lockedChildIds = new Set(m.nodes.filter((n) => n.parentId === lockedGroup.id).map((n) => n.id));
        const lockedFieldRow = rows.find((r) => lockedChildIds.has(r.id) && r.kind === "field");
        expect(lockedFieldRow).toBeDefined();
        if (!lockedFieldRow) throw new Error("no field row found inside LockedGroup");
        expect(lockedFieldRow.editable).toBe(false);

        // Find the field inside the unlocked sibling group - must be editable.
        const unlockedChildIds = new Set(m.nodes.filter((n) => n.parentId === unlockedGroup.id).map((n) => n.id));
        const unlockedFieldRow = rows.find((r) => unlockedChildIds.has(r.id) && r.kind === "field");
        expect(unlockedFieldRow).toBeDefined();
        if (!unlockedFieldRow) throw new Error("no field row found inside UnlockedGroup");
        expect(unlockedFieldRow.editable).toBe(true);
    });
});

function enumFlagResult(): ParseResult {
    return {
        format: "test",
        formatName: "Test Format",
        root: {
            name: "Root",
            fields: [
                {
                    name: "Stats",
                    fields: [
                        {
                            name: "Race",
                            value: 1,
                            offset: 0,
                            size: 1,
                            type: "enum",
                            enumOptions: { "0": "Human", "1": "Mutant" },
                            description: "Critter race",
                        },
                        {
                            name: "Flags",
                            value: 3,
                            offset: 1,
                            size: 1,
                            type: "flags",
                            flagOptions: { "0": "Visible", "1": "Dead" },
                        },
                        {
                            // Open enum (the spec's `enumOpen` flowed through walk-display): the dropdown
                            // accepts a custom numeric value, so projection must carry the flag to the Row.
                            name: "Class",
                            value: 2,
                            offset: 2,
                            size: 1,
                            type: "enum",
                            enumOptions: { "0": "None", "1": "Mage", "2": "Fighter" },
                            enumOpen: true,
                        },
                    ],
                },
            ],
        },
    };
}

describe("projectRow metadata", () => {
    it("carries enumOptions, flagOptions, and description from the field", () => {
        const m = buildModel(enumFlagResult());
        const stats = m.nodes.find((n) => n.name === "Stats")!;
        const race = m.nodes.find((n) => n.name === "Race")!;
        const flags = m.nodes.find((n) => n.name === "Flags")!;
        expect(projectRow(m, race).enumOptions).toEqual({ "0": "Human", "1": "Mutant" });
        expect(projectRow(m, race).description).toBe("Critter race");
        expect(projectRow(m, flags).flagOptions).toEqual({ "0": "Visible", "1": "Dead" });
        // groups carry none of these
        expect(projectRow(m, stats).enumOptions).toBeUndefined();
    });

    it("carries enumOpen for an open enum and leaves it unset for a closed one", () => {
        const m = buildModel(enumFlagResult());
        const race = m.nodes.find((n) => n.name === "Race")!; // closed enum (no enumOpen)
        const klass = m.nodes.find((n) => n.name === "Class")!; // open enum
        expect(projectRow(m, klass).enumOpen).toBe(true);
        expect(projectRow(m, race).enumOpen).toBeUndefined();
    });

    it("falls back to field.value for rawValue when the parser left it unset", () => {
        // Plain numeric fields carry `value` but no `rawValue` (the parser only sets rawValue when it
        // differs from value, e.g. enums/flags). Projection must fall back to value so numeric controls
        // are not rendered blank. enumFlagResult sets no rawValue on its fields.
        const m = buildModel(enumFlagResult());
        const race = m.nodes.find((n) => n.name === "Race")!;
        expect(projectRow(m, race).rawValue).toBe(1);
    });
});

describe("MAP subtype-trailer fields project as typed controls", () => {
    // denbus1 is the vanilla fixture that surfaces both a door (Open Flags) and a weapon (Ammo Type PID)
    // in fully-resolved subtype trailers, so it exercises the typed-trailer projection end to end.
    const DENBUS1 = path.resolve(__dirname, "../../client/testFixture/maps/denbus1.map");

    function denbus1Rows() {
        const m = buildModel(mapParser.parse(new Uint8Array(fs.readFileSync(DENBUS1))));
        // Expand every group so the deeply-nested object trailer rows become visible through the
        // real getWindow path - not projected in isolation via projectRow.
        for (const n of m.nodes) {
            if (n.childCount > 0) setExpanded(m, n.id, true);
        }
        return getWindow(m, 0, 1_000_000);
    }

    it("Door 'Open Flags' projects as a flags control carrying the door bit table", () => {
        const row = denbus1Rows().find((r) => r.name === "Open Flags");
        expect(row).toBeDefined();
        expect(row?.valueType).toBe("flags");
        expect(row?.flagOptions).toEqual({ "1": "Open", "33554432": "Locked", "67108864": "Jammed" });
    });

    it("'Ammo Type PID' projects as a hex-formatted numeric control", () => {
        const row = denbus1Rows().find((r) => r.name === "Ammo Type PID");
        expect(row).toBeDefined();
        expect(row?.valueType).toBe("int32");
        expect(row?.numericFormat).toBe("hex32");
        // displayValue is the 0x-prefixed string; rawValue stays the stored number for editing.
        expect(row?.displayValue).toMatch(/^0x[0-9a-f]{8}$/);
        expect(typeof row?.rawValue).toBe("number");
    });
});

describe("getChildren", () => {
    it("returns depth-0 roots when parentId is null, with total", () => {
        const m = model(); // MAP fixture helper already defined at the top of this file
        const roots = m.nodes.filter((n) => n.parentId === undefined);
        const r = getChildren(m, null, 0, 1000);
        expect(r.total).toBe(roots.length);
        expect(r.rows.map((row) => row.id)).toEqual(roots.map((n) => n.id));
        expect(r.rows.every((row) => row.depth === 0)).toBe(true);
    });

    it("returns a [start,end) slice of a group's direct children", () => {
        const m = buildModel(enumFlagResult()); // enumFlagResult() was added by Task 1
        const stats = m.nodes.find((n) => n.name === "Stats")!;
        const all = getChildren(m, stats.id, 0, 100);
        expect(all.total).toBe(3);
        expect(all.rows.map((row) => row.name)).toEqual(["Race", "Flags", "Class"]);
        const sliced = getChildren(m, stats.id, 1, 2);
        expect(sliced.rows.map((row) => row.name)).toEqual(["Flags"]);
        expect(sliced.total).toBe(3);
    });
});
