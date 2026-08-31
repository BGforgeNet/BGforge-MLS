/**
 * The optimised twin of the compile differential: same corpus, same committed oracles, checked at both
 * `-O1` and `-O2`.
 *
 * This is the only gate that can hold the optimiser honest. Its passes REMOVE things, so nothing about
 * the unoptimised output constrains them, and a wrong removal produces a script that loads fine and then
 * misbehaves in-game - no exception, no diagnostic, nothing a unit test on hand-written IR would notice.
 * Byte-equality across 1500 real scripts is what turns "the removals look right" into a checked claim.
 * The oracles are committed digests of the bundled compiler's output (oracle-manifest.ts explains why
 * that is sound and how staleness fails loud; `pnpm ssl-oracles` regenerates them live).
 *
 * Reading a failure: the two sides agree on WHAT is dead, so a mismatch is nearly always a stale
 * reference to something removed - a procedure slot or global index that was not renumbered, or a string
 * literal left interned by code that no longer exists, which shifts every later string offset.
 *
 * Sharded by SCRIPT, not by level. Splitting by level was the older shape and put both levels in one
 * file, which ran them back to back on one core AND preprocessed every script twice for a result that
 * cannot differ between levels - 12.3s of the file's 82.1s spent recomputing text it already had. One
 * pass per script feeding both levels removes that, and slicing by script is what lets the pool spread
 * what remains.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { Language, Parser } from "web-tree-sitter";
import { compileText } from "../../src/compile.ts";
import { preprocess } from "../../src/preprocess.ts";
import { REPO_ROOT } from "../../../../shared/cli/test/repo-root.ts";
import { BROKEN_WHEN_OPTIMISED, CORPUS_SIZE, corpusKey, listScripts } from "./corpus.ts";
import { currentPins, loadManifest, sha256, staleness } from "./oracle-manifest.ts";
import { builtArtifactsPresent } from "../../../../shared/cli/test/built-artifacts.ts";
import { shardScripts } from "../../../../shared/cli/test/shard.ts";

const WASM_DIR = path.join(REPO_ROOT, "server/out");

const LEVELS = [1, 2] as const;
type Level = (typeof LEVELS)[number];

interface LevelResult {
    matching: number;
    differing: number;
    unlisted: number;
    readonly excludedStems: string[];
    readonly differences: string[];
    readonly failures: Map<string, number>;
}

const emptyResult = (): LevelResult => ({
    matching: 0,
    differing: 0,
    unlisted: 0,
    excludedStems: [],
    differences: [],
    failures: new Map(),
});

/** Groups a front-end error by message shape, so a report names the gaps rather than 1500 scripts. */
function reason(error: unknown): string {
    const message = (error as Error).message.replace(/^\d+:\d+: /, "");
    return message.startsWith("unknown ") ? message.replaceAll(/'[^']*'/g, "'X'") : message;
}

