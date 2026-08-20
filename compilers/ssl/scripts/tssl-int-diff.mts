/**
 * Compares the two routes from `.tssl` to bytecode: through generated SSL text, and straight to the IR.
 *
 * The text route is the one that ships today, and it is byte-verified against the corpus, so it is the
 * oracle for the direct route as that grows. Both are run over the same sources at the same switches and
 * compared byte for byte; on a mismatch each program is rendered back to source with `printProgram` and
 * the first differing line is shown, because a byte offset says nothing about which declaration moved.
 *
 * Usage: pnpm tssl-int-diff <repo-dir-or-file> [-O<level>] [-s]
 *
 * **This oracle is on a clock.** It works only while a mod still commits the generated `.ssl` the text
 * route produces - once the intermediate stops existing there is nothing to compare against, and the
 * direct route's only remaining gate is `tssl-oracles`, which pins bytes rather than explaining them.
 * Every construct brought through the direct route is cheaper to verify before that window closes.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { execFileSync } from "node:child_process";
import { Language, Parser } from "web-tree-sitter";
import { buildProgram, compilePreprocessed, emitProgram, type CompileOptions } from "../src/compile.ts";
import { preprocessTextWithOrigins } from "../src/preprocess.ts";
import { printProgram } from "../src/int/print.ts";
import { createBatchState, transpile } from "../../../transpilers/tssl/src/index.ts";
import { setConlog } from "../../../transpilers/tssl/src/types.ts";

const REPO_ROOT = path.resolve(import.meta.dirname, "..", "..", "..");
const WASM_DIR = path.join(REPO_ROOT, "server/out");

function usage(message: string): never {
    console.error(`${message}\nUsage: pnpm tssl-int-diff <repo-dir-or-file> [-O<level>] [-s]`);
    process.exit(1);
}

/** Every `.tssl` under a directory, or the single file named. */
function sourcesOf(target: string): string[] {
    if (fs.statSync(target).isFile()) return [target];
    const tracked = execFileSync("git", ["-C", target, "ls-files", "*.tssl"], { encoding: "utf-8", timeout: 60_000 });
    return tracked
        .split("\n")
        .filter(Boolean)
        .map((name) => path.join(target, name))
        .sort();
}

/** The first line at which two rendered programs disagree, with a little context on each side. */
function firstDifference(left: string, right: string): string {
    const a = left.split("\n");
    const b = right.split("\n");
    for (let i = 0; i < Math.max(a.length, b.length); i++) {
        if (a[i] === b[i]) continue;
        return [`    line ${i + 1}:`, `      text   ${a[i] ?? "<end>"}`, `      direct ${b[i] ?? "<end>"}`].join("\n");
    }
    return "    programs render identically; the difference is in emission, not in the tree";
}

async function run(target: string, options: CompileOptions): Promise<void> {
    await Parser.init({ wasmBinary: fs.readFileSync(path.join(WASM_DIR, "web-tree-sitter.wasm")) });
    const parser = new Parser();
    parser.setLanguage(await Language.load(path.join(WASM_DIR, "tree-sitter-ssl.wasm")));
    setConlog(() => {});

    // Resolved lazily so this script runs before the direct front end exists, reporting it as unbuilt
    // rather than failing to load - which is what lets the harness be the first thing written.
    let direct: ((file: string, text: string) => unknown) | null = null;
    try {
        const mod = (await import("../../../transpilers/tssl/src/int/lower.ts")) as {
            lowerTsslProgram?: (file: string, text: string) => unknown;
        };
        direct = mod.lowerTsslProgram ?? null;
    } catch {
        direct = null;
    }

    const batch = createBatchState();
    const sources = sourcesOf(target);
    let same = 0;
    let differed = 0;
    let unsupported = 0;

    for (const file of sources) {
        const name = path.relative(REPO_ROOT, file);
        const entry = file.replace(/\.tssl$/, ".ssl");
        const text = fs.readFileSync(file, "utf-8");

        // eslint-disable-next-line no-await-in-loop -- one shared ts-morph project; see tssl-oracles.mts
        const ssl = await transpile(file, text, batch);
        const viaText = compilePreprocessed(parser, preprocessTextWithOrigins(ssl, entry), entry, options);

        if (direct === null) {
            unsupported++;
            continue;
        }
        let viaIr: Uint8Array;
        let printed: string;
        try {
            const program = direct(file, text) as Parameters<typeof emitProgram>[0];
            viaIr = emitProgram(program, options);
            printed = printProgram(program);
        } catch (error) {
            unsupported++;
            console.log(`unsupported ${name}: ${error instanceof Error ? error.message : String(error)}`);
            continue;
        }
        if (Buffer.compare(Buffer.from(viaText), Buffer.from(viaIr)) === 0) {
            same++;
            continue;
        }
        differed++;
        // Rebuilt rather than kept from above: `compilePreprocessed` does not hand back the program.
        const rebuilt = buildProgram(parser, preprocessTextWithOrigins(ssl, entry).text, options);
        const viaTextProgram = printProgram(rebuilt);
        console.error(`DIFFER ${name}\n${firstDifference(viaTextProgram, printed)}`);
    }

    const built = direct === null ? " (direct front end not built)" : "";
    console.log(`${sources.length} sources: ${same} identical, ${differed} differ, ${unsupported} unsupported${built}`);
    process.exit(differed > 0 ? 1 : 0);
}

function main(): void {
    const args = process.argv.slice(2);
    const options: CompileOptions = {};
    let target: string | undefined;
    for (const arg of args) {
        if (arg === "-O0") options.level = 0;
        else if (arg === "-O1") options.level = 1;
        else if (arg === "-O2") options.level = 2;
        else if (arg === "-s") options.shortCircuit = true;
        else if (target === undefined) target = arg;
        else usage(`unexpected argument '${arg}'`);
    }
    if (!target) usage("missing repo directory or file");
    if (!fs.existsSync(path.join(WASM_DIR, "tree-sitter-ssl.wasm")))
        usage("grammar not built - run: pnpm build:grammar");
    void run(path.resolve(target), options);
}

main();
