/**
 * Extended unit tests for presentation-schema.ts.
 * Covers uncovered branches: resolveFieldPresentation with pattern+exact merge,
 * pattern fieldNameRegex filter, mergePresentation, toNumericOptionMap with undefined,
 * createFieldKey escaping, createSemanticFieldKeyFromId.
 */

import { describe, expect, it } from "vitest";
import {
    createFieldKey,
    toSemanticFieldKey,
    createSemanticFieldKeyFromId,
    resolveFieldPresentation,
    toNumericOptionMap,
} from "../src/presentation-schema";

// ---------------------------------------------------------------------------
// createFieldKey
// ---------------------------------------------------------------------------

describe("createFieldKey", () => {
    it("joins segments with / separator", () => {
        expect(createFieldKey(["Header", "Object Type"])).toBe("/Header/Object Type");
    });

    it("escapes ~ and / within segment names", () => {
        // Lines 64-66: escape ~ and /
        expect(createFieldKey(["a~b"])).toBe("/a~0b");
        expect(createFieldKey(["a/b"])).toBe("/a~1b");
        expect(createFieldKey(["a~0b"])).toBe("/a~00b"); // ~ in segment that already has ~0
    });

    it("handles empty segment array", () => {
        expect(createFieldKey([])).toBe("/");
    });
});

// ---------------------------------------------------------------------------
// toSemanticFieldKey
// ---------------------------------------------------------------------------

describe("toSemanticFieldKey", () => {
    it("returns semantic key for pro adapter", () => {
        expect(toSemanticFieldKey("pro", ["Header", "Object Type"])).toBe("pro.header.objectType");
    });

    it("returns undefined for unknown format", () => {
        expect(toSemanticFieldKey("unknown-fmt", ["Header"])).toBeUndefined();
    });
});

// ---------------------------------------------------------------------------
// createSemanticFieldKeyFromId
// ---------------------------------------------------------------------------

describe("createSemanticFieldKeyFromId", () => {
    it("converts JSON segment array to semantic key for known format", () => {
        const result = createSemanticFieldKeyFromId("pro", JSON.stringify(["Header", "Object Type"]));
        expect(result).toBe("pro.header.objectType");
    });

    it("returns undefined for unknown format", () => {
        const result = createSemanticFieldKeyFromId("unknown", JSON.stringify(["Header"]));
        expect(result).toBeUndefined();
    });

    it("returns undefined for malformed JSON", () => {
        // Line 83: try/catch branch
        expect(createSemanticFieldKeyFromId("pro", "not-json")).toBeUndefined();
    });

    it("returns undefined when JSON is not a string array", () => {
        // Line 79-82: !Array.isArray or non-string elements
        expect(createSemanticFieldKeyFromId("pro", JSON.stringify({ key: "val" }))).toBeUndefined();
        expect(createSemanticFieldKeyFromId("pro", JSON.stringify([1, 2]))).toBeUndefined();
    });
});

// ---------------------------------------------------------------------------
// resolveFieldPresentation — pattern merge + exact override
// ---------------------------------------------------------------------------

describe("resolveFieldPresentation", () => {
    it("returns undefined for unknown format", () => {
        expect(resolveFieldPresentation("unknown", "any.key", "Field")).toBeUndefined();
    });

    it("returns undefined when neither pattern nor exact matches", () => {
        // Line 249: Object.keys(presentation).length === 0
        expect(resolveFieldPresentation("pro", "pro.completely.unknown.field", "Unknown")).toBeUndefined();
    });

    it("merges pattern presentation into base when pattern matches", () => {
        // MAP pattern field: hex32 numericFormat
        const result = resolveFieldPresentation("map", "map.objects.elevations[].objects[].base.pid", "PID");
        expect(result).toMatchObject({ numericFormat: "hex32" });
    });

    it("exact field overrides pattern field", () => {
        // MAP exact field: map.header.filename has label "Filename"
        const result = resolveFieldPresentation("map", "map.header.filename", "Filename");
        expect(result).toMatchObject({ label: "Filename" });
    });

    it("resolves PRO exact field with flagActivation (map flags)", () => {
        const result = resolveFieldPresentation("map", "map.header.mapFlags", "Map Flags");
        expect(result).toMatchObject({ presentationType: "flags" });
        expect(result?.flagActivation).toBeDefined();
    });
});

// ---------------------------------------------------------------------------
// toNumericOptionMap
// ---------------------------------------------------------------------------

describe("toNumericOptionMap", () => {
    it("returns undefined when options is undefined", () => {
        // Line 253-255: !options branch
        expect(toNumericOptionMap(undefined)).toBeUndefined();
    });

    it("converts string keys to numbers", () => {
        expect(toNumericOptionMap({ "0": "Zero", "255": "Max" })).toEqual({ 0: "Zero", 255: "Max" });
    });
});
