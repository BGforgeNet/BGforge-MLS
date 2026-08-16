/**
 * Decompiles the whole Restoration Project corpus and checks the result against the bytes it came from.
 *
 * Three gates, measuring different things:
 *
 *   1. RE-EMIT. Compile a script, decompile the output, emit the recovered tree, compare bytes. This is
 *      exact and admits no interpretation - the emitter is the oracle, and every script must pass.
 *   2. REPRINT. Do the same but go out through the source printer and back in through the front end.
 *      This is a weaker property on purpose: printing produces different TEXT from the original, and a
 *      string constant's position in the string table follows the order the source mentions it - which
 *      the printer cannot control, since no spelling of an expression says where its literals go. That
 *      shifts bytes without changing what the script does, so this gate carries a floor.
 *   3. RESAVE. Reprint, but seed the emitter with the string order the original file used, which is
 *      what saving an edited script does - the file being written over is right there to read it from.
 *      That removes the one text-sensitivity above, so this gate demands EVERY script and is the one
 *      the editor's "save a script you have not edited and get the same bytes" promise rests on.
 *
 * No gate needs the reference compiler, so all three run wherever the corpus is checked out.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { describe, expect, it } from "vitest";
import { Language, Parser } from "web-tree-sitter";
import { buildProgram, compileText, emitProgram } from "../../src/compile.ts";
import { preprocess } from "../../src/preprocess.ts";
import { decompileToProgram } from "../../src/int/decompile.ts";
import { printProgram } from "../../src/int/print.ts";
import { emitInt } from "../../src/int/emit.ts";
import { preserveStringOrder } from "../../src/int/string-order.ts";
import { REPO_ROOT } from "../../../../shared/cli/test/repo-root.ts";
import { BROKEN_STEMS, CORPUS_SIZE, listScripts } from "./corpus.ts";

const WASM_DIR = path.join(REPO_ROOT, "server/out");

/**
 * Scripts whose decompiled source compiles back to the same bytes with no help. Raise when a gap
 * closes; never lower to absorb a regression. The shortfall is string-table ordering, described above -
 * the recovered code itself matches in every case the re-emit gate covers.
 *
 * It last moved DOWN by four, which a reprint regression would look identical to: the front end started
 * rejecting four of the declare-but-never-define scripts in `BROKEN_SCRIPTS`, so they left the population
 * rather than stopped reprinting. Only a shrinking `BROKEN_SCRIPTS` justifies lowering this.
 */
const REPRINT_FLOOR = 1263;

const scripts = listScripts();
const ready = scripts.length > 0 && fs.existsSync(path.join(WASM_DIR, "tree-sitter-ssl.wasm"));

const same = (a: Uint8Array, b: Uint8Array) => a.length === b.length && a.every((byte, i) => byte === b[i]);

describe.skipIf(!ready)("the real corpus decompiles back to the bytes it came from", () => {
    // All three gates are measured in one pass: compiling the corpus dominates the runtime, and doing
    // it once per property would triple a minutes-long suite to prove the same scripts three times.
    it("re-emits and resaves every script byte for byte, and reprints most of them", async () => {
        await Parser.init({ wasmBinary: fs.readFileSync(path.join(WASM_DIR, "web-tree-sitter.wasm")) });
        const parser = new Parser();
        parser.setLanguage(await Language.load(path.join(WASM_DIR, "tree-sitter-ssl.wasm")));

        let compiled = 0;
        let reprinted = 0;
        const failures: string[] = [];
        // Scripts excluded before the decompiler ever runs, and reprints lost to a thrown error rather
        // than a byte mismatch. Both are legitimate, and both shrink a denominator the gates below are
        // measured against, so neither may be silent.
        const uncompilable: string[] = [];
        const reprintErrors: string[] = [];
        const resaveFailures: string[] = [];

        for (const script of scripts) {
            const stem = path.basename(script, path.extname(script));
            let bytes: Uint8Array;
            try {
                bytes = compileText(parser, preprocess(script));
                compiled++;
            } catch (error) {
                // The compile differential owns front-end coverage; this only decompiles what compiles.
                uncompilable.push(`${stem}: ${(error as Error).message}`);
                continue;
            }
            let recovered;
            try {
                recovered = decompileToProgram(bytes);
                if (!same(emitInt(recovered), bytes)) failures.push(`${path.basename(script)}: re-emit differs`);
            } catch (error) {
                failures.push(`${path.basename(script)}: ${(error as Error).message}`);
                continue;
            }
            // Kept apart from the gate above so that a printer or front-end error cannot be reported as
            // a decompiler failure - the two gates answer different questions.
            const text = printProgram(recovered);
            try {
                if (same(compileText(parser, text), bytes)) reprinted++;
            } catch (error) {
                // A miss against the floor either way, but a THROWN reprint is a different defect from a
                // byte mismatch and is recorded as such - the floor alone cannot tell them apart.
                reprintErrors.push(`${stem}: ${(error as Error).message}`);
            }
            try {
                const rebuilt = buildProgram(parser, text);
                rebuilt.stringLiterals = preserveStringOrder(
                    rebuilt.stringLiterals ?? [],
                    recovered.stringLiterals ?? [],
                );
                rebuilt.stringTableAllocated = recovered.stringTableAllocated;
                if (!same(emitProgram(rebuilt), bytes)) resaveFailures.push(`${stem}: differs`);
            } catch (error) {
                resaveFailures.push(`${stem}: ${(error as Error).message}`);
            }
        }

        const summary = [
            `corpus ${scripts.length}, compiled ${compiled}, reprinted ${reprinted}, resave failures ${resaveFailures.length}`,
            `front end rejected ${uncompilable.length}: ${uncompilable.join(", ") || "none"}`,
            `reprint threw for ${reprintErrors.length}: ${reprintErrors.slice(0, 5).join(", ") || "none"}`,
        ].join("\n");

        // Guard the denominator: a corpus shrunk mid-run (see corpus.ts) weakens every gate below while
        // leaving each count plausible, and with nothing compiled they are all trivially satisfied.
        expect(scripts.length, summary).toBe(CORPUS_SIZE);
        expect(compiled, summary).toBeGreaterThan(1000);
        // Pinned by name, so the denominator cannot shift under the floors without saying so.
        expect(uncompilable.map((line) => line.split(":")[0]).toSorted(), summary).toEqual(BROKEN_STEMS);
        expect(failures.slice(0, 10), `${failures.length} of ${compiled} failed to re-emit\n${summary}`).toEqual([]);
        expect(reprinted, `${reprinted} of ${compiled} reprinted identically\n${summary}`).toBeGreaterThanOrEqual(
            REPRINT_FLOOR,
        );
        // No floor: preserving the string order removes the only reason a reprint differed, so anything
        // left here is a real defect in the printer or the front end rather than a known text effect.
        expect(
            resaveFailures.slice(0, 10),
            `${resaveFailures.length} of ${compiled} failed to resave\n${summary}`,
        ).toEqual([]);
    });
});
