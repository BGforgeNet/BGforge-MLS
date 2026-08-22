#!/usr/bin/env node
/**
 * CLI tool to transpile TD and TBAF files to WeiDU D and BAF. Auto-detects language by file extension.
 * Usage: fgtp <file.td|file.tbaf|dir> [--save] [--check] [-r] [-q]
 *
 * `.tssl` is NOT handled here. It became a compiler in its own right - `@bgforge/tssl`, the `tssl` bin -
 * whose default output is INT bytecode with the SSL text as an option, which is not a shape this
 * transpile-and-write CLI can express.
 */

import * as fs from "fs";
import * as path from "path";
import { EXT_TD, EXT_TBAF } from "../common/extensions";
import { tbaf as transpileTBAF, td as transpileTD, outputPathFor } from "./index";
import {
    type FileResult,
    type OutputMode,
    checkFileSize,
    parseCliArgs,
    runCli,
    safeProcess,
    reportDiff,
} from "../../shared/cli/cli-utils";
type TranspileType = "td" | "tbaf";

const EXTENSIONS = [EXT_TD, EXT_TBAF];

// Per-extension input-size cap. TBAF/TD source files are TypeScript
// modules; even the largest mod source corpora keep them under 200 KB.
// The cap is a defense against an oversized or truncated input triggering
// a large Buffer allocation before the parser sees it. Mirrors fgbin's
// MAX_FILE_SIZES and fgfmt's equivalent table.
const MAX_FILE_SIZES: Record<string, number> = {
    tbaf: 8 * 1024 * 1024,
    td: 8 * 1024 * 1024,
};

function getTranspileType(filePath: string): TranspileType | null {
    const lower = filePath.toLowerCase();
    if (lower.endsWith(EXT_TD)) return "td";
    if (lower.endsWith(EXT_TBAF)) return "tbaf";
    return null;
}

async function processFile(filePath: string, mode: OutputMode): Promise<FileResult> {
    const type = getTranspileType(filePath);
    if (!type) {
        console.error(`Error: Unsupported file type: ${filePath} (expected ${EXT_TD} or ${EXT_TBAF})`);
        return "error";
    }

    return safeProcess(filePath, async () => {
        if (!checkFileSize(filePath, MAX_FILE_SIZES)) return "error";

        const text = fs.readFileSync(filePath, "utf-8");
        const resolved = path.resolve(filePath);

        let output: string;
        if (type === "td") {
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

const HELP = `Usage: fgtp <file.td|file.tbaf|dir> [--save] [--check] [--save-and-check] [-r] [-q]
  --save            Write output to file (default: stdout)
  --check           Check if output files are up to date (exit 1 if not)
  --save-and-check  Write output and verify the result is unchanged on a re-run
  -r                Recursively transpile all .td and .tbaf files in directory
  -q                Quiet mode: suppress summary, only print changed files
  --jobs <n>        Process directory files with N parallel workers

Examples:
  fgtp mydialog.td              # Print D output to stdout
  fgtp mydialog.td --save       # Write mydialog.d
  fgtp myscript.tbaf --save     # Write myscript.baf
  fgtp src/ -r --save           # Transpile all .td and .tbaf files
  fgtp src/ -r --check          # Check all outputs are up to date

  .tssl is compiled by the separate 'tssl' CLI (@bgforge/tssl), not by fgtp.`;

async function main() {
    const args = parseCliArgs(HELP);
    if (!args) return;

    await runCli({ args, extensions: EXTENSIONS, description: ".td and .tbaf", processFile });
}

main().catch((error) => {
    console.error("Error:", error.message);
    process.exit(1);
});
