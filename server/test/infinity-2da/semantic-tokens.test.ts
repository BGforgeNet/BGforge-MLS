/**
 * Unit tests for infinity-2da/semantic-tokens.ts - zebra-grid cell token extraction.
 */

import { describe, expect, it } from "vitest";
import { getSemanticTokenSpans } from "../../src/infinity-2da/semantic-tokens";
import { CELL_2DA_C0, CELL_2DA_C1, CELL_2DA_COL_TYPES } from "../../src/shared/semantic-tokens";

/** Default value is `****` (no \w chars) — TM header end lands on first column name (line 2). */
const SAMPLE_STAR_DEFAULT = [
    "2DA V1.0",
    "****",
    "                ResRef      Type",
    "Charm_Person    SPWI104     3",
    "Friends         SPWI107     3",
    "Sleep           SPWI116     3",
].join("\n");

/** Default value is `0` (\w char) — TM header end lands on line 1. Column names still line 2. */
const SAMPLE_WORD_DEFAULT = [
    "2DA V1.0",
    "0",
    "                ResRef      Type",
    "Charm_Person    SPWI104     3",
    "Friends         SPWI107     3",
].join("\n");

/** Header absent — file starts directly with column names. */
const SAMPLE_NO_HEADER = [
    "                ResRef      Type",
    "Charm_Person    SPWI104     3",
    "Friends         SPWI107     3",
].join("\n");

// Alias used in tests that don't depend on the default-value distinction
const SAMPLE = SAMPLE_STAR_DEFAULT;

describe("infinity-2da/semantic-tokens", () => {
    it("emits no spans for empty input", () => {
        expect(getSemanticTokenSpans("")).toEqual([]);
    });

    it("emits no semantic tokens for the signature line (TextMate handles it)", () => {
        const spans = getSemanticTokenSpans(SAMPLE_STAR_DEFAULT);
        expect(spans.some((s) => s.line === 0)).toBe(false);
    });

    it("emits no semantic tokens for the default-value line", () => {
        const spans = getSemanticTokenSpans(SAMPLE_STAR_DEFAULT);
        expect(spans.some((s) => s.line === 1)).toBe(false);
    });

    it("skips the header, default-value, and column-name lines (star default)", () => {
        const spans = getSemanticTokenSpans(SAMPLE_STAR_DEFAULT);
        // Lines 0-2 are signature/default/column-names — only lines 3+ should have spans.
        const lines = new Set(spans.map((s) => s.line));
        expect([...lines].every((l) => l >= 3)).toBe(true);
    });

    it("skips the header, default-value, and column-name lines (word default)", () => {
        const spans = getSemanticTokenSpans(SAMPLE_WORD_DEFAULT);
        // Lines 0-2 are signature/default/column-names — only lines 3+ should have spans.
        const lines = new Set(spans.map((s) => s.line));
        expect([...lines].every((l) => l >= 3)).toBe(true);
    });

    it("processes data rows correctly when header is absent", () => {
        const spans = getSemanticTokenSpans(SAMPLE_NO_HEADER);
        // Line 0 starts with whitespace = column names, skipped.
        // Lines 1-2 are data rows.
        const lines = new Set(spans.map((s) => s.line));
        expect([...lines].every((l) => l >= 1)).toBe(true);
        expect(spans.length).toBeGreaterThan(0);
    });

    it("skips the row label (first token on each data line)", () => {
        const spans = getSemanticTokenSpans(SAMPLE);
        const sampleLines = SAMPLE.split("\n");
        for (const span of spans) {
            const line = sampleLines[span.line] ?? "";
            const valueText = line.slice(span.startChar, span.startChar + span.length);
            // Row labels are "Charm_Person", "Friends", "Sleep" — none should appear as spans
            expect(["Charm_Person", "Friends", "Sleep"]).not.toContain(valueText);
        }
    });

    it("assigns column-cycling types to cells (same column = same type across all rows)", () => {
        const spans = getSemanticTokenSpans(SAMPLE);
        // Column 0 -> C0, column 1 -> C1, regardless of row
        const byLine = new Map<number, typeof spans>();
        for (const span of spans) {
            const list = byLine.get(span.line) ?? [];
            list.push(span);
            byLine.set(span.line, list);
        }

        const row0 = byLine.get(3) ?? [];
        expect(row0[0]?.tokenType).toBe(CELL_2DA_C0);
        expect(row0[1]?.tokenType).toBe(CELL_2DA_C1);

        const row1 = byLine.get(4) ?? [];
        // Same column indices → same types as row 0
        expect(row1[0]?.tokenType).toBe(CELL_2DA_C0);
        expect(row1[1]?.tokenType).toBe(CELL_2DA_C1);

        const row2 = byLine.get(5) ?? [];
        expect(row2[0]?.tokenType).toBe(CELL_2DA_C0);
        expect(row2[1]?.tokenType).toBe(CELL_2DA_C1);
    });

    it("cycles back to C0 after C5 for wide tables", () => {
        const wide = ["2DA V1.0", "****", "    A  B  C  D  E  F  G", "r1  1  2  3  4  5  6  7"].join("\n");
        const spans = getSemanticTokenSpans(wide);
        const types = spans.map((s) => s.tokenType);
        expect(types).toEqual([...CELL_2DA_COL_TYPES, CELL_2DA_C0]);
    });

    it("handles BOM-prefixed files correctly (signature still detected, no BOM token spans)", () => {
        const bom = "\uFEFF";
        const spans = getSemanticTokenSpans(bom + SAMPLE_STAR_DEFAULT);
        // Signature and default-value lines must still be skipped
        expect(spans.some((s) => s.line === 0)).toBe(false);
        expect(spans.some((s) => s.line === 1)).toBe(false);
        // Data rows must still produce cell spans
        expect(spans.some((s) => s.line >= 3)).toBe(true);
    });

    it("reports correct startChar and length for each cell", () => {
        const spans = getSemanticTokenSpans(SAMPLE);
        const sampleLines = SAMPLE.split("\n");
        for (const span of spans) {
            const line = sampleLines[span.line] ?? "";
            const text = line.slice(span.startChar, span.startChar + span.length);
            // Each span should cover a non-whitespace token
            expect(text.trim()).toBe(text);
            expect(text.length).toBeGreaterThan(0);
        }
    });
});
