import { describe, expect, it } from "vitest";
import type { ParseResult } from "../src/parsers/types";
import { createBinaryJsonSnapshot, loadBinaryJsonSnapshot, parseBinaryJsonSnapshot } from "../src/parsers/json-snapshot";

function makeSnapshotResult(): ParseResult {
    return {
        format: "testbin",
        formatName: "Test Binary",
        root: {
            name: "MAP File",
            fields: [
                {
                    name: "Header",
                    expanded: true,
                    fields: [
                        { name: "Version", value: 20, offset: 0, size: 4, type: "uint32" },
                    ],
                },
            ],
        },
        opaqueRanges: [
            {
                label: "objects-tail",
                offset: 64,
                size: 8,
                hexChunks: ["00112233", "44556677"],
            },
        ],
    };
}

describe("json-snapshot", () => {
    it("serializes generic parse results as schema version 1 with a trailing newline", () => {
        const json = createBinaryJsonSnapshot(makeSnapshotResult());
        expect(json.endsWith("\n")).toBe(true);
        expect(json).toContain("\"opaqueRanges\"");
        const parsed = JSON.parse(json) as {
            schemaVersion: number;
            root: { nodeType: string; children: Array<{ nodeType: string; key: string; children?: Array<{ key: string; value: unknown }> }> };
        };
        expect(parsed.schemaVersion).toBe(1);
        expect(parsed.root.nodeType).toBe("group");
        expect(parsed.root.children[0]?.key).toBe("header");
        expect(parsed.root.children[0]?.children?.[0]).toMatchObject({
            nodeType: "field",
            key: "version",
            value: 20,
        });
    });

    it("parses serialized version 1 snapshots back into parse results", () => {
        const original = makeSnapshotResult();
        const parsed = parseBinaryJsonSnapshot(createBinaryJsonSnapshot(original));
        expect(parsed).toEqual(original);
    });

    it("stores PRO snapshots as canonical document data instead of display-tree nodes", () => {
        const original: ParseResult = {
            format: "pro",
            formatName: "Fallout PRO (Prototype)",
            root: {
                name: "PRO File",
                fields: [
                    {
                        name: "Header",
                        fields: [
                            {
                                name: "Object Type",
                                value: "Misc",
                                rawValue: 5,
                                offset: 0,
                                size: 1,
                                type: "enum",
                            },
                            {
                                name: "Object ID",
                                value: 8,
                                offset: 1,
                                size: 3,
                                type: "uint24",
                            },
                            {
                                name: "Text ID",
                                value: 100,
                                offset: 4,
                                size: 4,
                                type: "uint32",
                            },
                            {
                                name: "FRM Type",
                                value: "Background",
                                rawValue: 5,
                                offset: 8,
                                size: 1,
                                type: "enum",
                            },
                            {
                                name: "FRM ID",
                                value: 9,
                                offset: 9,
                                size: 3,
                                type: "uint24",
                            },
                            {
                                name: "Light Radius",
                                value: 0,
                                offset: 12,
                                size: 4,
                                type: "uint32",
                            },
                            {
                                name: "Light Intensity",
                                value: 0,
                                offset: 16,
                                size: 4,
                                type: "uint32",
                            },
                            {
                                name: "Flags",
                                value: "(none)",
                                rawValue: 0,
                                offset: 20,
                                size: 4,
                                type: "flags",
                            },
                        ],
                    },
                    {
                        name: "Misc Properties",
                        fields: [
                            {
                                name: "Unknown",
                                value: 0,
                                offset: 24,
                                size: 4,
                                type: "uint32",
                            },
                        ],
                    },
                ],
            },
        };

        const snapshot = JSON.parse(createBinaryJsonSnapshot(original)) as {
            schemaVersion: number;
            format: string;
            document: {
                header: {
                    objectType: number;
                    objectId: number;
                    textId: number;
                };
            };
        };
        expect(snapshot.schemaVersion).toBe(1);
        expect(snapshot.format).toBe("pro");
        expect(snapshot.document.header).toMatchObject({
            objectType: 5,
            objectId: 8,
            textId: 100,
        });
    });

    it("stores MAP snapshots as semantic document data instead of field-layout nodes", () => {
        const original: ParseResult = {
            format: "map",
            formatName: "Fallout MAP",
            root: {
                name: "MAP File",
                fields: [
                    {
                        name: "Header",
                        fields: [
                            { name: "Version", value: "Fallout 2", rawValue: 20, offset: 0, size: 4, type: "enum" },
                            { name: "Filename", value: "artemple", offset: 4, size: 16, type: "string" },
                            { name: "Default Position", value: 20_100, offset: 20, size: 4, type: "int32" },
                            { name: "Default Elevation", value: "0", rawValue: 0, offset: 24, size: 4, type: "enum" },
                            { name: "Default Orientation", value: "NE", rawValue: 0, offset: 28, size: 4, type: "enum" },
                            { name: "Num Local Vars", value: 1, offset: 32, size: 4, type: "int32" },
                            { name: "Script ID", value: -1, offset: 36, size: 4, type: "int32" },
                            { name: "Map Flags", value: "Has Elevation 0", rawValue: 0, offset: 40, size: 4, type: "flags" },
                            { name: "Darkness", value: 0, offset: 44, size: 4, type: "int32" },
                            { name: "Num Global Vars", value: 1, offset: 48, size: 4, type: "int32" },
                            { name: "Map ID", value: 42, offset: 52, size: 4, type: "int32" },
                            { name: "Timestamp", value: 123, offset: 56, size: 4, type: "uint32" },
                        ],
                    },
                    {
                        name: "Global Variables",
                        fields: [
                            { name: "Global Var 0", value: 11, offset: 240, size: 4, type: "int32" },
                        ],
                    },
                    {
                        name: "Local Variables",
                        fields: [
                            { name: "Local Var 0", value: 22, offset: 244, size: 4, type: "int32" },
                        ],
                    },
                    {
                        name: "Objects Section",
                        fields: [
                            { name: "Total Objects", value: 0, offset: 248, size: 4, type: "int32" },
                            {
                                name: "Elevation 0 Objects",
                                fields: [{ name: "Object Count", value: 0, offset: 252, size: 4, type: "int32" }],
                            },
                            {
                                name: "Elevation 1 Objects",
                                fields: [{ name: "Object Count", value: 0, offset: 256, size: 4, type: "int32" }],
                            },
                            {
                                name: "Elevation 2 Objects",
                                fields: [{ name: "Object Count", value: 0, offset: 260, size: 4, type: "int32" }],
                            },
                        ],
                    },
                ],
            },
            opaqueRanges: [
                {
                    label: "header-padding",
                    offset: 60,
                    size: 176,
                    hexChunks: ["00".repeat(176)],
                },
            ],
        };

        const snapshot = JSON.parse(createBinaryJsonSnapshot(original)) as {
            schemaVersion: number;
            format: string;
            document: {
                header: {
                    version: number;
                    filename: string;
                    defaultPosition: number;
                };
                globalVariables: number[];
                localVariables: number[];
            };
            opaqueRanges?: Array<{ label: string }>;
        };

        expect(snapshot.schemaVersion).toBe(1);
        expect(snapshot.format).toBe("map");
        expect(snapshot.document.header).toMatchObject({
            version: 20,
            filename: "artemple",
            defaultPosition: 20_100,
        });
        expect(snapshot.document.globalVariables).toEqual([11]);
        expect(snapshot.document.localVariables).toEqual([22]);
        expect(snapshot.opaqueRanges?.some((range) => range.label === "tiles")).toBe(true);
        const documentJson = JSON.stringify(snapshot.document);
        expect(documentJson).not.toContain("\"offset\"");
        expect(documentJson).not.toContain("\"size\"");
        expect(documentJson).not.toContain("\"valueType\"");
        expect(documentJson).not.toContain("\"nodeType\"");
    });

    it("rejects MAP snapshots that use decoded tiles instead of opaque tile ranges", () => {
        const original: ParseResult = {
            format: "map",
            formatName: "Fallout MAP",
            root: {
                name: "MAP File",
                fields: [
                    {
                        name: "Header",
                        fields: [
                            { name: "Version", value: "Fallout 2", rawValue: 20, offset: 0, size: 4, type: "enum" },
                            { name: "Filename", value: "artemple", offset: 4, size: 16, type: "string" },
                            { name: "Default Position", value: 20_100, offset: 20, size: 4, type: "int32" },
                            { name: "Default Elevation", value: "0", rawValue: 0, offset: 24, size: 4, type: "enum" },
                            { name: "Default Orientation", value: "NE", rawValue: 0, offset: 28, size: 4, type: "enum" },
                            { name: "Num Local Vars", value: 0, offset: 32, size: 4, type: "int32" },
                            { name: "Script ID", value: -1, offset: 36, size: 4, type: "int32" },
                            { name: "Map Flags", value: "Has Elevation 0", rawValue: 0, offset: 40, size: 4, type: "flags" },
                            { name: "Darkness", value: 0, offset: 44, size: 4, type: "int32" },
                            { name: "Num Global Vars", value: 0, offset: 48, size: 4, type: "int32" },
                            { name: "Map ID", value: 42, offset: 52, size: 4, type: "int32" },
                            { name: "Timestamp", value: 123, offset: 56, size: 4, type: "uint32" },
                        ],
                    },
                    {
                        name: "Objects Section",
                        fields: [
                            { name: "Total Objects", value: 0, offset: 248, size: 4, type: "int32" },
                            { name: "Elevation 0 Objects", fields: [{ name: "Object Count", value: 0, offset: 252, size: 4, type: "int32" }] },
                            { name: "Elevation 1 Objects", fields: [{ name: "Object Count", value: 0, offset: 256, size: 4, type: "int32" }] },
                            { name: "Elevation 2 Objects", fields: [{ name: "Object Count", value: 0, offset: 260, size: 4, type: "int32" }] },
                        ],
                    },
                ],
            },
            opaqueRanges: [{ label: "header-padding", offset: 60, size: 176, hexChunks: ["00".repeat(176)] }],
        };

        const dumped = JSON.parse(createBinaryJsonSnapshot(original)) as {
            opaqueRanges?: Array<{ label: string; offset: number; size: number; hexChunks: string[] }>;
        };
        dumped.opaqueRanges = (dumped.opaqueRanges ?? []).filter((range) => range.label !== "tiles");

        expect(() => parseBinaryJsonSnapshot(`${JSON.stringify(dumped)}\n`)).toThrow(/decoded tiles are not supported/i);
    });

    it("rejects invalid version 1 snapshots with unknown keys", () => {
        const invalid = JSON.stringify({
            schemaVersion: 1,
            format: "map",
            formatName: "Fallout MAP",
            document: {
                root: {
                    nodeType: "group",
                    key: "mapFile",
                    extra: true,
                    children: [],
                },
            },
        });

        expect(() => parseBinaryJsonSnapshot(invalid)).toThrow(/invalid json snapshot/i);
    });

    it("rejects legacy snapshots without a schema version", () => {
        const legacy = JSON.stringify(makeSnapshotResult());
        expect(() => parseBinaryJsonSnapshot(legacy)).toThrow(/invalid json snapshot/i);
    });

    it("loads canonical PRO documents back into parse results", () => {
        const snapshot = JSON.stringify({
            schemaVersion: 1,
            format: "pro",
            formatName: "Fallout PRO (Prototype)",
            document: {
                header: {
                    objectType: 5,
                    objectId: 1,
                    textId: 100,
                    frmType: 5,
                    frmId: 9,
                    lightRadius: 8,
                    lightIntensity: 65_536,
                    flags: 536_870_912,
                },
                sections: {
                    miscProperties: {
                        unknown: 0,
                    },
                },
            },
        });

        const parsed = parseBinaryJsonSnapshot(snapshot);
        const header = parsed.root.fields[0];
        expect(header && "fields" in header).toBe(true);
        if (!header || !("fields" in header)) {
            throw new Error("Expected header group");
        }
        expect(header.fields[0]).toMatchObject({ name: "Object Type", value: "Misc", rawValue: 5 });
        expect(header.fields[2]).toMatchObject({ name: "Text ID", value: 100 });
    });

    it("materializes canonical PRO snapshots through the shared validated loader", () => {
        const snapshot = JSON.stringify({
            schemaVersion: 1,
            format: "pro",
            formatName: "Fallout PRO (Prototype)",
            document: {
                header: {
                    objectType: 5,
                    objectId: 1,
                    textId: 100,
                    frmType: 5,
                    frmId: 9,
                    lightRadius: 8,
                    lightIntensity: 65_536,
                    flags: 536_870_912,
                },
                sections: {
                    miscProperties: {
                        unknown: 0,
                    },
                },
            },
        });

        const loaded = loadBinaryJsonSnapshot(snapshot);
        expect(loaded.bytes).toBeInstanceOf(Uint8Array);
        expect(loaded.parseResult.format).toBe("pro");
    });

    it("rejects canonical PRO snapshots that violate domain-specific field limits", () => {
        const snapshot = JSON.stringify({
            schemaVersion: 1,
            format: "pro",
            formatName: "Fallout PRO (Prototype)",
            document: {
                header: {
                    objectType: 5,
                    objectId: 1,
                    textId: 100,
                    frmType: 5,
                    frmId: 9,
                    lightRadius: 9,
                    lightIntensity: 65_536,
                    flags: 536_870_912,
                },
                sections: {
                    miscProperties: {
                        unknown: 0,
                    },
                },
            },
        });

        expect(() => parseBinaryJsonSnapshot(snapshot)).toThrow(/invalid json snapshot/i);
        expect(() => parseBinaryJsonSnapshot(snapshot)).toThrow(/actual=9/);
    });
});
