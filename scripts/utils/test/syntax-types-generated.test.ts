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
        // The same steps as build-grammar.sh's pipeline (dts-tree-sitter | sed | split-syntax-type.mjs), run one
        // process at a time with no shell between them: the paths come from this file's location, and a shell
        // command built from them is what a code scanner reads as an injection path.
        const dtsBin = path.join(dir, "node_modules", ".bin", "dts-tree-sitter");
        const spawnOptions = { cwd: workDir, timeout: REGENERATE_TIMEOUT_MS, stdio: "pipe" } as const;
        const generated = execFileSync(dtsBin, ["."], { ...spawnOptions, encoding: "utf8" });
        // sed's `s/export const enum /export enum /`: the first occurrence on each line.
        const dts = generated
            .split("\n")
            .map((line) => line.replace("export const enum ", "export enum "))
            .join("\n");
        fs.writeFileSync(path.join(workDir, "src", "tree-sitter.d.ts"), dts);
        execFileSync(process.execPath, [SPLIT_SCRIPT, "src/tree-sitter.d.ts", "src/syntax-type.ts"], spawnOptions);
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
