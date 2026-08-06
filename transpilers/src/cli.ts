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

const HELP = `Usage: fgtp <file.td|file.tbaf|file.tssl|dir> [--save] [--check] [--save-and-check] [-r] [-q]
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
  fgtp src/ -r --save           # Transpile all .td, .tbaf, and .tssl files
  fgtp src/ -r --check          # Check all outputs are up to date`;

async function main() {
    const args = parseCliArgs(HELP);
    if (!args) return;

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
