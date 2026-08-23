#!/usr/bin/env node
/**
 * The TSSL compiler's command line: TypeScript source to Fallout INT bytecode.
 *
 * A compiler rather than a transpiler, which is what the default output says: `.tssl` in, `.int` out,
 * with no SSL text in between - the TypeScript AST becomes the compiler's IR directly, so nothing here
 * loads the SSL grammar. Emitting SSL is one OPTION of it (`--transpile`), kept because the generated
 * text is readable, is what an external compiler can be pointed at, and is still what some mods ship.
 *
 * That option is a guarantee rather than an offer: `scripts/test-transpile-external.sh` compiles the
 * emitted SSL and byte-compares it against what this writes, at every optimisation level and with
 * short-circuiting both ways, so the two routes cannot drift apart unnoticed.
 */

import * as fs from "fs";
import * as path from "path";
import { EXT_TSSL } from "../../../shared/languages";
import { emitProgram } from "../../ssl/src/compile";
import { optimize } from "../../ssl/src/optimize";
import { createBatchState, transpile, type TranspileBatchState } from "./index";
import { lowerTsslProgram } from "./int/lower";
import {
    type FileResult,
    type OutputMode,
    checkFileSize,
    parseCliArgs,
    runCli,
    safeProcess,
    reportDiff,
} from "../../../shared/cli/cli-utils";

// A TSSL source is a TypeScript module; the largest in real mod corpora stay well under 200 KB. The cap
// is a defence against an oversized or truncated input triggering a large allocation before the parser
// sees it, mirroring the equivalent table in fgtp, fgbin and fgfmt.
const MAX_FILE_SIZES: Record<string, number> = { tssl: 8 * 1024 * 1024 };

interface CompileSwitches {
    level: 0 | 1 | 2;
    shortCircuit: boolean;
    /** Emit the readable SSL as well. Off by default: the bytecode is the product. */
    transpile: boolean;
}

let switches: CompileSwitches = { level: 1, shortCircuit: false, transpile: false };

/**
 * Shared across a run: one ts-morph project, and the inline extraction it caches. Standing one up costs
 * far more than compiling a script does, so both routes below take the same one rather than a fresh
 * project per file.
 */
const batch: TranspileBatchState = createBatchState();

function outputFor(filePath: string, extension: string): string {
    return filePath.slice(0, -EXT_TSSL.length) + extension;
}

/**
 * The file's current contents, or null when it does not exist yet.
 *
 * Read through try/catch rather than existsSync-then-read, which leaves the TOCTOU window CodeQL's
 * js/file-system-race flags.
 */
function readIfPresent(filePath: string): Buffer | null {
    try {
        return fs.readFileSync(filePath);
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        return null;
    }
}

async function processFile(filePath: string, mode: OutputMode): Promise<FileResult> {
    if (!filePath.toLowerCase().endsWith(EXT_TSSL)) {
        console.error(`Error: not a ${EXT_TSSL} source: ${filePath}`);
        return "error";
    }

    return safeProcess(filePath, async () => {
        if (!checkFileSize(filePath, MAX_FILE_SIZES)) return "error";
        const text = fs.readFileSync(filePath, "utf-8");
        const resolved = path.resolve(filePath);

        // `emitProgram` rather than the raw emitter: it reconciles the level with a `#pragma sce` and
        // with whether the optimiser removed the fall-through epilogue.
        const options = { level: switches.level, shortCircuit: switches.shortCircuit };
        const bytes = emitProgram(optimize(lowerTsslProgram(resolved, text, batch), options), options);
        const intPath = outputFor(filePath, ".int");
        const currentInt = readIfPresent(intPath);
        let changed = currentInt === null || !currentInt.equals(bytes);
        if (!changed) {
            console.log(`Up to date: ${path.basename(intPath)}`);
        } else if (mode === "check") {
            // Bytecode has no readable diff to print, so the report is what a reader can act on: which
            // side is missing, or by how much the two differ.
            const detail =
                currentInt === null ? "missing" : `${currentInt.length} bytes on disk, ${bytes.length} compiled`;
            console.error(`Stale: ${intPath} (${detail})`);
        } else {
            fs.writeFileSync(intPath, bytes);
            console.log(`Compiled: ${filePath} -> ${path.basename(intPath)}`);
        }

        if (!switches.transpile) return changed ? "changed" : "unchanged";

        const ssl = await transpile(resolved, text, batch);
        const sslPath = outputFor(filePath, ".ssl");
        const currentSsl = readIfPresent(sslPath)?.toString("utf-8") ?? null;
        if (currentSsl === ssl) return changed ? "changed" : "unchanged";
        changed = true;
        if (mode === "check") {
            reportDiff(filePath, currentSsl ?? "", ssl);
            return "changed";
        }
        fs.writeFileSync(sslPath, ssl, "utf-8");
        console.log(`Transpiled: ${filePath} -> ${path.basename(sslPath)}`);
        return "changed";
    });
}

const HELP = `Usage: tssl <file.tssl|dir> [--transpile] [--opt <0|1|2>] [-s] [--check] [-r] [-q] [--jobs <n>]
  Compiles TSSL to Fallout INT bytecode. No SSL text is produced or read on the way.

  --transpile       Also write the readable .ssl beside the bytecode
  --opt <0|1|2>     Optimisation level (default: 1, as the ssl compiler's own default)
  -s                Short-circuit and/or: skip the right operand once the left decides the result
  --check           Report stale output instead of writing it (exit 1 if any is stale)
  -r                Recurse into directories
  -q                Quiet mode: suppress the summary
  --jobs <n>        Process directory files with N parallel workers

Examples:
  tssl myscript.tssl                      # Write myscript.int
  tssl src/ -r --opt 2 -s                 # What a mod build wants
  tssl src/ -r --transpile                # Bytecode, keeping the readable .ssl beside it`;

async function main() {
    const args = parseCliArgs(HELP, [
        ["--transpile", "Also write the readable .ssl"],
        ["--opt <level>", "Optimisation level"],
        ["-s, --short-circuit", "Short-circuit and/or"],
    ]);
    if (!args) return;

    const extra = args.extra ?? {};
    const level = extra.opt === undefined ? 1 : Number(extra.opt);
    if (level !== 0 && level !== 1 && level !== 2) {
        console.error(`Error: --opt takes 0, 1 or 2, got: ${String(extra.opt)}`);
        process.exit(1);
    }
    switches = {
        level,
        shortCircuit: extra.shortCircuit === true,
        transpile: extra.transpile === true,
    };

    // One chunk per worker: a TSSL compile is dominated by standing up the TypeScript program, which a
    // child pays once and then reuses through `batch`. Cut finer, the parallel run spawns a process per
    // file and comes out slower than the sequential walk.
    await runCli({ args, extensions: [EXT_TSSL], description: EXT_TSSL, processFile, chunksPerJob: 1 });
}

main().catch((error) => {
    console.error("Error:", error.message);
    process.exit(1);
});
