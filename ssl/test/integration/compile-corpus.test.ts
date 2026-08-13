/**
 * Compiles the real Restoration Project corpus and byte-compares against the reference.
 *
 * The hand-written cases in `test/int/` cover constructs one at a time; this is the sweep that says how
 * much of the actual language the compiler handles.
 *
 * Both sides are fed the SAME preprocessed text, produced by our own preprocessor - which the gcc
 * differential already validates separately. That is deliberate: it isolates codegen, so a mismatch
 * names the back end rather than leaving preprocessing and codegen as joint suspects. It is also the
 * only way the reference can build these scripts here at all, since invoked directly on a corpus file
 * it cannot resolve the headers the mod's own build supplies.
 *
 * The gate is that NOTHING the reference built comes back different, plus a sanity floor on how many
 * oracles the run obtained at all. It is deliberately not an absolute count of matches: the reference
 * rejects a handful of genuinely broken corpus scripts, so a count gate measures its success rate as much
 * as ours and turns somebody else's bad day into our regression. Every rejection is reported by name and
 * reason, because an exclusion nobody can see is a comparison that quietly shrank.
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
import { REPO_ROOT } from "../../../shared/cli/test/repo-root.ts";
import { SPAWN_TIMEOUT_MS } from "../../../shared/spawn-timeout.ts";
import { CORPUS_SIZE, listScripts } from "./corpus.ts";

const WASM_DIR = path.join(REPO_ROOT, "server/out");

/**
 * How many oracles the run must obtain before its verdict means anything. This is a sanity floor on the
 * comparison's population, deliberately well below the ~1517 the reference builds today: it exists to catch a
 * collapsed corpus or a broken reference, not to track their success rate. The gate itself is `differing === 0`
 * - the property this back end controls - because an absolute count of matches falls when the reference has a
 * bad day and reads as our regression. Raise this only if the corpus itself grows.
 */
const ORACLE_FLOOR = 1400;

/**
 * Corpus scripts the reference genuinely cannot build - each one a real defect in the mod's source, e.g.
 * `hcmale` declares `Node002` and never defines it, `zccorpse` references an undefined `SCRIPT_ZCCORPSE`.
 * They are pinned by name rather than merely counted so that an UNEXPECTED rejection fails loudly with its
 * reason attached: a child that dies for an environmental cause (a resource limit under a loaded runner,
 * say) is otherwise indistinguishable from these, and silently costs the comparison an input.
 *
 * `waypnt` appears twice on purpose - two different corpus directories each hold a file of that name, and
 * the comparison keys its scratch files by basename, so both are separate entries that both fail.
 */
const KNOWN_REJECTIONS = ["epa1", "epa2", "gl_k_modini", "hcmale", "vcconnar", "waypnt", "waypnt", "zccorpse"];

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
const workDir = ready ? fs.mkdtempSync(path.join(os.tmpdir(), "ssl-corpus-")) : "";

afterAll(() => {
    if (workDir) fs.rmSync(workDir, { recursive: true, force: true });
});

describe.skipIf(!ready)("real corpus compiles to matching bytecode", () => {
    let parser: Parser;

    beforeAll(async () => {
        await Parser.init({ wasmBinary: fs.readFileSync(path.join(WASM_DIR, "web-tree-sitter.wasm")) });
        parser = new Parser();
        parser.setLanguage(await Language.load(path.join(WASM_DIR, "tree-sitter-ssl.wasm")));
    });

    it("matches the reference on the corpus", () => {
        let matching = 0;
        let differing = 0;
        const failures = new Map<string, number>();
        // Scripts the reference could not build. Excluding them is right - they yield no oracle either way -
        // but the exclusion has to be visible, or a shrunken comparison reads exactly like a clean one.
        const excluded: string[] = [];
        const excludedStems: string[] = [];

        let oracles = 0;
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
                execFileSync(process.execPath, [compiler as string, "-O0", "-q", `${stem}.ssl`, "-o", `${stem}.int`], {
                    cwd: workDir,
                    // The reference reports its diagnostics on STDOUT, not stderr, so both are captured -
                    // discarding either leaves an exclusion that can only be reported as a bare exit code.
                    stdio: ["ignore", "pipe", "pipe"],
                    timeout: SPAWN_TIMEOUT_MS,
                });
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
                // The last [Error] line, or failing that whatever it said last - the banner and the
                // per-procedure warnings ahead of it are noise at this scale.
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
                actual = compileText(parser, text);
            } catch (error) {
                // Group by message shape so the report names the gaps, not 1500 individual scripts.
                // Only `unknown X` messages quote a user identifier worth collapsing; everywhere else
                // the quoted text is a node or operator kind, which is the whole point of the report.
                const message = (error as Error).message.replace(/^\d+:\d+: /, "");
                const reason = message.startsWith("unknown ") ? message.replaceAll(/'[^']*'/g, "'X'") : message;
                failures.set(reason, (failures.get(reason) ?? 0) + 1);
                continue;
            }
            if (expected.length === actual.length && expected.every((b, i) => b === actual[i])) matching++;
            else differing++;
        }

        const report = [...failures.entries()]
            .sort((a, b) => b[1] - a[1])
            .slice(0, 12)
            .map(([reason, count]) => `  ${String(count).padStart(5)}  ${reason}`)
            .join("\n");
        const errors = [...failures.values()].reduce((a, b) => a + b, 0);
        // The corpus total leads: without it, `oracles` is a number with no population behind it and a
        // shrunken comparison cannot be told from a complete one.
        const summary = [
            `corpus ${scripts.length}, oracles ${oracles}, matching ${matching}, differing ${differing}, errors ${errors}`,
            `reference rejected ${excluded.length}: ${excluded.join(", ") || "none"}`,
            report,
        ].join("\n");

        // Guard the denominator first: with no oracles every other number is trivially zero, and the
        // assertions below would pass while nothing was compared at all.
        // A corpus shrunk mid-run (see corpus.ts) costs oracles while every number stays plausible.
        expect(scripts.length, summary).toBe(CORPUS_SIZE);
        expect(oracles, summary).toBeGreaterThan(ORACLE_FLOOR);
        // Pinned by name: an exclusion outside this set means a script stopped building for a reason
        // nobody has looked at, which silently removes it from the comparison.
        expect(excludedStems.toSorted(), summary).toEqual(KNOWN_REJECTIONS);
        // The gate is over what this back end controls - every oracle it was given, it reproduces. An
        // absolute count of matches would instead track the reference's own per-run success rate.
        expect(differing, summary).toBe(0);
        expect(errors, summary).toBe(0);
    });
});
