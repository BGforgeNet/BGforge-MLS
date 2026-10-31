/**
 * Guards the tracked `shared/syntax-types/*.ts` against a stale commit: they are generated from each grammar's
 * `src/node-types.json` and `src/grammar.json` (gitignored build outputs of `pnpm build:grammar`), and a grammar
 * edit committed without regenerating them passes every other gate that does not rebuild the grammars.
 *
 * Each grammar is regenerated into a temp dir with the pipeline `scripts/build-grammar.sh` runs
 * (dts-tree-sitter | sed | split-syntax-type.mjs) and compared with the tracked file; nothing is written into the
 * tree. A grammar whose build outputs are absent is reported by a named placeholder test, not silently passed.
 */

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

const REPO_ROOT = path.resolve(import.meta.dirname, "..", "..", "..");
const SYNTAX_TYPES_DIR = path.join(REPO_ROOT, "shared", "syntax-types");
const SPLIT_SCRIPT = path.join(REPO_ROOT, "scripts", "split-syntax-type.mjs");

/** The grammars whose SyntaxType enum is tracked (the LSP grammars of scripts/build-grammar.sh). */
const GRAMMARS = ["fallout-ssl", "weidu-baf", "weidu-d", "weidu-tp2"];

const REGENERATE_TIMEOUT_MS = 60_000;

/** The same pipeline as build-grammar.sh, run in a dir whose `src/` holds the grammar's JSON inputs. */
const PIPELINE =
    "\"$1\" . | sed 's/export const enum /export enum /' > src/tree-sitter.d.ts" +
    ' && node "$2" src/tree-sitter.d.ts src/syntax-type.ts';

function missingInputs(grammar: string): string[] {
    const dir = path.join(REPO_ROOT, "grammars", grammar);
    return [
        path.join(dir, "src", "node-types.json"),
        path.join(dir, "src", "grammar.json"),
        path.join(dir, "node_modules", ".bin", "dts-tree-sitter"),
    ].filter((file) => !fs.existsSync(file));
}

function regenerate(grammar: string): string {
    const dir = path.join(REPO_ROOT, "grammars", grammar);
    const workDir = fs.mkdtempSync(path.join(os.tmpdir(), `syntax-type-${grammar}-`));
    try {
        fs.mkdirSync(path.join(workDir, "src"));
        for (const name of ["node-types.json", "grammar.json"]) {
            fs.copyFileSync(path.join(dir, "src", name), path.join(workDir, "src", name));
        }
        const dtsBin = path.join(dir, "node_modules", ".bin", "dts-tree-sitter");
        execFileSync("sh", ["-c", PIPELINE, "sh", dtsBin, SPLIT_SCRIPT], {
            cwd: workDir,
            timeout: REGENERATE_TIMEOUT_MS,
            stdio: "pipe",
        });
        return fs.readFileSync(path.join(workDir, "src", "syntax-type.ts"), "utf8");
    } finally {
        fs.rmSync(workDir, { recursive: true, force: true });
    }
}

describe("shared/syntax-types/*.ts is what the generator produces", () => {
    for (const grammar of GRAMMARS) {
        const missing = missingInputs(grammar);
        if (missing.length > 0) {
            const absent = missing.map((file) => path.relative(REPO_ROOT, file)).join(", ");
            it.skip(`${grammar}: SKIPPED, run pnpm build:grammar first (missing ${absent})`, () => {});
            continue;
        }
        it(
            `${grammar} matches a fresh run of the type-generation pipeline`,
            () => {
                const tracked = fs.readFileSync(path.join(SYNTAX_TYPES_DIR, `${grammar}.ts`), "utf8");
                expect(regenerate(grammar)).toBe(tracked);
            },
            REGENERATE_TIMEOUT_MS,
        );
    }
});
