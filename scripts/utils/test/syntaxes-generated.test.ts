/**
 * Guards the two generated-file conventions AGENTS.md states for the data pipeline, which
 * nothing else checks: a `syntaxes/*.tmLanguage.yml` edit committed without rerunning
 * `scripts/syntaxes-to-json.sh` passes every gate, and so does a hand-edited
 * `server/data/*.yml` left in an order the repo's sorter would change.
 *
 * The JSON half regenerates into a temp dir and compares; the sorter half runs in memory,
 * so neither writes into the tree. Generator-owned data files carry the auto-generated
 * marker and are skipped: their format is their generator's, not the sorter's.
 */

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { sortYamlStanzasAndItems } from "../src/sort-yaml-stanzas-and-items.ts";

const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");
const SYNTAXES_DIR = path.join(REPO_ROOT, "syntaxes");
const DATA_DIR = path.join(REPO_ROOT, "server", "data");

/** One `pnpm exec tsx` per grammar, run in parallel by the script; well past the suite default. */
const REGENERATE_TIMEOUT_MS = 300_000;

const GENERATED_MARKER = /^#\s*Auto-generated\b.*\bDo not hand-edit\b/;

/** Hand-maintained data files the sorter's output form does not describe. */
const UNSORTED = new Map<string, string>([
    [
        "fallout-worldmap-txt.yml",
        "committed in a different stanza and item order; moving it to the sorter's form would reorder the highlight patterns generated from it",
    ],
]);

function ymlFiles(dir: string): string[] {
    return fs
        .readdirSync(dir)
        .filter((name) => name.endsWith(".yml"))
        .sort();
}

describe("syntaxes/*.tmLanguage.json is what the generator produces", () => {
    it(
        "matches a fresh run of syntaxes-to-json.sh",
        () => {
            const outDir = fs.mkdtempSync(path.join(os.tmpdir(), "syntaxes-json-"));
            try {
                execFileSync(path.join(REPO_ROOT, "scripts", "syntaxes-to-json.sh"), [outDir], {
                    cwd: REPO_ROOT,
                    timeout: REGENERATE_TIMEOUT_MS,
                    stdio: "pipe",
                });
                const sources = ymlFiles(SYNTAXES_DIR);
                expect(sources.length).toBeGreaterThan(0);

                const stale = sources.filter((name) => {
                    const json = name.replace(/\.yml$/, ".json");
                    const fresh = fs.readFileSync(path.join(outDir, json), "utf8");
                    return fresh !== fs.readFileSync(path.join(SYNTAXES_DIR, json), "utf8");
                });
                expect(stale).toEqual([]);
            } finally {
                fs.rmSync(outDir, { recursive: true, force: true });
            }
        },
        REGENERATE_TIMEOUT_MS,
    );
});

describe("hand-maintained server/data YAML is sorted", () => {
    const handMaintained = ymlFiles(DATA_DIR).filter(
        (name) =>
            !GENERATED_MARKER.test(fs.readFileSync(path.join(DATA_DIR, name), "utf8").split("\n", 1)[0] ?? "") &&
            !UNSORTED.has(name),
    );

    it("finds files to check", () => {
        expect(handMaintained.length).toBeGreaterThan(0);
    });

    it.each(handMaintained)("%s is in the sorter's output form", (name) => {
        const source = fs.readFileSync(path.join(DATA_DIR, name), "utf8");
        expect(sortYamlStanzasAndItems(source)).toBe(source);
    });

    it("exempts only files that still exist", () => {
        const stale = [...UNSORTED.keys()].filter((name) => !fs.existsSync(path.join(DATA_DIR, name)));
        expect(stale).toEqual([]);
    });
});
