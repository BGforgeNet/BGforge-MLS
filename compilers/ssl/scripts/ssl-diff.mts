/**
 * One-shot differential probe: compile one source with this compiler and with the reference, and say
 * whether the bytes match.
 *
 * This is the loop the corpus sweep is too slow to serve. That sweep answers "did anything regress across
 * 1500 real scripts"; this answers "does THIS construct match" in about a second,
 * which is the question every front-end change actually starts from. Findings graduate from here into the
 * case table in `test/int/compile.test.ts`, which is where they become a guard.
 *
 * It compiles through the library SOURCE rather than the built `ssl` CLI on purpose. The CLI carries its
 * own copy of the grammar under `out/`, which `pnpm build:grammar` does not refresh, so a probe run
 * through it after a grammar change reports a divergence that no longer exists.
 *
 * Usage: pnpm ssl-diff <file.ssl> [-O<level>] [--keep]
 *        pnpm ssl-diff -e '<source>' [-O<level>] [--keep]
 *   -O<level>  optimisation level for both compilers (default 0)
 *   --keep     leave the scratch directory in place and print its path
 *
 * Exits 0 when the two agree - including when both REFUSE the source, which is its own kind of agreement
 * and the thing an "is this accepted?" probe most often gets wrong.
 */

import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { Language, Parser } from "web-tree-sitter";
import { compileFile } from "../src/compile.ts";
import { formatDisassembly } from "../src/int/disasm.ts";
import { readInt } from "../src/int/read.ts";
import { SPAWN_TIMEOUT_MS } from "../../../shared/spawn-timeout.ts";

// Anchored to this file rather than to cwd, so the probe works from anywhere. The repo's shared
// `repo-root` helper is not usable here: it reads `__dirname`, which an ES module does not have.
const REPO_ROOT = path.resolve(import.meta.dirname, "..", "..", "..");
const WASM_DIR = path.join(REPO_ROOT, "server/out");

/** What one compiler did with the source: bytes, or the message it refused with. */
type Outcome = { bytes: Uint8Array } | { refused: string };

function usage(message: string): never {
    console.error(`${message}\n\nUsage: pnpm ssl-diff <file.ssl | -e '<source>'> [-O<level>] [--keep]`);
    process.exit(2);
}

function parseArgs(argv: string[]) {
    let source: string | null = null;
    let file: string | null = null;
    let level: 0 | 1 | 2 = 0;
    let keep = false;
    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i]!;
        if (arg === "-e") {
            source = argv[++i] ?? usage("-e needs a source string");
        } else if (arg === "--keep") {
            keep = true;
        } else if (/^-O[012]$/.test(arg)) {
            level = Number(arg.slice(2)) as 0 | 1 | 2;
        } else if (arg.startsWith("-")) {
            usage(`unknown option '${arg}'`);
        } else {
            file = arg;
        }
    }
    if (source === null && file === null) usage("give a file or -e '<source>'");
    if (file !== null && !fs.existsSync(file)) usage(`no such file: ${file}`);
    return { source, file, level, keep };
}

function referenceCompiler(): string {
    try {
        return createRequire(path.join(REPO_ROOT, "server/package.json")).resolve(
            "sslc-emscripten-noderawfs/compiler.mjs",
        );
    } catch {
        console.error("The reference compiler is not installed - run pnpm install.");
        process.exit(2);
    }
}

function runReference(compiler: string, entry: string, workDir: string, level: number): Outcome {
    const out = path.join(workDir, `${path.basename(entry, path.extname(entry))}-ref.int`);
    try {
        // `-p` is what makes the reference preprocess at all; without it every directive line is discarded
        // unread, so a probe of anything involving a macro compares our expansion against no expansion.
        execFileSync(process.execPath, [compiler, `-O${level}`, "-q", "-p", path.basename(entry), "-o", out], {
            // The source is compiled WHERE IT LIES, so its relative `#include`s resolve as they do in its
            // own build; only the output goes to the scratch directory.
            cwd: path.dirname(entry),
            // It reports diagnostics on stdout, so both streams are captured or the refusal reads as silence.
            stdio: ["ignore", "pipe", "pipe"],
            timeout: SPAWN_TIMEOUT_MS,
        });
    } catch (error) {
        const { stdout, stderr } = error as { stdout?: Buffer; stderr?: Buffer };
        const said = `${stdout?.toString() ?? ""}${stderr?.toString() ?? ""}`
            .split("\n")
            .map((line) => line.trim())
            .filter((line) => line.startsWith("[Error]") || line.startsWith("[Warning] <Semantic>"));
        return { refused: said.at(-1) ?? "refused without saying why" };
    }
    return { bytes: new Uint8Array(fs.readFileSync(out)) };
}

