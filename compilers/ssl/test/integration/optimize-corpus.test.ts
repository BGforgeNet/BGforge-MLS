/**
 * The optimised twin of the compile differential: same corpus, same oracle, run at both `-O1` and `-O2`.
 *
 * This is the only gate that can hold the optimiser honest. Its passes REMOVE things, so nothing about
 * the unoptimised output constrains them, and a wrong removal produces a script that loads fine and then
 * misbehaves in-game - no exception, no diagnostic, nothing a unit test on hand-written IR would notice.
 * Byte-equality against the reference across 1500 real scripts is what turns "the removals look right"
 * into a checked claim, and it is why the optimiser is wired behind an option rather than switched on
 * before a gate existed for it.
 *
 * Reading a failure: the two sides agree on WHAT is dead, so a mismatch is nearly always a stale
 * reference to something removed - a procedure slot or global index that was not renumbered, or a string
 * literal left interned by code that no longer exists, which shifts every later string offset.
 */

import { createRequire } from "node:module";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Language, Parser } from "web-tree-sitter";
import { compileText } from "../../src/compile.ts";
import { preprocess } from "../../src/preprocess.ts";
import { REPO_ROOT } from "../../../../shared/cli/test/repo-root.ts";
import { BROKEN_WHEN_OPTIMISED, CORPUS_SIZE, ReferenceRefusedError, listScripts, runReference } from "./corpus.ts";

const WASM_DIR = path.join(REPO_ROOT, "server/out");

/** Same sanity floor as the unoptimised differential, and the same reasoning behind it. */
const ORACLE_FLOOR = 1400;

function findCompiler(): string | null {
    try {
        return createRequire(path.join(REPO_ROOT, "server/package.json")).resolve(
            "sslc-emscripten-noderawfs/compiler.mjs",
        );
    } catch {
        return null;
    }
}

const compiler = findCompiler();
const scripts = listScripts();
const wasmPresent = fs.existsSync(path.join(WASM_DIR, "tree-sitter-ssl.wasm"));
const ready = compiler !== null && wasmPresent && scripts.length > 0;
const workDir = ready ? fs.mkdtempSync(path.join(os.tmpdir(), "ssl-opt-")) : "";

afterAll(() => {
    if (workDir) fs.rmSync(workDir, { recursive: true, force: true });
});

describe.skipIf(!ready).each([1, 2] as const)("the real corpus optimises to matching bytecode at -O%d", (level) => {
    let parser: Parser;

    beforeAll(async () => {
        await Parser.init({ wasmBinary: fs.readFileSync(path.join(WASM_DIR, "web-tree-sitter.wasm")) });
        parser = new Parser();
        parser.setLanguage(await Language.load(path.join(WASM_DIR, "tree-sitter-ssl.wasm")));
    });

    it("matches the reference", () => {
        let matching = 0;
        let differing = 0;
        let oracles = 0;
        const failures = new Map<string, number>();
        const excluded: string[] = [];
        const excludedStems: string[] = [];
        const differences: string[] = [];

        for (const script of scripts) {
            const stem = path.basename(script, path.extname(script));

            let text: string;
            try {
                text = preprocess(script);
            } catch (error) {
                failures.set(`preprocess: ${(error as Error).message}`, 1);
                continue;
            }

            let expected: Uint8Array;
            try {
                fs.writeFileSync(path.join(workDir, `${stem}.ssl`), text);
                runReference(compiler as string, workDir, stem, level);
                expected = new Uint8Array(fs.readFileSync(path.join(workDir, `${stem}.int`)));
                oracles++;
            } catch (error) {
                if (!(error instanceof ReferenceRefusedError)) throw error;
                excluded.push(`${stem} (${error.why}): ${error.reason}`);
                excludedStems.push(stem);
                continue;
            }

            let actual: Uint8Array;
            try {
                actual = compileText(parser, text, { level });
            } catch (error) {
                const message = (error as Error).message.replace(/^\d+:\d+: /, "");
                const reason = message.startsWith("unknown ") ? message.replaceAll(/'[^']*'/g, "'X'") : message;
                failures.set(reason, (failures.get(reason) ?? 0) + 1);
                continue;
            }
            if (expected.length === actual.length && expected.every((b, i) => b === actual[i])) matching++;
            else {
                differing++;
                // Named, because at this scale "37 differ" is not something anyone can act on.
                if (differences.length < 10)
                    differences.push(`${stem} (ref ${expected.length}b, ours ${actual.length}b)`);
            }
        }

        const report = [...failures.entries()]
            .sort((a, b) => b[1] - a[1])
            .slice(0, 12)
            .map(([reason, count]) => `  ${String(count).padStart(5)}  ${reason}`)
            .join("\n");
        const errors = [...failures.values()].reduce((a, b) => a + b, 0);
        const summary = [
            `corpus ${scripts.length}, oracles ${oracles}, matching ${matching}, differing ${differing}, errors ${errors}`,
            `reference rejected ${excluded.length}: ${excluded.join(", ") || "none"}`,
            `first differences: ${differences.join(", ") || "none"}`,
            report,
        ].join("\n");

        expect(scripts.length, summary).toBe(CORPUS_SIZE);
        expect(oracles, summary).toBeGreaterThan(ORACLE_FLOOR);
        expect(excludedStems.toSorted(), summary).toEqual(BROKEN_WHEN_OPTIMISED);
        expect(differing, summary).toBe(0);
        expect(errors, summary).toBe(0);
    });
});
