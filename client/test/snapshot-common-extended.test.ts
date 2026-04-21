/**
 * Extended unit tests for snapshot-common.ts.
 * Covers uncovered branches: slugify edge cases, makeUniqueKey deduplication,
 * parseScalarFieldValue branches (hex, percent, boolean, null, JSON-serialized objects),
 * and getScalarFieldLookupKey fallback path.
 */

import { describe, expect, it } from "vitest";
import { slugify, makeUniqueKey, parseScalarFieldValue, getScalarFieldLookupKey } from "../src/parsers/snapshot-common";
import type { ParsedField } from "../src/parsers/types";

// ---------------------------------------------------------------------------
// slugify
// ---------------------------------------------------------------------------

describe("slugify", () => {
    it("converts simple lowercase label to camelCase slug", () => {
        expect(slugify("object type")).toBe("objectType");
    });

    it("inserts space before uppercase transitions", () => {
        expect(slugify("objectType")).toBe("objectType");
        expect(slugify("ObjectType")).toBe("objectType");
    });

    it("removes non-alphanumeric characters", () => {
        expect(slugify("Foo-Bar_Baz")).toBe("fooBarBaz");
    });

    it("returns 'field' for empty or all-non-alphanumeric input", () => {
        // Line 12-13: !normalized branch
        expect(slugify("")).toBe("field");
        expect(slugify("---")).toBe("field");
    });

    it("handles single-word labels", () => {
        expect(slugify("Version")).toBe("version");
        expect(slugify("ID")).toBe("id");
    });

    it("preserves camelCase on known segment names", () => {
        expect(slugify("Default Elevation")).toBe("defaultElevation");
        expect(slugify("numLocalVars")).toBe("numLocalVars");
    });
});

// ---------------------------------------------------------------------------
// makeUniqueKey
// ---------------------------------------------------------------------------

describe("makeUniqueKey", () => {
    it("returns the base key unchanged on first use", () => {
        const used = new Map<string, number>();
        expect(makeUniqueKey("key", used)).toBe("key");
        expect(used.get("key")).toBe(1);
    });

    it("appends suffix on second and subsequent uses", () => {
        // Line 23: count !== 0 branch
        const used = new Map<string, number>();
        expect(makeUniqueKey("key", used)).toBe("key");
        expect(makeUniqueKey("key", used)).toBe("key2");
        expect(makeUniqueKey("key", used)).toBe("key3");
    });

    it("tracks different keys independently", () => {
        const used = new Map<string, number>();
        expect(makeUniqueKey("a", used)).toBe("a");
        expect(makeUniqueKey("b", used)).toBe("b");
        expect(makeUniqueKey("a", used)).toBe("a2");
    });
});

// ---------------------------------------------------------------------------
// parseScalarFieldValue
// ---------------------------------------------------------------------------

describe("parseScalarFieldValue", () => {
    function field(overrides: Partial<ParsedField>): ParsedField {
        return { name: "F", value: 0, offset: 0, size: 4, type: "uint32", ...overrides };
    }

    it("returns rawValue directly when present as number", () => {
        // Line 27: rawValue number branch
        const f = field({ value: "Item (0)", rawValue: 0 });
        expect(parseScalarFieldValue("pro", "pro.header.objectType", f)).toBe(0);
    });

    it("returns rawValue directly when present as string", () => {
        // Line 27: rawValue string branch
        const f = field({ value: "display", rawValue: "raw-string" });
        expect(parseScalarFieldValue("any", "any.key", f)).toBe("raw-string");
    });

    it("resolves lookup for known enum string value", () => {
        // Line 33-35: lookedUp !== undefined branch — enum lookup via display-lookups
        const f = field({ value: "NE", type: "enum" });
        const result = parseScalarFieldValue("map", "map.objects.elevations[].objects[].base.rotation", f);
        expect(typeof result).toBe("number");
    });

    it("parses hex string values (0x...)", () => {
        // Line 38-40: hex regex branch
        const f = field({ value: "0x1F" });
        expect(parseScalarFieldValue("testbin", "any.key", f)).toBe(31);
    });

    it("parses percent string values (-N%)", () => {
        // Line 42-44: percent regex branch
        const f = field({ value: "50%" });
        expect(parseScalarFieldValue("testbin", "any.key", f)).toBe(50);

        const neg = field({ value: "-10%" });
        expect(parseScalarFieldValue("testbin", "any.key", neg)).toBe(-10);
    });

    it("returns string value as-is when no special parsing applies", () => {
        const f = field({ value: "plain string" });
        expect(parseScalarFieldValue("testbin", "any.key", f)).toBe("plain string");
    });

    it("returns numeric value directly", () => {
        const f = field({ value: 42 });
        expect(parseScalarFieldValue("testbin", "any.key", f)).toBe(42);
    });

    it("returns boolean value directly", () => {
        // Line 31: boolean branch
        const f = field({ value: true, type: "uint8" });
        expect(parseScalarFieldValue("testbin", "any.key", f)).toBe(true);
    });

    it("returns null value directly", () => {
        // Line 31: null branch
        const f = field({ value: null });
        expect(parseScalarFieldValue("testbin", "any.key", f)).toBeNull();
    });

    it("JSON-serializes non-scalar values", () => {
        // Line 50: JSON.stringify branch
        const f = field({ value: [1, 2, 3] as unknown as string });
        expect(parseScalarFieldValue("testbin", "any.key", f)).toBe("[1,2,3]");
    });
});

// ---------------------------------------------------------------------------
// getScalarFieldLookupKey
// ---------------------------------------------------------------------------

describe("getScalarFieldLookupKey", () => {
    it("returns semantic key when adapter exists (pro format)", () => {
        // toSemanticFieldKey returns non-undefined
        const key = getScalarFieldLookupKey("pro", ["Header", "Object Type"]);
        expect(key).toBe("pro.header.objectType");
    });

    it("falls back to createFieldKey for unknown format", () => {
        // Line 54: toSemanticFieldKey returns undefined, uses createFieldKey
        const key = getScalarFieldLookupKey("unknown-format", ["Segment A", "Segment B"]);
        expect(key).toBe("/Segment A/Segment B");
    });
});
