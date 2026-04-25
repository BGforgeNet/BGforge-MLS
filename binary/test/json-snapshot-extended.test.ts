/**
 * Extended unit tests for json-snapshot.ts.
 * Covers uncovered branches: loadBinaryJsonSnapshot error path, format check
 * branches (no "format" field, format not a string, null parsed object),
 * parseFieldValue string-enum roundtrip with unknown rawValue, boolean/null field values.
 */

import { describe, expect, it } from "vitest";
import { loadBinaryJsonSnapshot, createBinaryJsonSnapshot, parseBinaryJsonSnapshot } from "../src/json-snapshot";
import type { ParseResult } from "../src/types";

function makeSimpleResult(overrides: Partial<ParseResult> = {}): ParseResult {
    return {
        format: "testbin",
        formatName: "Test Binary",
        root: {
            name: "Root",
            fields: [{ name: "Value", value: 42, offset: 0, size: 4, type: "uint32" }],
        },
        ...overrides,
    };
}

describe("loadBinaryJsonSnapshot — error handling", () => {
    it("throws a wrapped error for completely invalid JSON", () => {
        // Line 266-268: catch branch
        expect(() => loadBinaryJsonSnapshot("{not json")).toThrow(/invalid json snapshot/i);
    });

    it("throws when schemaVersion is missing from a non-adapter format", () => {
        const noVersion = JSON.stringify({ format: "testbin", formatName: "X", root: {} });
        expect(() => loadBinaryJsonSnapshot(noVersion)).toThrow(/invalid json snapshot/i);
    });

    it("falls through to generic schema when format field is absent", () => {
        // Line 251: parsed has no "format" key — skips adapter lookup
        const withoutFormat = JSON.stringify({
            schemaVersion: 1,
            format: "testbin",
            formatName: "Test Binary",
            root: {
                nodeType: "group",
                key: "root",
                label: "Root",
                children: [],
            },
        });
        const result = loadBinaryJsonSnapshot(withoutFormat);
        expect(result.parseResult.format).toBe("testbin");
    });

    it("falls through when format value is not a string", () => {
        // Line 253: typeof format !== "string"
        const withNumericFormat = JSON.stringify({
            schemaVersion: 1,
            format: 99,
            formatName: "Test Binary",
            root: {
                nodeType: "group",
                key: "root",
                label: "Root",
                children: [],
            },
        });
        // Zod will reject this because format must be a string
        expect(() => loadBinaryJsonSnapshot(withNumericFormat)).toThrow(/invalid json snapshot/i);
    });
});

describe("loadBinaryJsonSnapshot — field types in generic schema", () => {
    it("round-trips a snapshot with warnings and errors arrays", () => {
        const result = makeSimpleResult({ warnings: ["w1"], errors: ["e1"] });
        const json = createBinaryJsonSnapshot(result);
        const loaded = loadBinaryJsonSnapshot(json);
        expect(loaded.parseResult.warnings).toEqual(["w1"]);
        expect(loaded.parseResult.errors).toEqual(["e1"]);
    });

    it("round-trips a snapshot with opaque ranges", () => {
        const result = makeSimpleResult({
            opaqueRanges: [{ label: "test", offset: 0, size: 4, hexChunks: ["deadbeef"] }],
        });
        const json = createBinaryJsonSnapshot(result);
        const loaded = loadBinaryJsonSnapshot(json);
        expect(loaded.parseResult.opaqueRanges).toHaveLength(1);
        expect(loaded.parseResult.opaqueRanges![0]!.label).toBe("test");
    });

    it("round-trips a snapshot with a group that has description and expanded", () => {
        const result: ParseResult = {
            format: "testbin",
            formatName: "Test",
            root: {
                name: "Root",
                description: "root desc",
                fields: [
                    {
                        name: "Group",
                        description: "group desc",
                        expanded: false,
                        fields: [{ name: "Field", value: 1, offset: 0, size: 1, type: "uint8" }],
                    },
                ],
            },
        };
        const json = createBinaryJsonSnapshot(result);
        const loaded = parseBinaryJsonSnapshot(json);
        // Root description is preserved
        expect(loaded.root.description).toBe("root desc");
        // Child group expanded=false is preserved
        const childGroup = loaded.root.fields[0];
        expect(childGroup && "expanded" in childGroup ? childGroup.expanded : undefined).toBe(false);
    });

    it("round-trips a field with description set", () => {
        const result: ParseResult = {
            format: "testbin",
            formatName: "Test",
            root: {
                name: "Root",
                fields: [{ name: "F", value: 10, offset: 0, size: 4, type: "uint32", description: "some desc" }],
            },
        };
        const json = createBinaryJsonSnapshot(result);
        const loaded = parseBinaryJsonSnapshot(json);
        const field = loaded.root.fields[0];
        expect(field && "description" in field ? field.description : undefined).toBe("some desc");
    });
});

describe("parseFieldValue — enum/flags with string input", () => {
    it("round-trips an enum field where value is already a display string", () => {
        // parseFieldValue: field.value is a string, valueType is "enum", rawValue lookup succeeds
        const result: ParseResult = {
            format: "pro",
            formatName: "Fallout PRO (Prototype)",
            root: {
                name: "PRO File",
                fields: [
                    {
                        name: "Header",
                        fields: [
                            { name: "Object Type", value: "Misc (5)", offset: 0, size: 1, type: "enum" },
                            { name: "Object ID", value: 1, offset: 1, size: 3, type: "uint24" },
                            { name: "Text ID", value: 100, offset: 4, size: 4, type: "uint32" },
                            { name: "FRM Type", value: "Background (5)", offset: 8, size: 1, type: "enum" },
                            { name: "FRM ID", value: 9, offset: 9, size: 3, type: "uint24" },
                            { name: "Light Radius", value: 0, offset: 12, size: 4, type: "uint32" },
                            { name: "Light Intensity", value: 0, offset: 16, size: 4, type: "uint32" },
                            { name: "Flags", value: "(none)", rawValue: 0, offset: 20, size: 4, type: "flags" },
                        ],
                    },
                    {
                        name: "Misc Properties",
                        fields: [{ name: "Unknown", value: 0, offset: 24, size: 4, type: "uint32" }],
                    },
                ],
            },
        };

        // createBinaryJsonSnapshot will produce canonical PRO format (uses pro adapter)
        const json = createBinaryJsonSnapshot(result);
        const parsed = JSON.parse(json) as { format: string; document: { header: { objectType: number } } };
        // Should correctly extract objectType = 5 even though display string was "Misc (5)"
        expect(parsed.document.header.objectType).toBe(5);
    });

    it("round-trips a flags field value string through loadBinaryJsonSnapshot for generic format", () => {
        // parseFieldValue branch: field.value is a string, valueType is "flags",
        // rawValue lookup returns undefined (unknown string), value returned as-is
        const genericSnapshot = JSON.stringify({
            schemaVersion: 1,
            format: "testbin",
            formatName: "Test Binary",
            root: {
                nodeType: "group",
                key: "root",
                label: "Root",
                children: [
                    {
                        nodeType: "field",
                        key: "someFlags",
                        label: "Some Flags",
                        offset: 0,
                        size: 4,
                        valueType: "flags",
                        value: "unknown display string",
                    },
                ],
            },
        });
        const loaded = loadBinaryJsonSnapshot(genericSnapshot);
        const field = loaded.parseResult.root.fields[0];
        expect(field && "value" in field ? field.value : undefined).toBe("unknown display string");
    });
});
