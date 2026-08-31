/**
 * The decompile sweep's work, split from the assertions so it can run over a slice of the corpus.
 *
 * Three gates, measuring different things:
 *
 *   1. RE-EMIT. Compile a script, decompile the output, emit the recovered tree, compare bytes. This is
 *      exact and admits no interpretation - the emitter is the oracle, and every script must pass.
 *   2. REPRINT. Do the same but go out through the source printer and back in through the front end.
 *      This is a weaker property on purpose: printing produces different TEXT from the original, and a
 *      string constant's position in the string table follows the order the source mentions it - which
 *      the printer cannot control, since no spelling of an expression says where its literals go. That
 *      shifts bytes without changing what the script does, so this gate admits a pinned set of misses.
 *   3. RESAVE. Reprint, but seed the emitter with the string order the original file used, which is
 *      what saving an edited script does - the file being written over is right there to read it from.
 *      That removes the one text-sensitivity above, so this gate demands EVERY script and is the one
 *      the editor's "save a script you have not edited and get the same bytes" promise rests on.
 *
 * No gate needs the reference compiler, so all three run wherever the corpus is checked out.
 *
 * All three are measured in one pass: compiling the corpus dominates the runtime, and doing it once per
 * property would triple a minutes-long suite to prove the same scripts three times.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { Language, Parser } from "web-tree-sitter";
import { REPO_ROOT } from "../../../../shared/cli/test/repo-root.ts";
import { BROKEN_STEMS, CORPUS_SIZE, corpusKey, listScripts } from "./corpus.ts";
import { shardScripts } from "../../../../shared/cli/test/shard.ts";
import { buildProgram, compileText, emitProgram } from "../../src/compile.ts";
import { preprocess } from "../../src/preprocess.ts";
import { decompileToProgram } from "../../src/int/decompile.ts";
import { printProgram } from "../../src/int/print.ts";
import { emitInt } from "../../src/int/emit.ts";
import { preserveStringOrder } from "../../src/int/string-order.ts";

const WASM_DIR = path.join(REPO_ROOT, "server/out");
const MISS_LIST = path.join(import.meta.dirname, "reprint-misses.txt");

/** The pinned reprint misses, by corpus key. See the file's own header for what it is and is not. */
function pinnedReprintMisses(): ReadonlySet<string> {
    const lines = fs.readFileSync(MISS_LIST, "utf-8").split("\n");
    return new Set(lines.map((line) => line.trim()).filter((line) => line !== "" && !line.startsWith("#")));
}

export interface SweepResult {
    /** Scripts the front end compiled, which is what the three gates below are measured against. */
    compiled: number;
    /** Re-emit failures - byte mismatches and thrown errors alike. Must be empty. */
    readonly failures: string[];
    /** Scripts excluded before the decompiler ever runs, because the front end refused them. */
    readonly uncompilable: string[];
    /** Scripts that reprinted to different bytes - the string-table ordering effect, pinned by name. */
    readonly reprintMisses: string[];
    /** Stems whose reprint THREW rather than differing; a different defect, recorded separately. */
    readonly reprintErrors: string[];
    /** Resave failures. Must be empty: seeding the string order removes the one text-sensitivity. */
    readonly resaveFailures: string[];
}

const same = (a: Uint8Array, b: Uint8Array): boolean => a.length === b.length && a.every((byte, i) => byte === b[i]);

/** Runs all three gates over `scripts`, collecting rather than asserting. */
export function sweepDecompile(parser: Parser, scripts: readonly string[]): SweepResult {
    const result: SweepResult = {
        compiled: 0,
        failures: [],
        uncompilable: [],
        reprintMisses: [],
        reprintErrors: [],
        resaveFailures: [],
    };

    for (const script of scripts) {
        const stem = path.basename(script, path.extname(script));
        let bytes: Uint8Array;
        try {
            bytes = compileText(parser, preprocess(script));
            result.compiled++;
        } catch (error) {
            // The compile differential owns front-end coverage; this only decompiles what compiles.
            result.uncompilable.push(`${stem}: ${(error as Error).message}`);
            continue;
        }
        let recovered;
        try {
            recovered = decompileToProgram(bytes);
            if (!same(emitInt(recovered), bytes)) result.failures.push(`${path.basename(script)}: re-emit differs`);
        } catch (error) {
            result.failures.push(`${path.basename(script)}: ${(error as Error).message}`);
            continue;
        }
        // Kept apart from the gate above so that a printer or front-end error cannot be reported as
        // a decompiler failure - the two gates answer different questions.
        const text = printProgram(recovered);
        try {
            if (!same(compileText(parser, text), bytes)) result.reprintMisses.push(corpusKey(script));
        } catch (error) {
            // A miss either way, but a THROWN reprint is a different defect from a byte mismatch and is
            // recorded as such - the pinned miss list alone cannot tell them apart.
            result.reprintErrors.push(`${stem}: ${(error as Error).message}`);
        }
        try {
            const rebuilt = buildProgram(parser, text);
            rebuilt.stringLiterals = preserveStringOrder(rebuilt.stringLiterals ?? [], recovered.stringLiterals ?? []);
            rebuilt.stringTableAllocated = recovered.stringTableAllocated;
            if (!same(emitProgram(rebuilt), bytes)) result.resaveFailures.push(`${stem}: differs`);
        } catch (error) {
            result.resaveFailures.push(`${stem}: ${(error as Error).message}`);
        }
    }

    return result;
}