export function registerOptimizeShard(index: number, count: number): void {
    const scripts = listScripts();
    const manifest = loadManifest();
    const wasmPresent = builtArtifactsPresent([path.join(WASM_DIR, "tree-sitter-ssl.wasm")], "pnpm build:grammar");
    // The manifest is COMMITTED, so its absence is a deletion to report, not a reason to skip - only a
    // corpus that was never fetched or an unbuilt grammar makes this suite meaningless.
    const ready = wasmPresent && scripts.length > 0;

    describe.skipIf(!ready)(`the real corpus optimises to matching bytecode (${index}/${count})`, () => {
        const mine = shardScripts(scripts, index, count);
        const results = new Map<Level, LevelResult>(LEVELS.map((level) => [level, emptyResult()]));

        beforeAll(async () => {
            await Parser.init({ wasmBinary: fs.readFileSync(path.join(WASM_DIR, "web-tree-sitter.wasm")) });
            const parser = new Parser();
            parser.setLanguage(await Language.load(path.join(WASM_DIR, "tree-sitter-ssl.wasm")));
            const oracles = manifest;
            if (oracles === null) return;

            for (const script of mine) {
                const key = corpusKey(script);
                // One preprocess feeds both levels: the preprocessor does not see the optimiser, so the
                // text is identical and computing it per level was pure duplication.
                let text: string;
                try {
                    text = preprocess(script);
                } catch (error) {
                    // Charged to BOTH levels: the preprocessor runs once now, but the failure is one each
                    // level would have hit on its own, and the per-level error counts are what the
                    // assertions read.
                    const why = reason(error);
                    for (const level of LEVELS) {
                        const at = results.get(level)!;
                        at.failures.set(why, (at.failures.get(why) ?? 0) + 1);
                    }
                    continue;
                }

                for (const level of LEVELS) {
                    const at = results.get(level)!;
                    const digest = oracles.entries.get(key)?.[level];
                    if (digest === undefined) {
                        // A script the manifest has never seen means the corpus and manifest disagree
                        // about the population itself - regeneration territory, counted not skipped.
                        at.unlisted++;
                        continue;
                    }
                    if (digest === "refused") {
                        at.excludedStems.push(path.basename(script, path.extname(script)));
                        continue;
                    }
                    let actual: Uint8Array;
                    try {
                        actual = compileText(parser, text, { level });
                    } catch (error) {
                        at.failures.set(reason(error), (at.failures.get(reason(error)) ?? 0) + 1);
                        continue;
                    }
                    if (sha256(actual) === digest) at.matching++;
                    else {
                        at.differing++;
                        // Named, because at this scale "37 differ" is not something anyone can act on.
                        if (at.differences.length < 10) at.differences.push(`${key} (ours ${actual.length}b)`);
                    }
                }
            }
        });

        it("was generated against the pins as they stand", () => {
            // First, so a red run after a compiler or corpus bump reads as "regenerate", never as an
            // optimiser defect (see the same assertion in compile-corpus.sweep.ts).
            const pins = currentPins();
            expect(manifest, "committed oracle manifest is missing - run: pnpm ssl-oracles").not.toBeNull();
            expect(staleness(manifest as NonNullable<typeof manifest>, pins.compilerPin, pins.corpusPins)).toEqual([]);
        });

        it.each(LEVELS)("matches the oracles at -O%d", (level) => {
            const at = results.get(level)!;
            const expectedExcluded = mine
                .map((script) => path.basename(script, path.extname(script)))
                .filter((stem) => BROKEN_WHEN_OPTIMISED.includes(stem))
                .toSorted();
            const report = [...at.failures.entries()]
                .sort((a, b) => b[1] - a[1])
                .slice(0, 12)
                .map(([why, n]) => `  ${String(n).padStart(5)}  ${why}`)
                .join("\n");
            const errors = [...at.failures.values()].reduce((a, b) => a + b, 0);
            const summary = [
                `corpus ${scripts.length}, shard ${index}/${count} of ${mine.length}, ` +
                    `oracles ${at.matching + at.differing}, matching ${at.matching}, differing ${at.differing}, ` +
                    `errors ${errors}, unlisted ${at.unlisted}`,
                `oracle refusals ${at.excludedStems.length}: ${at.excludedStems.join(", ") || "none"}`,
                `first differences: ${at.differences.join(", ") || "none"}`,
                report,
            ].join("\n");

            // The whole corpus, from inside a shard: a slice of a corpus that shrank mid-checkout is a
            // slice of the wrong population, and every count below would still look plausible.
            expect(scripts.length, summary).toBe(CORPUS_SIZE);
            expect(mine.length, summary).toBeGreaterThan(0);
            expect(at.unlisted, summary).toBe(0);
            // Exact, where the corpus-wide version could only carry a floor: every script in the slice is
            // either compared or a pinned refusal, so a silently skipped one shows up here rather than
            // shrinking a comparison whose other numbers all stay plausible.
            expect(at.matching + at.differing + errors, summary).toBe(mine.length - at.excludedStems.length);
            expect(at.excludedStems.toSorted(), summary).toEqual(expectedExcluded);
            expect(at.differing, summary).toBe(0);
            expect(errors, summary).toBe(0);
        });
    });
}
