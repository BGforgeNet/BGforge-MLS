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

import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Language, Parser } from "web-tree-sitter";
import { compileText } from "../../src/compile.ts";
import { preprocess } from "../../src/preprocess.ts";
import { REPO_ROOT } from "../../../../shared/cli/test/repo-root.ts";
import { SPAWN_TIMEOUT_MS } from "../../../../shared/spawn-timeout.ts";
import { CORPUS_SIZE, listScripts } from "./corpus.ts";

const WASM_DIR = path.join(REPO_ROOT, "server/out");

/** Same sanity floor as the unoptimised differential, and the same reasoning behind it. */
const ORACLE_FLOOR = 1400;

/**
 * Only three, where the unoptimised differential excludes eight. The other five declare a procedure they
 * never define, which is a code-generation error at `-O0` and no error at all once optimising: the
 * procedure is unreferenced, so it is removed before anything asks for its body. These three reference
 * undefined SYMBOLS, which no amount of dead-code elimination makes go away.
 */
const KNOWN_REJECTIONS = ["waypnt", "waypnt", "zccorpse"];

/**
 * One reference invocation, retried once if the child is KILLED rather than exiting.
 *
 * The bundled compiler hangs about one spawn in several thousand, on a script it compiles in under a
 * tenth of a second every other time - `scgond` was killed at the two-minute bound here and takes 90ms
 * on its own. That is the external flake this retry exists for, and nothing else: a real rejection exits
 * with a status and is not retried, so the pinned exclusion list below still fails loudly when the
 * reference genuinely refuses a script.
 */
function runReference(compiler: string, cwd: string, stem: string, level: number): void {
    const args = [compiler, `-O${level}`, "-q", `${stem}.ssl`, "-o", `${stem}.int`];
    for (let attempt = 0; ; attempt++) {
        try {
            execFileSync(process.execPath, args, { cwd, stdio: ["ignore", "pipe", "pipe"], timeout: SPAWN_TIMEOUT_MS });
            return;
        } catch (error) {
            const killed = (error as { signal?: string }).signal !== undefined;
            if (!killed || attempt > 0) throw error;
        }
    }
}

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
                const { status, signal, stdout, stderr } = error as {
                    status?: number;
                    signal?: string;
                    stdout?: Buffer;
                    stderr?: Buffer;
                };
                const why = signal ? `killed by ${signal}` : `exit ${status ?? "?"}`;
                const said = `${stdout?.toString() ?? ""}${stderr?.toString() ?? ""}`
                    .split("\n")
                    .map((line) => line.trim())
                    .filter(Boolean)
                    .filter((line) => !line.startsWith("[Warning]") && !line.startsWith("***"));
                excluded.push(
                    `${stem} (${why}): ${said.findLast((l) => l.includes("[Error]")) ?? said.at(-1) ?? "silent"}`,
                );
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
        expect(excludedStems.toSorted(), summary).toEqual(KNOWN_REJECTIONS);
        expect(differing, summary).toBe(0);
        expect(errors, summary).toBe(0);
    });
});
