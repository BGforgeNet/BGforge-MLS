/**
 * Drift guard for the two feature matrices (README.md and server/INTERNALS.md).
 *
 * The matrix exists in two deliberately different shapes - README is user-facing
 * (features as rows, checkmarks, four languages), INTERNALS is implementer-facing
 * (providers as rows, Y/n-a/blank, extra providers and columns). Both must be
 * updated when a user-visible feature ships (docs/architecture.md, "Two Feature
 * Matrices"), and nothing enforced that until this test: for every feature and
 * language BOTH tables carry, the supported/unsupported verdicts must agree.
 *
 * Rows/columns only one table carries (README "Extensions"/"Dialog editor",
 * INTERNALS "Selection Range" and the internals-only providers) are out of the
 * shared surface and deliberately not compared.
 */

import fs from "node:fs";
import { describe, expect, it } from "vitest";

/** Parse a GFM table into rows of trimmed cells, given the line index of its header row. */
function parseTable(lines: readonly string[], headerIndex: number): string[][] {
    const rows: string[][] = [];
    for (let i = headerIndex; i < lines.length; i++) {
        const line = lines[i] ?? "";
        if (!line.trimStart().startsWith("|")) {
            break;
        }
        if (/^\s*\|[\s:|-]+\|\s*$/.test(line)) {
            continue; // delimiter row
        }
        rows.push(
            line
                .split("|")
                .slice(1, -1)
                .map((c) => c.replaceAll("`", "").trim()),
        );
    }
    return rows;
}

function tableAfterHeading(file: string, heading: string): string[][] {
    const lines = fs.readFileSync(file, "utf8").split("\n");
    const start = lines.findIndex((l) => l.trim() === heading);
    expect(start, `heading "${heading}" in ${file}`).toBeGreaterThanOrEqual(0);
    const headerIndex = lines.findIndex((l, i) => i > start && l.trimStart().startsWith("|"));
    expect(headerIndex, `table after "${heading}" in ${file}`).toBeGreaterThan(start);
    return parseTable(lines, headerIndex);
}

// README: features as rows, languages as columns.
const readmeTable = tableAfterHeading("README.md", "## Languages");
// INTERNALS: providers as rows, features as columns.
const internalsTable = tableAfterHeading("server/INTERNALS.md", "## Feature Matrix");

const LANG_TO_PROVIDER: Record<string, string> = {
    "Fallout SSL": "fallout-ssl",
    "WeiDU BAF/SSL": "weidu-baf",
    "WeiDU D": "weidu-d",
    "WeiDU TP2": "weidu-tp2",
};

// README feature-row label -> INTERNALS column label, for the shared surface.
const FEATURE_TO_COLUMN: Record<string, string> = {
    Completion: "Completion",
    Hover: "Hover",
    "Signature help": "Signature",
    "Go to definition": "Definition",
    "Find references": "References",
    Formatting: "Format",
    "Document symbols": "Symbols",
    "Workspace symbols": "Workspace Symbols",
    "Semantic tokens": "Semantic Tokens",
    Rename: "Rename",
    "Inlay hints": "Inlay",
    Diagnostics: "Diagnostics",
    JSDoc: "JSDoc",
    Folding: "Folding",
};

// A README cell supports the feature when non-empty (a checkmark, "Same file", ".msg").
// An INTERNALS cell supports it when non-empty and not "n/a".
const readmeSupported = (cell: string): boolean => cell !== "";
const internalsSupported = (cell: string): boolean => cell !== "" && cell.toLowerCase() !== "n/a";

const readmeHeader = readmeTable[0] ?? [];
const internalsHeader = internalsTable[0] ?? [];

const cases = Object.entries(FEATURE_TO_COLUMN).flatMap(([feature, column]) =>
    Object.entries(LANG_TO_PROVIDER).map(([lang, provider]) => ({ feature, column, lang, provider })),
);

describe("README and INTERNALS feature matrices agree on the shared surface", () => {
    it("finds every shared language column and feature row in README", () => {
        for (const lang of Object.keys(LANG_TO_PROVIDER)) {
            expect(readmeHeader).toContain(lang);
        }
        for (const feature of Object.keys(FEATURE_TO_COLUMN)) {
            expect(readmeTable.map((r) => r[0])).toContain(feature);
        }
    });

    it("finds every shared provider row and feature column in INTERNALS", () => {
        for (const provider of Object.values(LANG_TO_PROVIDER)) {
            expect(internalsTable.map((r) => r[0])).toContain(provider);
        }
        for (const column of Object.values(FEATURE_TO_COLUMN)) {
            expect(internalsHeader).toContain(column);
        }
    });

    it.each(cases)("$feature / $lang matches provider $provider", ({ feature, column, lang, provider }) => {
        const readmeRow = readmeTable.find((r) => r[0] === feature);
        const internalsRow = internalsTable.find((r) => r[0] === provider);
        const readmeCell = readmeRow?.[readmeHeader.indexOf(lang)] ?? "";
        const internalsCell = internalsRow?.[internalsHeader.indexOf(column)] ?? "";
        expect(
            readmeSupported(readmeCell),
            `README "${feature}"/"${lang}" (${JSON.stringify(readmeCell)}) vs ` +
                `INTERNALS "${provider}"/"${column}" (${JSON.stringify(internalsCell)})`,
        ).toBe(internalsSupported(internalsCell));
    });
});