async function ours(file: string, level: 0 | 1 | 2): Promise<Outcome> {
    await Parser.init({ wasmBinary: fs.readFileSync(path.join(WASM_DIR, "web-tree-sitter.wasm")) });
    const parser = new Parser();
    parser.setLanguage(await Language.load(path.join(WASM_DIR, "tree-sitter-ssl.wasm")));
    try {
        return { bytes: compileFile(parser, file, { level }) };
    } catch (error) {
        return { refused: error instanceof Error ? error.message : String(error) };
    }
}

/** The first byte at which the two differ, or -1. Length differences count from the shorter end. */
function firstDifference(a: Uint8Array, b: Uint8Array): number {
    const shared = Math.min(a.length, b.length);
    for (let i = 0; i < shared; i++) if (a[i] !== b[i]) return i;
    return a.length === b.length ? -1 : shared;
}

function disassemble(bytes: Uint8Array): string {
    try {
        return formatDisassembly(readInt(bytes));
    } catch (error) {
        return `<could not disassemble: ${error instanceof Error ? error.message : String(error)}>`;
    }
}

async function main(): Promise<number> {
    const args = parseArgs(process.argv.slice(2));
    const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "ssl-diff-"));
    // A snippet is written to the scratch directory; a real file is compiled where it lies, so that the
    // headers it includes by relative path resolve exactly as they do in its own build.
    let entry: string;
    if (args.file) {
        entry = path.resolve(args.file);
    } else {
        entry = path.join(workDir, "snippet.ssl");
        fs.writeFileSync(entry, args.source!);
    }

    const theirs = runReference(referenceCompiler(), entry, workDir, args.level);
    const mine = await ours(entry, args.level);
    const agreed = report(mine, theirs, args.level);

    if (args.keep) console.log(`\nScratch kept at ${workDir}`);
    else fs.rmSync(workDir, { recursive: true, force: true });
    return agreed ? 0 : 1;
}

/** Prints the verdict and says whether the two agreed. */
function report(mine: Outcome, theirs: Outcome, level: number): boolean {
    if ("refused" in mine && "refused" in theirs) {
        console.log(`BOTH REFUSED at -O${level}`);
        console.log(`  reference: ${theirs.refused}`);
        console.log(`  ours:      ${mine.refused}`);
        return true;
    }
    if ("refused" in mine) {
        console.log(`ONLY OURS REFUSED at -O${level}: ${mine.refused}`);
        console.log(`The reference produced ${(theirs as { bytes: Uint8Array }).bytes.length} bytes.`);
        return false;
    }
    if ("refused" in theirs) {
        console.log(`ONLY THE REFERENCE REFUSED at -O${level}: ${theirs.refused}`);
        console.log(`We produced ${mine.bytes.length} bytes, so this source compiles to something it will not.`);
        return false;
    }
    const at = firstDifference(mine.bytes, theirs.bytes);
    if (at === -1) {
        console.log(`MATCH at -O${level}: ${mine.bytes.length} bytes`);
        return true;
    }
    console.log(`DIFFER at -O${level}: ours ${mine.bytes.length} bytes, reference ${theirs.bytes.length}`);
    console.log(`First difference at offset 0x${at.toString(16)}\n`);
    console.log(`--- ours ---\n${disassemble(mine.bytes)}`);
    console.log(`--- reference ---\n${disassemble(theirs.bytes)}`);
    return false;
}

process.exit(await main());
