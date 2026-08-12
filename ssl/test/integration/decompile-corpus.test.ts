/**
 * Decompiles the whole Restoration Project corpus and checks the result against the bytes it came from.
 *
 * Two gates, measuring different things:
 *
 *   1. RE-EMIT. Compile a script, decompile the output, emit the recovered tree, compare bytes. This is
 *      exact and admits no interpretation - the emitter is the oracle, and every script must pass.
 *   2. REPRINT. Do the same but go out through the source printer and back in through the front end.
 *      This is a weaker property on purpose: printing produces different TEXT from the original, and
 *      the compiler's behaviour is text-sensitive in two known ways - a string constant's position in
 *      the string table follows the order the source mentions it, and a negative literal folds into one
 *      push in some positions and not others. Those shift bytes without changing what the script does,
 *      so this gate carries a floor rather than demanding every script.
 *
 * Neither gate needs the reference compiler, so both run wherever the corpus is checked out.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { describe, expect, it } from "vitest";
import { Language, Parser } from "web-tree-sitter";
import { compileText } from "../../src/compile.ts";
import { preprocess } from "../../src/preprocess.ts";
import { decompileToProgram } from "../../src/int/decompile.ts";
import { printProgram } from "../../src/int/print.ts";
import { emitInt } from "../../src/int/emit.ts";
import { REPO_ROOT } from "../../../shared/cli/test/repo-root.ts";

const RP_SCRIPTS = path.join(REPO_ROOT, "external/fallout/Fallout2_Restoration_Project/scripts_src");
const WASM_DIR = path.join(REPO_ROOT, "server/out");

/**
 * Scripts whose decompiled source compiles back to the same bytes. Raise when a gap closes; never
 * lower to absorb a regression. The shortfall is string-table ordering and literal folding, both
 * described above - the recovered code itself matches in every case the re-emit gate covers.
 */
const REPRINT_FLOOR = 1134;

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

const scripts = listScripts();
const ready = scripts.length > 0 && fs.existsSync(path.join(WASM_DIR, "tree-sitter-ssl.wasm"));

const same = (a: Uint8Array, b: Uint8Array) => a.length === b.length && a.every((byte, i) => byte === b[i]);

describe.skipIf(!ready)("the real corpus decompiles back to the bytes it came from", () => {
    // Both gates are measured in one pass: compiling the corpus dominates the runtime, and doing it
    // once per property would double a minute-long suite to prove the same scripts twice.
    it("re-emits every script byte for byte, and reprints most of them", async () => {
        await Parser.init({ wasmBinary: fs.readFileSync(path.join(WASM_DIR, "web-tree-sitter.wasm")) });
        const parser = new Parser();
        parser.setLanguage(await Language.load(path.join(WASM_DIR, "tree-sitter-ssl.wasm")));

        let compiled = 0;
        let reprinted = 0;
        const failures: string[] = [];

        for (const script of scripts) {
            let bytes: Uint8Array;
            try {
                bytes = compileText(parser, preprocess(script));
                compiled++;
            } catch {
                // The compile differential owns front-end coverage; this only decompiles what compiles.
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
            try {
                if (same(compileText(parser, printProgram(recovered)), bytes)) reprinted++;
            } catch {
                // Counted as a miss against the floor.
            }
        }

        // Guard the denominator: with nothing compiled every count below is trivially satisfied.
        expect(compiled).toBeGreaterThan(1000);
        expect(failures.slice(0, 10), `${failures.length} of ${compiled} failed to re-emit`).toEqual([]);
        expect(reprinted, `${reprinted} of ${compiled} reprinted identically`).toBeGreaterThanOrEqual(REPRINT_FLOOR);
    });
});
