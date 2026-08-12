/**
 * Differential test: our preprocessor against `gcc -E -x c -P` over the real Fallout SSL corpus.
 *
 * This is the oracle the SSL front end is built on. SSL is preprocessed by an ordinary C preprocessor
 * before compilation - the Restoration Project's own build does exactly this gcc invocation - so gcc is a
 * legitimate reference rather than an approximation of one.
 *
 * Comparison is on the normalised token stream, not bytes: gcc reflows whitespace and drops blank lines, so
 * a byte diff fails on formatting where the token streams agree, and the token stream is what the compiler
 * consumes.
 *
 * Known blind spot, worth stating because it has already cost one bug: the sweep covers the Restoration
 * Project only, so a construct RP never uses is not exercised here at all. `#pragma` is the example - all
 * five real uses live in sfall's own artifacts, so a pass of this suite said nothing about pragma handling
 * while it was being silently dropped. Unit tests carry the constructs RP lacks; do not read a green sweep
 * as coverage of the language.
 */

import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { describe, expect, it } from "vitest";
import { preprocess } from "../../src/preprocess.ts";
import { REPO_ROOT } from "../../../shared/cli/test/repo-root.ts";

// The sfall headers both gcc and our preprocessor need are linked in by this project's globalSetup.
const RP_SCRIPTS = path.join(REPO_ROOT, "external/fallout/Fallout2_Restoration_Project/scripts_src");

function hasGcc(): boolean {
    try {
        execFileSync("gcc", ["--version"], { stdio: "ignore" });
        return true;
    } catch {
        return false;
    }
}

function listScripts(): string[] {
    if (!fs.existsSync(RP_SCRIPTS)) return [];
    const out: string[] = [];
    for (const entry of fs.readdirSync(RP_SCRIPTS)) {
        if (entry === "template" || entry === "sfall") continue;
        const dir = path.join(RP_SCRIPTS, entry);
        if (!fs.statSync(dir).isDirectory()) continue;
        for (const file of fs.readdirSync(dir)) {
            if (file.toLowerCase().endsWith(".ssl")) out.push(path.join(dir, file));
        }
    }
    return out.sort();
}

const TOKEN = /0[xX][0-9a-fA-F]+|\d+\.?\d*|[A-Za-z_]\w*|"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|[^\s]/g;

function tokenize(text: string): string[] {
    return text.match(TOKEN) ?? [];
}

const scripts = listScripts();
const gccAvailable = hasGcc();

describe.skipIf(scripts.length === 0 || !gccAvailable)("preprocessor vs gcc over the RP corpus", () => {
    it("matches gcc on every script", () => {
        const mismatches: string[] = [];
        const failures: string[] = [];
        let compared = 0;
        let gccSkipped = 0;

        for (const script of scripts) {
            let reference: string;
            try {
                reference = execFileSync(
                    "gcc",
                    ["-E", "-x", "c", "-P", "-Werror", "-Wfatal-errors", path.basename(script)],
                    { cwd: path.dirname(script), encoding: "latin1", maxBuffer: 64 * 1024 * 1024 },
                );
            } catch {
                // gcc itself cannot build it (a dependency the corpus does not ship); no oracle either way.
                gccSkipped++;
                continue;
            }

            const relative = path.relative(RP_SCRIPTS, script);
            let ours: string;
            try {
                ours = preprocess(script);
            } catch (error) {
                failures.push(`${relative}: ${(error as Error).message}`);
                continue;
            }

            compared++;
            const a = tokenize(ours);
            const b = tokenize(reference);
            if (a.length !== b.length || a.some((t, i) => t !== b[i])) {
                const at = a.findIndex((t, i) => t !== b[i]);
                mismatches.push(`${relative}: first divergence at token ${at === -1 ? a.length : at}`);
            }
        }

        // A silent collapse in `compared` would let this pass while testing almost nothing, so assert the
        // denominator too - gcc skipping the whole corpus must fail rather than read as a clean run.
        expect(failures, `preprocessor errors:\n${failures.slice(0, 10).join("\n")}`).toEqual([]);
        expect(mismatches, `token mismatches:\n${mismatches.slice(0, 10).join("\n")}`).toEqual([]);
        expect(gccSkipped).toBe(0);
        expect(compared).toBeGreaterThan(1500);
    });
});
