import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { mapParser, type ParseResult } from "@bgforge/binary";
import { buildModel, setExpanded } from "../src/model";
import { getWindow, projectRow } from "../src/window";

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
        if (!gv) return;
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
        if (!gv) return;
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
        if (!lockedGroup) return;

        const unlockedGroup = m.nodes.find((n) => n.name === "UnlockedGroup");
        expect(unlockedGroup).toBeDefined();
        if (!unlockedGroup) return;

        // Expand both groups so their child fields appear in the window.
        setExpanded(m, lockedGroup.id, true);
        setExpanded(m, unlockedGroup.id, true);

        const rows = getWindow(m, 0, 1000);

        // Find the field inside the locked group.
        const lockedChildIds = new Set(m.nodes.filter((n) => n.parentId === lockedGroup.id).map((n) => n.id));
        const lockedFieldRow = rows.find((r) => lockedChildIds.has(r.id) && r.kind === "field");
        expect(lockedFieldRow).toBeDefined();
        if (!lockedFieldRow) return;
        expect(lockedFieldRow.editable).toBe(false);

        // Find the field inside the unlocked sibling group - must be editable.
        const unlockedChildIds = new Set(m.nodes.filter((n) => n.parentId === unlockedGroup.id).map((n) => n.id));
        const unlockedFieldRow = rows.find((r) => unlockedChildIds.has(r.id) && r.kind === "field");
        expect(unlockedFieldRow).toBeDefined();
        if (!unlockedFieldRow) return;
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
});
