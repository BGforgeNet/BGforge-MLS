import { describe, expect, it } from "vitest";
import { filterOptions } from "../../src/webview-ui/filter-options";

const sampleOptions = [
    { value: 0, label: "None" },
    { value: 1, label: "Fire Damage" },
    { value: 2, label: "Cold Damage" },
    { value: 3, label: "Fireball" },
    { value: 100, label: "Charm Animal" },
];

describe("filterOptions", () => {
    it("returns all options for an empty query", () => {
        expect(filterOptions(sampleOptions, "")).toEqual(sampleOptions);
    });

    it("returns all options for a whitespace-only query", () => {
        expect(filterOptions(sampleOptions, "   ")).toEqual(sampleOptions);
    });

    it("filters case-insensitively", () => {
        const result = filterOptions(sampleOptions, "fire");
        expect(result).toContainEqual({ value: 1, label: "Fire Damage" });
        expect(result).toContainEqual({ value: 3, label: "Fireball" });
        expect(result).not.toContainEqual({ value: 2, label: "Cold Damage" });
    });

    it("matches substrings, not just prefixes", () => {
        const result = filterOptions(sampleOptions, "damage");
        expect(result).toContainEqual({ value: 1, label: "Fire Damage" });
        expect(result).toContainEqual({ value: 2, label: "Cold Damage" });
        expect(result).not.toContainEqual({ value: 3, label: "Fireball" });
    });

    it("returns empty array when no options match", () => {
        expect(filterOptions(sampleOptions, "zzznomatch")).toEqual([]);
    });
});
