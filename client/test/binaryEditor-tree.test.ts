import { describe, expect, it } from "vitest";
import * as fs from "fs";
import * as path from "path";
import { type ParseResult, mapParser, proParser } from "@bgforge/binary";
import { buildBinaryEditorTreeState } from "../src/editors/binaryEditor-tree";

function makeProResult(): ParseResult {
    return {
        format: "pro",
        formatName: "Fallout PRO (Prototype)",
        root: {
            name: "PRO File",
            fields: [
                {
                    name: "Header",
                    expanded: true,
                    fields: [
                        { name: "Object Type", value: "Misc", offset: 0, size: 1, type: "enum", rawValue: 5 },
                        { name: "Text ID", value: 100, offset: 4, size: 4, type: "uint32" },
                    ],
                },
            ],
        },
    };
}

function loadMapResult(mapName: string, gracefulMapBoundaries = false, skipMapTiles = false): ParseResult {
    const fixtureMapPath = path.resolve("client/testFixture/maps", mapName);
    const mapPath = fs.existsSync(fixtureMapPath)
        ? fixtureMapPath
        : path.resolve("external/fallout/Fallout2_Restoration_Project/data/maps", mapName);
    return mapParser.parse(new Uint8Array(fs.readFileSync(mapPath)), { gracefulMapBoundaries, skipMapTiles });
}

function loadProResult(subDir: string, fileName: string): ParseResult {
    const proPath = path.resolve("client/testFixture/proto", subDir, fileName);
    return proParser.parse(new Uint8Array(fs.readFileSync(proPath)));
}

