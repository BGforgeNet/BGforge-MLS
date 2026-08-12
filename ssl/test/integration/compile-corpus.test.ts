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
 * The pass count is asserted against a floor that only ratchets UP. A regression that drops coverage
 * fails here rather than being absorbed silently, and closing a gap means raising the floor in the same
 * commit - so the number in this file is the honest current state of the back end.
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

const RP_SCRIPTS = path.join(REPO_ROOT, "external/fallout/Fallout2_Restoration_Project/scripts_src");
const WASM_DIR = path.join(REPO_ROOT, "server/out");

/**
 * Scripts that compile byte-identically today. Raise when a gap closes; never lower to absorb a
 * regression - a drop means the back end lost coverage it had.
 */
const MATCHING_FLOOR = 999999;

function findCompiler(): string | null {
    try {
        return createRequire(path.join(REPO_ROOT, "server/package.json")).resolve(
            "sslc-emscripten-noderawfs/compiler.mjs",
        );
    } catch {
        return null;
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
                    stdio: "ignore",
                });
                expected = new Uint8Array(fs.readFileSync(path.join(workDir, `${stem}.int`)));
                oracles++;
            } catch {
                // The reference itself rejects it, so there is no oracle either way.
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
        const summary = `oracles ${oracles}, matching ${matching}, differing ${differing}, errors ${errors}\n${report}`;

        // Guard the denominator first: with no oracles every other number is trivially zero, and the
        // floor below would pass while nothing was compared at all.
        expect(oracles, summary).toBeGreaterThan(1000);
        expect(matching, summary).toBeGreaterThanOrEqual(MATCHING_FLOOR);
    });
});
