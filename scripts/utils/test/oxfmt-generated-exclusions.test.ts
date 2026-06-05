/**
 * Drift guard for oxfmt's generated-file exclusions.
 *
 * Generated sources carry an "Auto-generated ... Do not hand-edit" marker on
 * their first line. Such files must be excluded from oxfmt (via .oxfmtrc.json
 * ignorePatterns) so their canonical format stays the generator output rather
 * than being reformatted by oxfmt. The exclusion list is hand-maintained, so
 * this test keeps it honest against the marker - the single source of truth -
 * instead of duplicating the list:
 *
 *   forward: every marked file is listed in ignorePatterns (a new generated
 *            artifact left un-excluded fails here);
 *   reverse: every exact binary/src/*.ts ignore entry points at a file that
 *            still exists and still carries the marker (a stale entry after a
 *            rename or deletion fails here).
 *
 * Matching only the first line avoids false positives from the emitter that
 * writes the marker, from tests, and from docs that merely mention the phrase.
 */

import { execSync } from "node:child_process";
import fs from "node:fs";
import { describe, expect, it } from "vitest";

const ignorePatterns: readonly string[] = JSON.parse(fs.readFileSync(".oxfmtrc.json", "utf8")).ignorePatterns ?? [];

// "// " for TS/JS, "# " for YAML - whichever comment leader the generator emits.
const MARKER = /^(?:\/\/|#)\s*Auto-generated\b.*\bDo not hand-edit\b/;

function firstLine(file: string): string {
    return fs.readFileSync(file, "utf8").split("\n", 1)[0] ?? "";
}

const generated = execSync("git ls-files -- '*.ts' '*.yml' '*.yaml' '*.json'", { encoding: "utf8" })
    .split("\n")
    .filter(Boolean)
    .filter((file) => MARKER.test(firstLine(file)));

const binarySpecEntries = ignorePatterns.filter(
    (p) => p.startsWith("binary/src/") && p.endsWith(".ts") && !p.includes("*"),
);

describe("oxfmt excludes every generated artifact", () => {
    it("discovers generated (marked) files", () => {
        expect(generated.length).toBeGreaterThan(0);
    });

    it.each(generated)("%s is listed in .oxfmtrc.json ignorePatterns", (file) => {
        expect(ignorePatterns).toContain(file);
    });

    it.each(binarySpecEntries)("ignore entry %s is a real, still-generated file", (entry) => {
        expect(fs.existsSync(entry)).toBe(true);
        expect(MARKER.test(firstLine(entry))).toBe(true);
    });
});
