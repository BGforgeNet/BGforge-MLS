/**
 * Tests for IESDP offset processing functions.
 */

import { describe, expect, it } from "vitest";
import {
    getOffsetPrefix,
    getFormatVersion,
    getOffsetId,
    stringToId,
    getOffsetSize,
    validateOffset,
    offsetIsUnused,
    offsetsToDefinition,
} from "../src/ie/offsets.ts";
import type { OffsetItem } from "../src/ie/types.ts";

describe("getOffsetPrefix", () => {
    it("generates prefix for v2 header", () => {
        expect(getOffsetPrefix("itm_v2", "header.yml")).toBe("ITM2_");
    });

    it("generates prefix for v1 header (no version suffix)", () => {
        expect(getOffsetPrefix("itm_v1", "header.yml")).toBe("ITM_");
    });

    it("generates prefix with custom suffix for non-standard files", () => {
        expect(getOffsetPrefix("eff_v2", "body.yml")).toBe("EFF2_");
    });

    it("generates prefix for extended_header", () => {
        expect(getOffsetPrefix("itm_v1", "extended_header.yml")).toBe("ITM_HEAD_");
    });

    it("generates prefix for custom data file names", () => {
        expect(getOffsetPrefix("spl_v1", "casting_feature_block.yml")).toBe("SPL_CASTING_FEATURE_BLOCK_");
    });

    it("handles versions with dots", () => {
        expect(getOffsetPrefix("cre_v1.0", "header.yml")).toBe("CRE10_");
    });
});

describe("getFormatVersion", () => {
    it("simplifies v2 format", () => {
        expect(getFormatVersion("eff_v2")).toBe("eff2");
    });

    it("strips v1 version number", () => {
        expect(getFormatVersion("itm_v1")).toBe("itm");
    });

    it("handles versions with dots", () => {
        expect(getFormatVersion("cre_v1.0")).toBe("cre10");
    });
});

describe("getOffsetId", () => {
    it("uses custom id when present", () => {
        const item: OffsetItem = { type: "dword", desc: "Some field", id: "CUSTOM_ID" };
        expect(getOffsetId(item, "ITM_")).toBe("ITM_CUSTOM_ID");
    });

    it("generates id from description when no custom id", () => {
        const item: OffsetItem = { type: "dword", desc: "Flags" };
        expect(getOffsetId(item, "ITM_")).toBe("ITM_flags");
    });
});

describe("stringToId", () => {
    it("converts description to lowercase identifier", () => {
        expect(stringToId("Flags", "ITM_")).toBe("ITM_flags");
    });

    it("strips markdown links", () => {
        expect(stringToId("[Link Text](http://example.com)", "P_")).toBe("P_link_text");
    });

    it("applies custom replacements", () => {
        expect(stringToId("Probability 1", "P_")).toBe("P_probability1");
        expect(stringToId("Usability flags", "P_")).toBe("P_usabilityflags");
        expect(stringToId("Parameter 1", "P_")).toBe("P_parameter1");
        expect(stringToId("Resource 1", "P_")).toBe("P_resource1");
        expect(stringToId("Alternative damage", "P_")).toBe("P_alt_damage");
    });

    it("removes periods", () => {
        expect(stringToId("v1.0", "P_")).toBe("P_v10");
    });

    it("throws on invalid characters", () => {
        expect(() => stringToId("invalid@char", "P_")).toThrow("Bad id");
    });

    it("strips nested HTML tags without leaving residual brackets", () => {
        // CodeQL js/incomplete-multi-character-sanitization: a single greedy
        // /<[^>]+>/g pass over `<bar<baz>>` matches `<bar<baz>` and leaves a
        // stray `>` behind, which then fails the alphanumeric validator.
        // The sanitization must remove all `<` and `>` characters.
        expect(stringToId("foo<bar<baz>>quux", "P_")).toBe("P_fooquux");
    });
});

describe("getOffsetSize", () => {
    it("returns explicit length when present", () => {
        expect(getOffsetSize({ type: "byte", desc: "x", length: 32 })).toBe(32);
    });

    it("returns standard sizes for known types", () => {
        expect(getOffsetSize({ type: "byte", desc: "x" })).toBe(1);
        expect(getOffsetSize({ type: "char", desc: "x" })).toBe(1);
        expect(getOffsetSize({ type: "word", desc: "x" })).toBe(2);
        expect(getOffsetSize({ type: "dword", desc: "x" })).toBe(4);
        expect(getOffsetSize({ type: "resref", desc: "x" })).toBe(8);
        expect(getOffsetSize({ type: "strref", desc: "x" })).toBe(4);
    });

    it("multiplies by mult factor", () => {
        expect(getOffsetSize({ type: "dword", desc: "x", mult: 3 })).toBe(12);
    });

    it("throws on unknown type", () => {
        expect(() => getOffsetSize({ type: "unknown_type", desc: "x" })).toThrow("Unknown offset type");
    });
});

describe("validateOffset", () => {
    it("does not throw when no offset is declared", () => {
        expect(() => validateOffset(4, { type: "dword", desc: "x" })).not.toThrow();
    });

    it("does not throw when offset matches", () => {
        expect(() => validateOffset(4, { type: "dword", desc: "x", offset: 4 })).not.toThrow();
    });

    it("throws on offset mismatch", () => {
        expect(() => validateOffset(4, { type: "dword", desc: "x", offset: 8 })).toThrow("Offset mismatch");
    });
});

describe("offsetIsUnused", () => {
    it("returns true for unused flag", () => {
        expect(offsetIsUnused({ type: "byte", desc: "x", unused: true })).toBe(true);
    });

    it("returns true for unknown flag", () => {
        expect(offsetIsUnused({ type: "byte", desc: "x", unknown: true })).toBe(true);
    });

    it("returns true for 'Unknown' description", () => {
        expect(offsetIsUnused({ type: "byte", desc: "Unknown" })).toBe(true);
    });

    it("returns false for normal items", () => {
        expect(offsetIsUnused({ type: "byte", desc: "Flags" })).toBe(false);
    });
});

describe("offsetsToDefinition", () => {
    it("generates definition map from offset data", () => {
        const data: OffsetItem[] = [
            { type: "dword", desc: "Flags", offset: 0 },
            { type: "word", desc: "Type" },
        ];
        const result = offsetsToDefinition(data, "ITM_");
        expect(result).toEqual(
            new Map([
                ["ITM_flags", "0x0"],
                ["ITM_type", "0x4"],
            ]),
        );
    });

    it("skips unused items", () => {
        const data: OffsetItem[] = [
            { type: "dword", desc: "Flags", offset: 0 },
            { type: "dword", desc: "unused", unused: true },
            { type: "word", desc: "Type" },
        ];
        const result = offsetsToDefinition(data, "P_");
        expect(result).toEqual(
            new Map([
                ["P_flags", "0x0"],
                ["P_type", "0x8"],
            ]),
        );
    });

    it("returns empty map for empty input", () => {
        expect(offsetsToDefinition([], "P_")).toEqual(new Map());
    });
});
