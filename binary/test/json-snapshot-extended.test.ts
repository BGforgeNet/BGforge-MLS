/**
 * Extended unit tests for json-snapshot.ts: the load error paths (malformed JSON, a missing or
 * non-string "format", a format with no adapter) and a PRO enum given as a display string.
 */

import { describe, expect, it } from "vitest";
import "../src/register-formats";
import { loadBinaryJsonSnapshot, createBinaryJsonSnapshot } from "../src/json-snapshot";
import type { ParseResult } from "../src/types";

const proSnapshot = JSON.stringify({
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
            lightIntensity: 65536,
            flags: ["lightThru"],
        },
        sections: { miscProperties: { unknown: 0 } },
    },
});

describe("loadBinaryJsonSnapshot - accepts a single ParseOptions bag", () => {
    it("forwards a flat parseOptions bag to the format adapter without per-format keys", () => {
        // The pre-change shape was `{ proParseOptions, mapParseOptions }`, requiring the call site to know each
        // format's option bag. The test compiles only while the single `ParseOptions` signature holds.
        const loaded = loadBinaryJsonSnapshot(proSnapshot, { gracefulMapBoundaries: true });
        expect(loaded.parseResult.format).toBe("pro");
    });
});

describe("loadBinaryJsonSnapshot - error handling", () => {
    it("throws a wrapped error for completely invalid JSON", () => {
        expect(() => loadBinaryJsonSnapshot("{not json")).toThrow(/^Invalid JSON snapshot: /);
    });

    it("refuses a snapshot with no format field", () => {
        const withoutFormat = JSON.stringify({ schemaVersion: 1, formatName: "Test Binary" });
        expect(() => loadBinaryJsonSnapshot(withoutFormat)).toThrow(
            new Error('Invalid JSON snapshot: "format" must be a string'),
        );
    });

    it("refuses a snapshot whose format is not a string", () => {
        const withNumericFormat = JSON.stringify({ schemaVersion: 1, format: 99, formatName: "Test Binary" });
        expect(() => loadBinaryJsonSnapshot(withNumericFormat)).toThrow(
            new Error('Invalid JSON snapshot: "format" must be a string'),
        );
    });

    it("refuses a JSON value that is not an object", () => {
        expect(() => loadBinaryJsonSnapshot("null")).toThrow(
            new Error('Invalid JSON snapshot: "format" must be a string'),
        );
    });

    it("refuses a format with no registered adapter", () => {
        const unknown = JSON.stringify({ schemaVersion: 1, format: "testbin", formatName: "Test Binary" });
        expect(() => loadBinaryJsonSnapshot(unknown)).toThrow(
            new Error('Invalid JSON snapshot: No format adapter is registered for format "testbin"'),
        );
    });
});

describe("createBinaryJsonSnapshot - enum given as a display string", () => {
    it("recovers the enum number from a display string with the value in parentheses", () => {
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
                            { name: "FRM Type", value: "Misc (5)", offset: 8, size: 1, type: "enum" },
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

        const parsed = JSON.parse(createBinaryJsonSnapshot(result)) as { document: { header: { objectType: number } } };
        expect(parsed.document.header.objectType).toBe(5);
    });
});
