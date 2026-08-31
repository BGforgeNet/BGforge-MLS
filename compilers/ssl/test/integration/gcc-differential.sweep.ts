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
 *
 * The spawns stay SYNCHRONOUS and the parallelism comes from sharding, not from a pool inside this file.
 * A file that runs its own pool is a second scheduler: it wants every core at the same moment vitest is
 * running a worker per other file, and the box then carries roughly twice the runnable threads it has
 * cores. Measured that way, the suite's total test time rose by half against the same work.
 */

import { execFileSync } from "node:child_process";
import * as path from "node:path";
import { describe, expect, it } from "vitest";
import { preprocess } from "../../src/preprocess.ts";
import { SPAWN_TIMEOUT_MS } from "../../../../shared/spawn-timeout.ts";
// The sfall headers both gcc and our preprocessor need are linked in by this project's globalSetup.
import { CORPUS_SIZE, RP_SCRIPTS, listScripts } from "./corpus.ts";
import { shardScripts } from "../../../../shared/cli/test/shard.ts";

function hasGcc(): boolean {
    try {
        execFileSync("gcc", ["--version"], { stdio: "ignore", timeout: SPAWN_TIMEOUT_MS });
        return true;
    } catch {
        return false;
    }
}

const TOKEN = /0[xX][0-9a-fA-F]+|\d+\.?\d*|[A-Za-z_]\w*|"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|[^\s]/g;

function tokenize(text: string): string[] {
    return text.match(TOKEN) ?? [];
}

export function registerGccShard(index: number, count: number): void {
    const scripts = listScripts();

    describe.skipIf(scripts.length === 0 || !hasGcc())(
        `preprocessor vs gcc over the RP corpus (${index}/${count})`,
        () => {
            it("matches gcc on every script", () => {
                const mine = shardScripts(scripts, index, count);
                const mismatches: string[] = [];
                const failures: string[] = [];
                let compared = 0;
                let gccSkipped = 0;

                for (const script of mine) {
                    let reference: string;
                    try {
                        reference = execFileSync(
                            "gcc",
                            ["-E", "-x", "c", "-P", "-Werror", "-Wfatal-errors", path.basename(script)],
                            {
                                cwd: path.dirname(script),
                                encoding: "latin1",
                                maxBuffer: 64 * 1024 * 1024,
                                timeout: SPAWN_TIMEOUT_MS,
                            },
                        );
                    } catch {
                        // gcc itself cannot build it (a dependency the corpus does not ship); no oracle
                        // either way.
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

                // A silent collapse in `compared` would let this pass while testing almost nothing, so
                // assert the denominator too - gcc skipping the whole corpus must fail rather than read as
                // a clean run. The corpus size is exact rather than a floor: a floor set below the real
                // count cannot tell a healthy corpus from one missing a couple of files (see corpus.ts).
                expect(scripts.length).toBe(CORPUS_SIZE);
                expect(mine.length).toBeGreaterThan(0);
                expect(failures, `preprocessor errors:\n${failures.slice(0, 10).join("\n")}`).toEqual([]);
                expect(mismatches, `token mismatches:\n${mismatches.slice(0, 10).join("\n")}`).toEqual([]);
                expect(gccSkipped).toBe(0);
                // Exact, where the corpus-wide version could only carry a floor: every script in the slice
                // reached the comparison, so one silently skipped shows up here.
                expect(compared).toBe(mine.length);
            });
        },
    );
}