describe("buildBinaryEditorTreeState", () => {
    it("builds root and lazy children for non-MAP parse results", () => {
        const tree = buildBinaryEditorTreeState(makeProResult());
        const init = tree.getInitMessagePayload();

        expect(init.rootChildren).toHaveLength(1);
        expect(init.rootChildren[0]).toMatchObject({
            name: "Header",
            kind: "group",
            expandable: true,
        });

        const headerChildren = tree.getChildren(init.rootChildren[0].id);
        expect(headerChildren.map((node) => node.name)).toEqual(["Object Type", "Text ID"]);
        expect(headerChildren[0]).toMatchObject({
            kind: "field",
            fieldPath: "Header.Object Type",
            editable: true,
            enumOptions: { 0: "Item", 1: "Critter", 2: "Scenery", 3: "Wall", 4: "Tile", 5: "Misc" },
        });
    });

    it("marks Global Variables as addable and its entries as removable", () => {
        const tree = buildBinaryEditorTreeState(loadMapResult("arcaves.map"));
        const init = tree.getInitMessagePayload();

        const globalsNode = init.rootChildren.find((node) => node.name === "Global Variables");
        expect(globalsNode).toBeDefined();
        expect(globalsNode!.addable).toBe(true);

        const entries = tree.getChildren(globalsNode!.id);
        expect(entries.length).toBeGreaterThan(0);
        for (const entry of entries) {
            expect(entry.removable).toBe(true);
        }
    });

    it("does not mark non-addable groups as addable", () => {
        const tree = buildBinaryEditorTreeState(loadMapResult("arcaves.map"));
        const init = tree.getInitMessagePayload();

        const headerNode = init.rootChildren.find((node) => node.name === "Header");
        expect(headerNode).toBeDefined();
        expect(headerNode!.addable).toBeFalsy();

        const headerChildren = tree.getChildren(headerNode!.id);
        for (const child of headerChildren) {
            expect(child.removable).toBeFalsy();
        }
    });

    it("carries arrayPath on addable groups and entryPath on removable entries", () => {
        const tree = buildBinaryEditorTreeState(loadMapResult("arcaves.map"));
        const init = tree.getInitMessagePayload();

        const globalsNode = init.rootChildren.find((node) => node.name === "Global Variables")!;
        expect(globalsNode.arrayPath).toEqual(["Global Variables"]);

        const entries = tree.getChildren(globalsNode.id);
        expect(entries.length).toBeGreaterThan(0);
        expect(entries[0].entryPath).toEqual(["Global Variables", "Global Var 0"]);
        expect(entries[1].entryPath).toEqual(["Global Variables", "Global Var 1"]);
    });

    it("uses compact MAP summaries as lazy root nodes", () => {
        const fullResult = loadMapResult("artemple.map", true);
        const tree = buildBinaryEditorTreeState(fullResult);
        const init = tree.getInitMessagePayload();

        expect(init.rootChildren.map((node) => node.name)).toEqual([
            "Header",
            "Tiles",
            "Timer Scripts",
            "Item Scripts",
            "Objects Section",
        ]);

        const tilesNode = init.rootChildren.find((node) => node.name === "Tiles");
        expect(tilesNode).toBeDefined();
        const tilesChildren = tree.getChildren(tilesNode!.id);
        expect(tilesChildren).toEqual([]);

        const objectsNode = init.rootChildren.find((node) => node.name === "Objects Section");
        expect(objectsNode).toBeDefined();
        const objectSectionChildren = tree.getChildren(objectsNode!.id);
        expect(objectSectionChildren.map((node) => node.name).slice(0, 2)).toEqual([
            "Total Objects",
            "Elevation 0 Objects",
        ]);
    });

    it(
        "keeps MAP init payload tiny for large real maps",
        // Parses navarro.map end-to-end — v8 coverage instrumentation pushes
        // this past the 5s default; raise the ceiling so the size assertion
        // still runs under --coverage.
        { timeout: 15_000 },
        () => {
            const tree = buildBinaryEditorTreeState(loadMapResult("navarro.map", true));
            const initBytes = Buffer.byteLength(JSON.stringify(tree.getInitMessagePayload()));

            expect(initBytes).toBeLessThan(10_000);
        },
    );

    it("omits the synthetic Tiles root when the editor parse skips MAP tiles entirely", () => {
        const tree = buildBinaryEditorTreeState(loadMapResult("artemple.map", true, true));
        const init = tree.getInitMessagePayload();

        expect(init.rootChildren.some((node) => node.name === "Tiles")).toBe(false);
    });

    it("shows only parse errors for strict MAP failures", () => {
        const tree = buildBinaryEditorTreeState(loadMapResult("sfsheng.map"));
        const init = tree.getInitMessagePayload();

        expect(init.errors?.some((error) => error.includes("overflow"))).toBe(true);
        expect(init.rootChildren).toEqual([]);
    });

    it("attaches MAP enum and flag options to lazy field nodes", () => {
        const tree = buildBinaryEditorTreeState(loadMapResult("arcaves.map"));
        const init = tree.getInitMessagePayload();

        const headerNode = init.rootChildren.find((node) => node.name === "Header");
        expect(headerNode).toBeDefined();
        const headerChildren = tree.getChildren(headerNode!.id);
        expect(headerChildren.find((node) => node.name === "Default Elevation")).toMatchObject({
            valueType: "enum",
            enumOptions: { 0: "0", 1: "1", 2: "2" },
        });

        const timerScripts = init.rootChildren.find((node) => node.name === "Timer Scripts");
        expect(timerScripts).toBeDefined();
        const timerExtents = tree.getChildren(timerScripts!.id);
        const extent0 = timerExtents.find((node) => node.name === "Extent 0");
        expect(extent0).toBeDefined();
        const slots = tree.getChildren(extent0!.id);
        const slot0 = slots.find((node) => node.name === "Slot 0");
        expect(slot0).toBeDefined();
        const slotChildren = tree.getChildren(slot0!.id);
        expect(slotChildren.find((node) => node.name === "Entry 0 Flags")).toMatchObject({
            valueType: "flags",
            flagOptions: { 1: "Loaded", 2: "NoSpatial", 4: "Executed", 8: "NoSave", 16: "NoRemove" },
        });
    });

    it("hides low-signal MAP placeholder fields from the editor tree while keeping meaningful script state visible", () => {
        const tree = buildBinaryEditorTreeState(loadMapResult("arcaves.map"));
        const init = tree.getInitMessagePayload();

        const headerNode = init.rootChildren.find((node) => node.name === "Header");
        expect(headerNode).toBeDefined();
        const headerChildren = tree.getChildren(headerNode!.id);
        expect(headerChildren.find((node) => node.name === "Padding (field_3C)")).toBeUndefined();

        const timerScripts = init.rootChildren.find((node) => node.name === "Timer Scripts");
        expect(timerScripts).toBeDefined();
        const extent0 = tree.getChildren(timerScripts!.id).find((node) => node.name === "Extent 0");
        expect(extent0).toBeDefined();
        const slot0 = tree.getChildren(extent0!.id).find((node) => node.name === "Slot 0");
        expect(slot0).toBeDefined();
        const slotChildren = tree.getChildren(slot0!.id);
        expect(slotChildren.find((node) => node.name === "Entry 0 Next Script Link (legacy)")).toBeUndefined();
        expect(slotChildren.find((node) => node.name === "Entry 0 Unknown Field 0x48")).toBeUndefined();
        expect(slotChildren.find((node) => node.name === "Entry 0 Legacy Field 0x50")).toBeUndefined();
        expect(slotChildren.find((node) => node.name === "Entry 0 Program Pointer Slot")).toMatchObject({
            editable: false,
        });
        expect(slotChildren.find((node) => node.name === "Entry 0 Check Margin (how_much)")).toBeDefined();

        const objectsNode = init.rootChildren.find((node) => node.name === "Objects Section");
        expect(objectsNode).toBeDefined();
        const elevation0 = tree.getChildren(objectsNode!.id).find((node) => node.name === "Elevation 0 Objects");
        expect(elevation0).toBeDefined();
        const firstObject = tree.getChildren(elevation0!.id).find((node) => node.name === "Object 0.0 (Misc)");
        expect(firstObject).toBeDefined();
        const firstObjectChildren = tree.getChildren(firstObject!.id);
        expect(firstObjectChildren.find((node) => node.name === "Field 74")).toBeUndefined();
    });

    it("hides generic PRO unknown fields and empty groups from the editor tree", () => {
        const tree = buildBinaryEditorTreeState(loadProResult("misc", "00000001.pro"));
        const init = tree.getInitMessagePayload();

        expect(init.rootChildren.find((node) => node.name === "Misc Properties")).toBeUndefined();

        const sceneryTree = buildBinaryEditorTreeState(loadProResult("scenery", "00000008.pro"));
        const sceneryInit = sceneryTree.getInitMessagePayload();
        const doorProperties = sceneryInit.rootChildren.find((node) => node.name === "Door Properties");
        expect(doorProperties).toBeDefined();

        const doorChildren = sceneryTree.getChildren(doorProperties!.id);
        expect(doorChildren.find((node) => node.name === "Walk Through")).toBeDefined();
        expect(doorChildren.find((node) => node.name === "Unknown")).toBeUndefined();
    });

    it("disables MAP edits for structural and opaque fields", () => {
        const tree = buildBinaryEditorTreeState(loadMapResult("arcaves.map"));
        const init = tree.getInitMessagePayload();

        const headerNode = init.rootChildren.find((node) => node.name === "Header");
        expect(headerNode).toBeDefined();
        const headerChildren = tree.getChildren(headerNode!.id);
        expect(headerChildren.find((node) => node.name === "Num Local Vars")?.editable).toBe(false);
        expect(headerChildren.find((node) => node.name === "Map Flags")?.editable).toBe(false);
        expect(headerChildren.find((node) => node.name === "Map Flags")?.value).toContain("Has Elevation 0");
        expect(headerChildren.find((node) => node.name === "Default Elevation")?.editable).toBe(true);

        const timerScripts = init.rootChildren.find((node) => node.name === "Timer Scripts");
        expect(timerScripts).toBeDefined();
        const timerExtents = tree.getChildren(timerScripts!.id);
        const extent0 = timerExtents.find((node) => node.name === "Extent 0");
        expect(extent0).toBeDefined();
        const extentChildren = tree.getChildren(extent0!.id);
        expect(extentChildren.find((node) => node.name === "Extent Length")?.editable).toBe(false);

        const slot0 = tree.getChildren(extent0!.id).find((node) => node.name === "Slot 0");
        expect(slot0).toBeDefined();
        const slotChildren = tree.getChildren(slot0!.id);
        expect(slotChildren.find((node) => node.name === "Entry 0 Flags")?.editable).toBe(true);
        expect(slotChildren.find((node) => node.name === "Entry 0 Index")?.editable).toBe(true);
        expect(slotChildren.find((node) => node.name === "Entry 0 Local Vars Offset")?.editable).toBe(false);
        expect(slotChildren.find((node) => node.name === "Entry 0 Program Pointer Slot")?.editable).toBe(false);
        expect(slotChildren.find((node) => node.name === "Entry 0 Check Margin (how_much)")?.editable).toBe(true);

        const objectsNode = init.rootChildren.find((node) => node.name === "Objects Section");
        expect(objectsNode).toBeDefined();
        const objectSectionChildren = tree.getChildren(objectsNode!.id);
        expect(objectSectionChildren.find((node) => node.name === "Total Objects")?.editable).toBe(false);

        const elevation0 = objectSectionChildren.find((node) => node.name === "Elevation 0 Objects");
        expect(elevation0).toBeDefined();
        const elevation0Children = tree.getChildren(elevation0!.id);
        expect(elevation0Children.find((node) => node.name === "Object Count")?.editable).toBe(false);

        const firstObject = elevation0Children.find((node) => node.name === "Object 0.0 (Misc)");
        expect(firstObject).toBeDefined();
        const firstObjectChildren = tree.getChildren(firstObject!.id);
        expect(firstObjectChildren.find((node) => node.name === "ID")?.editable).toBe(true);
        expect(firstObjectChildren.find((node) => node.name === "Rotation")?.editable).toBe(true);
        expect(firstObjectChildren.find((node) => node.name === "Screen X")?.editable).toBe(true);
        expect(firstObjectChildren.find((node) => node.name === "Screen Y")?.editable).toBe(true);
        expect(firstObjectChildren.find((node) => node.name === "PID")).toMatchObject({
            editable: true,
            value: "0x500000C",
            numericFormat: "hex32",
        });
        expect(firstObjectChildren.find((node) => node.name === "FID")).toMatchObject({
            numericFormat: "hex32",
        });
        expect(firstObjectChildren.find((node) => node.name === "CID")).toMatchObject({
            editable: true,
            numericFormat: "hex32",
        });
        expect(firstObjectChildren.find((node) => node.name === "Inventory Header")?.editable).toBeUndefined();

        const inventoryHeader = firstObjectChildren.find((node) => node.name === "Inventory Header");
        expect(inventoryHeader).toBeDefined();
        const inventoryFields = tree.getChildren(inventoryHeader!.id);
        expect(inventoryFields.find((node) => node.name === "Inventory Length")?.editable).toBe(false);

        const objectData = firstObjectChildren.find((node) => node.name === "Object Data");
        expect(objectData).toBeDefined();
        const objectDataFields = tree.getChildren(objectData!.id);
        expect(objectDataFields.find((node) => node.name === "Data Flags")?.editable).toBe(true);
    });
});
