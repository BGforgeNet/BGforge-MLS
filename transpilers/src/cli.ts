#!/usr/bin/env node
/**
 * CLI tool to transpile TD, TBAF, and TSSL files to WeiDU D, BAF, and Fallout SSL formats.
 * Auto-detects language by file extension.
 * Usage: fgtp <file.td|file.tbaf|file.tssl|dir> [--save] [--check] [-r] [-q]
 */

import * as fs from "fs";
import * as path from "path";
import { EXT_TD, EXT_TBAF, EXT_TSSL } from "../common/extensions";
import {
    tssl as transpileTSSL,
    tbaf as transpileTBAF,
    td as transpileTD,
    createBatchState,
    outputPathFor,
    type TranspileBatchState,
} from "./index";
import {
    type FileResult,
    type OutputMode,
    checkFileSize,
    parseCliArgs,
    runCli,
    safeProcess,
    reportDiff,
} from "../../shared/cli/cli-utils";
import { emitProgram } from "../../compilers/ssl/src/compile";
import { optimize } from "../../compilers/ssl/src/optimize";
import { lowerTsslProgram } from "../tssl/src/int/lower";

type TranspileType = "td" | "tbaf" | "tssl";

const EXTENSIONS = [EXT_TD, EXT_TBAF, EXT_TSSL];

// Per-extension input-size cap. TSSL/TBAF/TD source files are TypeScript
// modules; even the largest mod source corpora keep them under 200 KB.
// The cap is a defense against an oversized or truncated input triggering
// a large Buffer allocation before the parser sees it. Mirrors fgbin's
// MAX_FILE_SIZES and fgfmt's equivalent table.
const MAX_FILE_SIZES: Record<string, number> = {
    tssl: 8 * 1024 * 1024,
    tbaf: 8 * 1024 * 1024,
    td: 8 * 1024 * 1024,
};

function getTranspileType(filePath: string): TranspileType | null {
    const lower = filePath.toLowerCase();
    if (lower.endsWith(EXT_TD)) return "td";
    if (lower.endsWith(EXT_TBAF)) return "tbaf";
    if (lower.endsWith(EXT_TSSL)) return "tssl";
    return null;
}

// Shared batch state for TSSL files - reuses ts-morph Project and caches
// inline function extraction across files, avoiding redundant parsing of
// shared libraries like folib.
let tsslBatchState: TranspileBatchState | undefined;

/**
 * Compiling straight to bytecode, with no generated SSL in between.
 *
 * Set by `--int`. Nothing here parses SSL, so this path needs no grammar: the TypeScript AST becomes the
 * compiler's IR directly. The emitted `.ssl` remains available alongside (`--int --save`) and is not
 * merely offered - `scripts/test-transpile-external.sh` compiles it and byte-compares against what this
 * writes, so the two cannot drift apart unnoticed.
 */
interface IntOptions {
    level: 0 | 1 | 2;
    shortCircuit: boolean;
}

let intOptions: IntOptions | null = null;

function compileToInt(resolved: string, text: string, options: IntOptions): Uint8Array {
    // `emitProgram` rather than `emitInt`: it already reconciles the level with the pragma and with
    // whether the optimiser removed the fall-through epilogue, which the raw emitter leaves to callers.
    const compile = { level: options.level, shortCircuit: options.shortCircuit };
    return emitProgram(optimize(lowerTsslProgram(resolved, text), compile), compile);
}

/** `foo.tssl` to `foo.int`, beside the source as the other outputs are. */
function intPathFor(filePath: string): string {
    return filePath.replace(/\.tssl$/i, ".int");
}

