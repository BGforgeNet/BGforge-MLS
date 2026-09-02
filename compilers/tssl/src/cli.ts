#!/usr/bin/env node
/**
 * The TSSL compiler's command line: TypeScript source to Fallout INT bytecode.
 *
 * A compiler rather than a transpiler, which is what the default output says: `.tssl` in, `.int` out,
 * with no SSL text in between - the TypeScript AST becomes the compiler's IR directly, so nothing here
 * loads the SSL grammar. Emitting SSL is an OPTION of it (`--ssl`), beside the bytecode or - with
 * `--no-int` - instead of it, kept because the generated text is readable, is what an external compiler
 * can be pointed at, and is still what some mods ship.
 *
 * That SSL is a guarantee rather than an offer: `scripts/test-transpile-external.sh` compiles the
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

/** What a run writes. `int` is the default: the bytecode is the product. */
type Emit = "int" | "int+ssl" | "ssl";

interface CompileSwitches {
    level: 0 | 1 | 2;
    shortCircuit: boolean;
    emit: Emit;
}

let switches: CompileSwitches = { level: 1, shortCircuit: false, emit: "int" };

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

        let changed = false;
        if (switches.emit !== "ssl") {
            // `emitProgram` rather than the raw emitter: it reconciles the level with a `#pragma sce` and
            // with whether the optimiser removed the fall-through epilogue.
            const options = { level: switches.level, shortCircuit: switches.shortCircuit };
            const bytes = emitProgram(optimize(lowerTsslProgram(resolved, text, batch), options), options);
            const intPath = outputFor(filePath, ".int");
            const currentInt = readIfPresent(intPath);
            changed = currentInt === null || !currentInt.equals(bytes);
            if (!changed) {
                console.log(`Up to date: ${path.basename(intPath)}`);
            } else if (mode === "check") {
                // Bytecode has no readable diff to print, so the report is what a reader can act on:
                // which side is missing, or by how much the two differ.
                const detail =
                    currentInt === null ? "missing" : `${currentInt.length} bytes on disk, ${bytes.length} compiled`;
                console.error(`Stale: ${intPath} (${detail})`);
            } else {
                fs.writeFileSync(intPath, bytes);
                console.log(`Compiled: ${filePath} -> ${path.basename(intPath)}`);
            }
        }

        if (switches.emit === "int") return changed ? "changed" : "unchanged";

        const ssl = await transpile(resolved, text, batch);
        const sslPath = outputFor(filePath, ".ssl");
        const currentSsl = readIfPresent(sslPath)?.toString("utf-8") ?? null;
        if (currentSsl === ssl) {
            // With no bytecode written there is no other line for this file, so say it is current.
            if (switches.emit === "ssl") console.log(`Up to date: ${path.basename(sslPath)}`);
            return changed ? "changed" : "unchanged";
        }
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

const HELP = `Usage: tssl <file.tssl|dir> [--ssl] [--no-int] [--opt <0|1|2>] [-s] [--check] [-r] [-q] [--jobs <n>]
  Compiles TSSL to Fallout INT bytecode. No SSL text is produced or read on the way.

  --ssl             Also write the readable .ssl (default: off)
  --no-int          Skip the bytecode, leaving only the .ssl (default: the .int is written)
  --opt <0|1|2>     Optimisation level (default: 1, as the ssl compiler's own default)
  -s                Short-circuit and/or: skip the right operand once the left decides the result
  --check           Report stale output instead of writing it (exit 1 if any is stale)
  -r                Recurse into directories
  -q                Quiet mode: suppress the summary
  --jobs <n>        Process directory files with N parallel workers

Examples:
  tssl myscript.tssl                      # Write myscript.int
  tssl src/ -r --opt 2 -s                 # What a mod build wants
  tssl src/ -r --ssl                      # Bytecode, keeping the readable .ssl beside it
  tssl src/ -r --ssl --no-int             # The readable .ssl alone, for a tree that commits it`;

/**
 * The two output switches, resolved. `int` defaults on and `--no-int` turns it off, which is how cac
 * spells a default-true flag; `--ssl` is off until asked for. Dropping both leaves nothing to write.
 */
function emitFor(extra: Record<string, unknown>): Emit {
    const int = extra.int !== false;
    const ssl = extra.ssl === true;
    if (!int && !ssl) {
        console.error("Error: --no-int without --ssl leaves nothing to write");
        process.exit(1);
    }
    if (!int) return "ssl";
    return ssl ? "int+ssl" : "int";
}

async function main() {
    const args = parseCliArgs(HELP, [
        ["--ssl", "Also write the readable .ssl"],
        ["--no-int", "Skip the bytecode"],
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
    const emit = emitFor(extra);
    // Both switches steer the bytecode emitter, which `--no-int` skips: the SSL text is written straight
    // from the TypeScript program, identical at every level. Warned rather than refused, so a build
    // setting the level globally can drop the bytecode without special-casing either switch.
    if (emit === "ssl" && (extra.opt !== undefined || extra.shortCircuit === true)) {
        console.warn("Warning: --opt and -s select how the bytecode is compiled, and no bytecode is written");
    }
    switches = { level, shortCircuit: extra.shortCircuit === true, emit };

    // One chunk per worker: a TSSL compile is dominated by standing up the TypeScript program, which a
    // child pays once and then reuses through `batch`. Cut finer, the parallel run spawns a process per
    // file and comes out slower than the sequential walk.
    await runCli({ args, extensions: [EXT_TSSL], description: EXT_TSSL, processFile, chunksPerJob: 1 });
}

main().catch((error) => {
    console.error("Error:", error.message);
    process.exit(1);
});
