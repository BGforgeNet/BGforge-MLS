/**
 * Unit tests for infinity-2da/format.ts - column-aligned 2DA formatter.
 */

import { describe, expect, it } from "vitest";
import { format2da } from "@bgforge/format";

function fmt(text: string): string {
    const result = format2da(text);
    expect(result.warning).toBeUndefined();
    expect(result.text).not.toBe(text);
    return result.text;
}

const NBSP = String.fromCodePoint(0xa0);
const BOM = String.fromCodePoint(0xfeff);

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

    it("keeps a data row that starts with whitespace in an empty row-name column", () => {
        // GemRB reads the row name up to the first space, so this row's name is empty and `p` is its first cell.
        const input = lines("2DA V1.0", "0", "   A B", "r1 x y", "  p q");
        expect(fmt(input)).toBe(lines("2DA V1.0", "0", "      A    B", "r1    x    y", "      p    q"));
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

    it("keeps the cells past the last column as written", () => {
        // GemRB splits a row into at most as many cells as there are columns; the last takes the rest of the line.
        const input = lines("2DA V1.0", "0", "   A B", "r1 x y   z  w");
        expect(fmt(input)).toBe(lines("2DA V1.0", "0", "      A    B", "r1    x    y   z  w"));
    });

    it("gives a one-column table two cells per row before the rest is kept as written", () => {
        const input = lines("2DA V1.0", "0", "   A", "r x y  z");
        expect(fmt(input)).toBe(lines("2DA V1.0", "0", "     A", "r    x    y  z"));
    });

    it("keeps a blank third line, which leaves GemRB's table with no columns", () => {
        // The column names are the third line by position; with none, rows split into any number of cells.
        const input = lines("2DA V1.0", "0", "", "   A B", "r1 x  y   z");
        expect(fmt(input)).toBe(lines("2DA V1.0", "0", "", "      A    B", "r1    x    y    z"));
    });

    it("separates cells only on spaces and tabs", () => {
        // GemRB and WeiDU read a no-break space as cell text, at the end of a line too.
        const input = lines("2DA V1.0", "0", "   A B", `r1 x${NBSP}y z${NBSP}`);
        expect(fmt(input)).toBe(lines("2DA V1.0", "0", "      A      B", `r1    x${NBSP}y    z${NBSP}`));
    });

    it("ends a line at a lone carriage return", () => {
        const input = "2DA V1.0\r0\r   A\rr x\r";
        expect(fmt(input)).toBe(lines("2DA V1.0", "0", "     A", "r    x"));
    });

    it("keeps blank lines above the third line in a file without a signature", () => {
        const input = lines("//a", "//b", "", "x y", "z w");
        expect(fmt(input)).toBe(lines("//a", "//b", "", "x      y", "z      w"));
    });

    it("leaves an encrypted file unchanged", () => {
        // A 2DA whose first two bytes are 0xFF is encrypted; read as Latin-1 or as UTF-8, it is not text to align.
        for (const marker of [0xff, 0xfffd]) {
            const lead = String.fromCodePoint(marker, marker);
            const input = `${lead}a b\nc  d\n`;
            expect(format2da(input)).toEqual({ text: input, warning: "2DA formatter: encrypted file, skipping" });
        }
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
        const input = `${BOM}2DA V1.0\n****\n   Col1\nrow1 val1\n`;
        const result = format2da(input);
        expect(result.warning).toBeUndefined();
        expect(result.text).not.toBe(input);
        expect(result.text.startsWith(BOM)).toBe(false);
    });
});