async function processFile(filePath: string, mode: OutputMode): Promise<FileResult> {
    const type = getTranspileType(filePath);
    if (!type) {
        console.error(`Error: Unsupported file type: ${filePath} (expected ${EXT_TD}, ${EXT_TBAF}, or ${EXT_TSSL})`);
        return "error";
    }

    return safeProcess(filePath, async () => {
        if (!checkFileSize(filePath, MAX_FILE_SIZES)) return "error";

        const text = fs.readFileSync(filePath, "utf-8");
        const resolved = path.resolve(filePath);

        if (intOptions !== null) {
            if (type !== "tssl") {
                console.error(`Error: --int compiles ${EXT_TSSL} only; ${filePath} has no bytecode target`);
                return "error";
            }
            const bytes = compileToInt(resolved, text, intOptions);
            const intPath = intPathFor(filePath);
            fs.writeFileSync(intPath, bytes);
            console.log(`Compiled: ${filePath} -> ${path.basename(intPath)}`);
            // `--save` alongside keeps the readable SSL; without it nothing intermediate is written.
            if (mode !== "save" && mode !== "save-and-check") return "changed";
        }

        let output: string;
        if (type === "tssl") {
            if (!tsslBatchState) tsslBatchState = createBatchState();
            output = await transpileTSSL(resolved, text, tsslBatchState);
        } else if (type === "td") {
            const result = await transpileTD(resolved, text);
            for (const w of result.warnings) {
                console.error(`[TD] ${filePath}:${w.line}: ${w.message}`);
            }
            output = result.output;
        } else {
            output = await transpileTBAF(resolved, text);
        }

        // The library's mapping, not a local copy: an extension it does not map throws here rather than
        // returning the input path, which `--save` would then overwrite with the transpiled output.
        const outPath = outputPathFor(filePath);

        // Read with try/catch instead of existsSync->readFileSync to avoid the
        // TOCTOU window CodeQL js/file-system-race flags.
        const readExisting = (): string | null => {
            try {
                return fs.readFileSync(outPath, "utf-8");
            } catch (error) {
                if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
                throw error;
            }
        };
        if (mode === "save") {
            const existing = readExisting();
            if (existing !== output) {
                fs.writeFileSync(outPath, output, "utf-8");
                console.log(`Transpiled: ${filePath} -> ${path.basename(outPath)}`);
                return "changed";
            }
            return "unchanged";
        } else if (mode === "check") {
            const existing = readExisting();
            if (existing !== output) {
                reportDiff(filePath, existing ?? "", output);
                return "changed";
            }
            return "unchanged";
        } else {
            process.stdout.write(output);
            return "changed";
        }
    });
}

const HELP = `Usage: fgtp <file.td|file.tbaf|file.tssl|dir> [--save] [--check] [--int] [-r] [-q]
  --int             Compile .tssl straight to .int bytecode, writing no intermediate .ssl
  --opt <0|1|2>     Optimisation level for --int (default: 1, as the ssl compiler's own default)
  --short-circuit   Skip the right operand of and/or once the left decides the result (--int only)
  --save            Write output to file (default: stdout)
  --check           Check if output files are up to date (exit 1 if not)
  --save-and-check  Write output and verify the result is unchanged on a re-run
  -r                Recursively transpile all .td, .tbaf, and .tssl files in directory
  -q                Quiet mode: suppress summary, only print changed files
  --jobs <n>        Process directory files with N parallel workers

Examples:
  fgtp mydialog.td              # Print D output to stdout
  fgtp mydialog.td --save       # Write mydialog.d
  fgtp myscript.tbaf --save     # Write myscript.baf
  fgtp myscript.tssl --save     # Write myscript.ssl
  fgtp myscript.tssl --int      # Write myscript.int, no .ssl at all
  fgtp src/ -r --int --save     # Write both, keeping the readable .ssl beside the bytecode
  fgtp src/ -r --save           # Transpile all .td, .tbaf, and .tssl files
  fgtp src/ -r --check          # Check all outputs are up to date`;

async function main() {
    const args = parseCliArgs(HELP, [
        ["--int", "Compile .tssl straight to .int bytecode"],
        ["--opt <level>", "Optimisation level for --int"],
        ["--short-circuit", "Short-circuit and/or for --int"],
    ]);
    if (!args) return;

    const extra = args.extra ?? {};
    if (extra.int === true) {
        const level = extra.opt === undefined ? 1 : Number(extra.opt);
        if (level !== 0 && level !== 1 && level !== 2) {
            console.error(`Error: --opt takes 0, 1 or 2, got: ${String(extra.opt)}`);
            process.exit(1);
        }
        intOptions = { level, shortCircuit: extra.shortCircuit === true };
    }

    await runCli({
        args,
        extensions: EXTENSIONS,
        description: ".td, .tbaf, and .tssl",
        processFile,
    });
}

main().catch((error) => {
    console.error("Error:", error.message);
    process.exit(1);
});
