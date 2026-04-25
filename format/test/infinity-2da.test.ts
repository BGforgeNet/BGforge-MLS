/**
 * Unit tests for infinity-2da/format.ts — column-aligned 2DA formatter.
 */

import { describe, expect, it } from "vitest";
import { format2da } from "@bgforge/format";

function fmt(text: string): string {
    const result = format2da(text);
    expect(result.warning).toBeUndefined();
    expect(result.text).not.toBe(text);
    return result.text;
}

/** Shorthand: join lines with newline and add trailing newline. */
function lines(...ls: string[]): string {
    return ls.join("\n") + "\n";
}

describe("infinity-2da/format", () => {
    it("aligns column names and data under the same column positions", () => {
        const input = lines("2DA V1.0", "****", "   ResRef  Type", "Charm_Person SPWI104 3", "Friends SPWI107 3");
        const out = fmt(input);
        const outLines = out.split("\n");
        // Column names line must start with whitespace equal to label-col width + 2
        expect(outLines[2]).toMatch(/^\s+ResRef/);
        // "ResRef" in header must start at same character position as "SPWI104" in first data row
        const headerColStart = (outLines[2] ?? "").indexOf("ResRef");
        const dataColStart = (outLines[3] ?? "").indexOf("SPWI104");
        expect(headerColStart).toBe(dataColStart);
    });

    it("separates columns by at least 4 spaces", () => {
        const input = lines("2DA V1.0", "****", "   A B", "r1 x y");
        const out = fmt(input);
        // Only data and column-name lines get column formatting; skip signature/default lines.
        const dataLines = out
            .split("\n")
            .slice(2)
            .filter((l) => l.length > 0);
        for (const line of dataLines) {
            // No fewer than 4 spaces between adjacent columns
            expect(line).not.toMatch(/\S {1,3}\S/);
        }
    });

    it("strips leading whitespace from data rows (only the column-names row may start with whitespace)", () => {
        const input = lines(
            "2DA V1.0",
            "****",
            "   Col1",
            "  bad_row val1", // accidental leading whitespace
        );
        const out = fmt(input);
        const dataLine = out.split("\n")[3] ?? "";
        expect(dataLine).toMatch(/^bad_row/);
    });

    it("trims trailing whitespace from every line", () => {
        const input = lines("2DA V1.0   ", "****   ", "   Col1   Col2   ", "row1   val1   val2   ");
        const out = fmt(input);
        for (const line of out.split("\n")) {
            expect(line).toBe(line.trimEnd());
        }
    });

    it("normalizes signature to single-space tokens regardless of spaces or tabs", () => {
        for (const sep of ["    ", "\t", "  \t  "]) {
            const input = lines(`2DA${sep}V1.0`, "****", "   Col1", "row1 val1");
            const outLines = fmt(input).split("\n");
            expect(outLines[0]).toBe("2DA V1.0");
        }
    });

    it("preserves trailing newline when original has one", () => {
        const input = "2DA V1.0\n****\n   Col1\nrow1 val1\n";
        expect(fmt(input)).toMatch(/\n$/);
    });

    it("adds trailing newline when original lacks one", () => {
        const input = "2DA V1.0\n****\n   Col1\nrow1 val1";
        expect(fmt(input)).toMatch(/\n$/);
    });

    it("works without a signature (header-absent files)", () => {
        const input = lines("   Col1  Col2", "r1 a b", "r2 cc d");
        const out = fmt(input);
        const outLines = out.split("\n");
        // First line is column names (starts with whitespace)
        expect(outLines[0]).toMatch(/^\s/);
        // Data rows aligned under column names
        const headerStart = (outLines[0] ?? "").indexOf("Col1");
        const dataStart = (outLines[1] ?? "").indexOf("a");
        expect(headerStart).toBe(dataStart);
    });

    it("handles rows with more values than column names", () => {
        const input = lines("2DA V1.0", "0", "   A", "r1 v1 extra");
        // Should not throw; extra value is kept
        const out = fmt(input);
        expect(out).toContain("extra");
    });

    it("is a no-op for empty/minimal files", () => {
        expect(format2da("").text).toBe("");
        expect(format2da("2DA V1.0\n****\n").text).toBe("2DA V1.0\n****\n");
    });

    it("normalizes signature in header-only files (tab or extra spaces, no data rows)", () => {
        const result = format2da("2DA\tV1.0\n0\n");
        expect(result.warning).toBeUndefined();
        expect(result.text).not.toBe("2DA\tV1.0\n0\n");
        expect(result.text).toBe("2DA V1.0\n0\n");
    });

    it("strips leading BOM from the output", () => {
        const input = "\uFEFF2DA V1.0\n****\n   Col1\nrow1 val1\n";
        const result = format2da(input);
        expect(result.warning).toBeUndefined();
        expect(result.text).not.toBe(input);
        expect(result.text.startsWith("\uFEFF")).toBe(false);
    });
});
