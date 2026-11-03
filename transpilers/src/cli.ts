#!/usr/bin/env node
/**
 * CLI tool to transpile TD and TBAF files to WeiDU D and BAF. Auto-detects language by file extension.
 * Usage: fgtp <file.td|file.tbaf|dir> [--save] [--check] [--no-typecheck] [-r] [-q]
 *
 * `.tssl` is NOT handled here. It became a compiler in its own right - `@bgforge/tssl`, the `tssl` bin -
 * whose default output is INT bytecode with the SSL text as an option, which is not a shape this
 * transpile-and-write CLI can express.
 */

import * as fs from "fs";
import * as path from "path";
import { EXT_TD, EXT_TBAF } from "../common/extensions";
import { formatTypeError } from "../common/script-typecheck";
import { tbaf as transpileTBAF, td as transpileTD, outputPathFor } from "./index";
import { TranspilerTypechecker } from "./typecheck";
import {
    type FileResult,
    type OutputMode,
    checkFileSize,
    parseCliArgs,
    runCli,
    safeProcess,
    reportDiff,
    reportFatal,
} from "@bgforge/shared/cli/cli-utils";
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

let typecheck = true;

/** Shared across a run: one type-check program per tsconfig serves every script it includes. */
const typechecker = new TranspilerTypechecker();
let notedUnconfigured = false;

/** Reports a script's type errors and whether there were any; a script with errors is not transpiled. */
function typecheckFails(filePath: string): boolean {
    const result = typechecker.check(filePath);
    if (result.config === undefined && !notedUnconfigured) {
        notedUnconfigured = true;
        console.warn(`No tsconfig.json includes ${filePath}; type-checking with strict defaults`);
    }
    for (const error of result.errors) console.error(formatTypeError(error));
    return result.errors.length > 0;
}

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
        if (typecheck && typecheckFails(resolved)) return "error";

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

const HELP = `Usage: fgtp <file.td|file.tbaf|dir> [--save] [--check] [--no-typecheck] [-r] [-q] [--jobs <n>]
  Each script is type-checked first, against the tsconfig.json that includes it; one with errors is not transpiled.

  --save              Write output to file (default: stdout)
  --check             Check if output files are up to date (exit 1 if not)
  --no-typecheck      Transpile without the type check
  -r                  Recursively transpile all .td and .tbaf files in directory
  -q                  Quiet mode: suppress summary, only print changed files
  --jobs <n>          Process directory files with N parallel workers
  --exclude-from <p>  Skip the files listed in <p> (# comments and blanks ignored)
  --exclude-base <d>  Resolve --exclude-from entries against <d> (default: the target)

Examples:
  fgtp mydialog.td              # Print D output to stdout
  fgtp mydialog.td --save       # Write mydialog.d
  fgtp myscript.tbaf --save     # Write myscript.baf
  fgtp src/ -r --save           # Transpile all .td and .tbaf files
  fgtp src/ -r --check          # Check all outputs are up to date

  .tssl is compiled by the separate 'tssl' CLI (@bgforge/tssl), not by fgtp.`;

async function main() {
    const args = parseCliArgs(HELP, {
        extraOptions: [["--no-typecheck", "Transpile without the type check"]],
        modes: ["save", "check"],
    });
    if (!args) return;

    // cac spells a default-true flag `--no-x`.
    typecheck = args.extra?.typecheck !== false;

    await runCli({ args, extensions: EXTENSIONS, description: ".td and .tbaf", processFile });
}

main().catch(reportFatal);
