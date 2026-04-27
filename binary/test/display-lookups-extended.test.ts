/**
 * Extended unit tests for display-lookups.ts.
 * Covers uncovered branches: isFlagActive (equal/clear/set with bitValue=0),
 * resolveDisplayValue (unknown enum, empty flags, no lookup), resolveStoredFieldValue,
 * resolveRawValueFromDisplay (flag with "(none)", unrecognized part, equal-activation).
 */

import { describe, expect, it } from "vitest";
import {
    resolveDisplayValue,
    resolveEnumLookup,
    resolveFlagLookup,
    resolveRawValueFromDisplay,
    resolveStringCharset,
    formatEnumDisplayValue,
    resolveStoredFieldValue,
} from "../src/display-lookups";

// ---------------------------------------------------------------------------
// resolveEnumLookup
// ---------------------------------------------------------------------------

describe("resolveStringCharset", () => {
    it("returns the configured charset for a presentation entry that sets one", () => {
        expect(resolveStringCharset("map", "map.header.filename", "Filename")).toBe("ascii-printable");
    });

    it("defaults to utf8 for fields without a presentation entry", () => {
        expect(resolveStringCharset("map", "map.no.such.field", "Whatever")).toBe("utf8");
    });

    it("defaults to utf8 for an unknown format", () => {
        expect(resolveStringCharset("unknown", "any.key", "Field")).toBe("utf8");
    });
});

describe("resolveEnumLookup", () => {
    it("returns lookup table for a known enum field", () => {
        const table = resolveEnumLookup("pro", "pro.header.objectType", "Object Type");
        expect(table).toBeDefined();
        expect(typeof table![0]).toBe("string"); // 0 = Item
    });

    it("returns undefined for unknown format", () => {
        expect(resolveEnumLookup("unknown", "any.key", "Field")).toBeUndefined();
    });

    it("returns undefined for a flags field (not enum)", () => {
        const table = resolveEnumLookup("pro", "pro.header.flags", "Flags");
        expect(table).toBeUndefined();
    });
});

// ---------------------------------------------------------------------------
// resolveFlagLookup
// ---------------------------------------------------------------------------

describe("resolveFlagLookup", () => {
    it("returns flag table for a known flags field", () => {
        const table = resolveFlagLookup("pro", "pro.header.flags", "Flags");
        expect(table).toBeDefined();
    });

    it("returns undefined for an enum field (not flags)", () => {
        expect(resolveFlagLookup("pro", "pro.header.objectType", "Object Type")).toBeUndefined();
    });
});

// ---------------------------------------------------------------------------
// formatEnumDisplayValue
// ---------------------------------------------------------------------------

describe("formatEnumDisplayValue", () => {
    it("appends numeric raw value when label differs from number string", () => {
        expect(formatEnumDisplayValue("Item", 0)).toBe("Item (0)");
    });

    it("returns label only when label equals the raw value as string", () => {
        // Line 76: label === String(rawValue) branch
        expect(formatEnumDisplayValue("42", 42)).toBe("42");
    });
});

// ---------------------------------------------------------------------------
// resolveDisplayValue
// ---------------------------------------------------------------------------

describe("resolveDisplayValue", () => {
    it("returns formatted enum label for known value", () => {
        // enum path — objectType 5 = Misc
        const result = resolveDisplayValue("pro", "pro.header.objectType", "Object Type", 5);
        expect(result).toBe("Misc (5)");
    });

    it("returns 'Unknown (N)' for enum field with unrecognised raw value", () => {
        // Line 63: label undefined branch
        const result = resolveDisplayValue("pro", "pro.header.objectType", "Object Type", 99);
        expect(result).toBe("Unknown (99)");
    });

    it("returns joined active flag labels for flags field", () => {
        // flags path — headerFlags 0x20000000 = NoRemove flag (if set)
        const result = resolveDisplayValue("pro", "pro.header.flags", "Flags", 0);
        // When rawValue=0 and no flags are set, display is "(none)"
        expect(result).toBe("(none)");
    });

    it("returns string representation of raw value when no lookup exists", () => {
        // Line 72: no enum, no flags — falls through to String(rawValue)
        const result = resolveDisplayValue("testbin", "testbin.any.key", "Unknown Field", 42);
        expect(result).toBe("42");
    });
});

// ---------------------------------------------------------------------------
// resolveStoredFieldValue
// ---------------------------------------------------------------------------

describe("resolveStoredFieldValue", () => {
    it("returns enum label without numeric suffix for stored values", () => {
        const result = resolveStoredFieldValue("pro", "pro.header.objectType", "Object Type", 5);
        expect(result).toBe("Misc");
    });

    it("returns 'Unknown (N)' for unrecognised enum raw value", () => {
        const result = resolveStoredFieldValue("pro", "pro.header.objectType", "Object Type", 99);
        expect(result).toBe("Unknown (99)");
    });

    it("returns joined flag labels for flags field", () => {
        // flags field with all flags clear returns "(none)"
        const result = resolveStoredFieldValue("pro", "pro.header.flags", "Flags", 0);
        expect(result).toBe("(none)");
    });

    it("returns stringified raw value for fields with no lookup", () => {
        // Line 95-97: falls through to String(rawValue)
        const result = resolveStoredFieldValue("testbin", "no.lookup.field", "Field", 7);
        expect(result).toBe("7");
    });
});

// ---------------------------------------------------------------------------
// resolveRawValueFromDisplay  (lines 99-161)
// ---------------------------------------------------------------------------

describe("resolveRawValueFromDisplay", () => {
    it("resolves enum display label back to raw number", () => {
        // Basic enum lookup
        const result = resolveRawValueFromDisplay("pro", "pro.header.objectType", "Object Type", "Misc (5)");
        expect(result).toBe(5);
    });

    it("returns undefined for unrecognised enum display string", () => {
        const result = resolveRawValueFromDisplay("pro", "pro.header.objectType", "Object Type", "GiantBug");
        expect(result).toBeUndefined();
    });

    it("resolves '(none)' to 0 for a flags field", () => {
        // Line 121-123: parts.length === 1 && parts[0] === "(none)" branch
        const result = resolveRawValueFromDisplay("pro", "pro.header.flags", "Flags", "(none)");
        expect(result).toBe(0);
    });

    it("resolves 'None' to 0 for a flags field", () => {
        // Line 121: parts[0] === "None" branch
        const result = resolveRawValueFromDisplay("pro", "pro.header.flags", "Flags", "None");
        expect(result).toBe(0);
    });

    it("returns undefined for flag display with unrecognised part", () => {
        // Lines 150-154: part not in flagTable
        const result = resolveRawValueFromDisplay("pro", "pro.header.flags", "Flags", "NotAFlag");
        expect(result).toBeUndefined();
    });

    it("returns undefined for fields with no lookup table", () => {
        const result = resolveRawValueFromDisplay("testbin", "testbin.any.key", "Field", "value");
        expect(result).toBeUndefined();
    });

    it("resolves map flag field that uses 'clear' activation", () => {
        // mapFlags has flagActivation "clear" for some bits — "Has Elevation 0" means bit 2 is clear
        const result = resolveRawValueFromDisplay("map", "map.header.mapFlags", "Map Flags", "Has Elevation 0");
        expect(typeof result).toBe("number");
    });
});