/**
 * Registers one shard's tests. Every shard lists the WHOLE corpus and asserts `CORPUS_SIZE` before
 * taking its slice, so the population guard is per-shard rather than something the split diluted; that
 * all the slices are present and tile the corpus is `shard-coverage.test.ts`'s job.
 *
 * Every gate here decomposes exactly, which is why the split is sound: the three failure lists are
 * empty-targets, and the two set-valued gates (which scripts the front end refuses, which reprint to
 * different bytes) are compared against the members of their pinned lists that fall in THIS slice - so
 * the union across shards is the pinned list itself, with no shard able to pass by seeing nothing.
 */
export function registerDecompileShard(index: number, count: number): void {
    const scripts = listScripts();
    const ready = scripts.length > 0 && fs.existsSync(path.join(WASM_DIR, "tree-sitter-ssl.wasm"));

    describe.skipIf(!ready)(`the real corpus decompiles back to the bytes it came from (${index}/${count})`, () => {
        const mine = shardScripts(scripts, index, count);
        let result: SweepResult;

        beforeAll(async () => {
            await Parser.init({ wasmBinary: fs.readFileSync(path.join(WASM_DIR, "web-tree-sitter.wasm")) });
            const parser = new Parser();
            parser.setLanguage(await Language.load(path.join(WASM_DIR, "tree-sitter-ssl.wasm")));
            result = sweepDecompile(parser, mine);
        });

        it("re-emits and resaves every script byte for byte, and reprints the ones not pinned as misses", () => {
            const expectedBroken = mine
                .map((script) => path.basename(script, path.extname(script)))
                .filter((stem) => BROKEN_STEMS.includes(stem))
                .toSorted();
            const pinned = pinnedReprintMisses();
            const expectedMisses = mine
                .map((script) => corpusKey(script))
                .filter((key) => pinned.has(key))
                .toSorted();

            const summary = [
                `corpus ${scripts.length}, shard ${index}/${count} of ${mine.length}, compiled ${result.compiled}`,
                `front end rejected ${result.uncompilable.length}: ${result.uncompilable.join(", ") || "none"}`,
                `reprint threw for ${result.reprintErrors.length}: ${result.reprintErrors.slice(0, 5).join(", ") || "none"}`,
            ].join("\n");

            // The whole corpus, from inside a shard: a slice of a corpus that shrank mid-checkout is a
            // slice of the wrong population, and every count below would still look plausible.
            expect(scripts.length, summary).toBe(CORPUS_SIZE);
            expect(mine.length, summary).toBeGreaterThan(0);
            // Not implied by the lists: a script silently skipped by the loop would be neither compiled
            // nor rejected, and every empty-list gate below would still pass.
            expect(result.compiled, summary).toBe(mine.length - result.uncompilable.length);
            expect(result.uncompilable.map((line) => line.split(":")[0]).toSorted(), summary).toEqual(expectedBroken);
            expect(result.failures.slice(0, 10), `re-emit failures\n${summary}`).toEqual([]);
            // A thrown reprint is a different defect from a byte mismatch, and the pinned list cannot
            // express it - the count this replaced folded the two together.
            expect(result.reprintErrors.slice(0, 10), `reprint errors\n${summary}`).toEqual([]);
            expect(result.reprintMisses.toSorted(), `reprint misses moved\n${summary}`).toEqual(expectedMisses);
            expect(result.resaveFailures.slice(0, 10), `resave failures\n${summary}`).toEqual([]);
        });
    });
}
