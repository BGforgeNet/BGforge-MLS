import { describe, expect, it } from "vitest";
import { buildCallablePatterns, buildHighlightPatterns, buildVarsPatterns } from "../src/update-tp2-highlight.ts";
import { loadData } from "../src/generate-data.ts";
import { cmpStr } from "../src/yaml-helpers.ts";

const DATA = loadData(["server/data/weidu-tp2-base.yml"]);

describe("buildHighlightPatterns", () => {
    it("marks deprecated patch items with the deprecated highlight scope", () => {
        const patterns = buildHighlightPatterns(DATA, "patch");

        const compileBaf = patterns.find((p) => p.match === "\\b(COMPILE_BAF_TO_BCS)\\b");
        expect(compileBaf).toBeDefined();
        expect(compileBaf!.name).toBe("invalid.deprecated.bgforge");

        const say = patterns.find((p) => p.match === "\\b(SAY)\\b");
        expect(say).toBeDefined();
        expect(say!.name).toBeUndefined();
    });

    it("sorts generated patterns by match string", () => {
        const patterns = buildHighlightPatterns(DATA, "action");
        const matches = patterns.map((p) => p.match);
        expect(matches).toEqual([...matches].sort(cmpStr));
    });

    it("generates patterns for all mapped stanzas", () => {
        for (const stanza of [
            "action",
            "array_sort_type",
            "caching",
            "component_flag",
            "flag",
            "language",
            "opt_case",
            "opt_exact",
            "opt_glob",
            "patch",
            "patch_byte",
            "patch_long",
            "patch_string",
            "prologue",
            "value_constant",
            "value_function",
            "when",
        ]) {
            const patterns = buildHighlightPatterns(DATA, stanza);
            expect(patterns.length).toBeGreaterThan(0);
        }
    });

    it("throws for unknown stanza", () => {
        expect(() => buildHighlightPatterns(DATA, "nonexistent")).toThrow("not found");
    });

    it("skipCatchall excludes items matching upper-case-constants regex", () => {
        const all = buildHighlightPatterns(DATA, "value_constant");
        const filtered = buildHighlightPatterns(DATA, "value_constant", true);
        // Filtered should be smaller — UPPER_CASE items with underscore are excluded
        expect(filtered.length).toBeLessThan(all.length);
        // Single-word items like BIT0, DAMAGE should remain
        expect(filtered.some((p) => p.match === "\\b(BIT0)\\b")).toBe(true);
        // Items with underscores like BATTLE_CRY1 should be excluded
        expect(filtered.some((p) => p.match === "\\b(BATTLE_CRY1)\\b")).toBe(false);
    });
});

describe("buildCallablePatterns", () => {
    it("deduplicates items across callable stanzas", () => {
        const patterns = buildCallablePatterns(DATA);
        const matches = patterns.map((p) => p.match);
        expect(new Set(matches).size).toBe(matches.length);
    });

    it("assigns per-type scope names", () => {
        const patterns = buildCallablePatterns(DATA);
        const scopes = new Set(patterns.map((p) => p.name));
        expect(scopes).toContain("support.function.weidu-tp2.patch-function");
        expect(scopes).toContain("support.function.weidu-tp2.dimorphic-function");
    });

    it("sorts patterns by match string", () => {
        const patterns = buildCallablePatterns(DATA);
        const matches = patterns.map((p) => p.match);
        expect(matches).toEqual([...matches].sort(cmpStr));
    });
});

describe("buildVarsPatterns", () => {
    it("merges vars and constants stanzas", () => {
        const patterns = buildVarsPatterns(DATA);
        // vars (29) + constants (37) = 66
        expect(patterns.length).toBe(66);
    });

    it("uses (%?NAME%?) pattern format", () => {
        const patterns = buildVarsPatterns(DATA);
        for (const p of patterns) {
            expect(p.match).toMatch(/^\(%\?\w+%\?\)$/);
        }
    });

    it("sorts patterns by match string", () => {
        const patterns = buildVarsPatterns(DATA);
        const matches = patterns.map((p) => p.match);
        expect(matches).toEqual([...matches].sort(cmpStr));
    });
});
