#!/usr/bin/env node
/**
 * CLI tool to parse Fallout PRO and MAP binary files and output structured JSON.
 * Also supports loading JSON back to binary via --load.
 * Usage: fgbin <file.pro|file.map|dir> [--save] [--check] [--load] [-r] [-q]
 */

import * as fs from "fs";
import * as path from "path";
import {
    parserRegistry,
    type ParseOptions,
    type ParseResult,
    getOutputPathForJsonSnapshot,
    getSnapshotPath,
    createBinaryJsonSnapshot,
    loadBinaryJsonSnapshot,
    parseBinaryJsonSnapshot,
    resolvePidSubType,
    loadProDirResolver,
    composePidResolvers,
} from "./index";
import {
    type FileResult,
    type OutputMode,
    parseCliArgs,
    runCli,
    safeProcess,
    reportDiff,
} from "../../shared/cli/cli-utils";

const EXTENSIONS = parserRegistry.getExtensions().map((ext) => `.${ext}`);
const CLI_PARSE_OPTIONS: ParseOptions = {
    gracefulMapBoundaries: process.argv.includes("--graceful-map"),
};
const CLI_QUIET = process.argv.includes("-q") || process.argv.includes("--quiet");

/**
 * Builds per-file ParseOptions, layering a sibling proto/ override resolver
 * on top of the bundled vanilla Fallout 2 table when the input is a MAP and
 * a `<map dir>/../proto/` tree exists. Reports stats to stderr (unless -q).
 */
function buildParseOptionsForFile(filePath: string): ParseOptions {
    if (path.extname(filePath).toLowerCase() !== ".map") {
        return CLI_PARSE_OPTIONS;
    }

    const protoBaseDir = path.resolve(path.dirname(filePath), "..", "proto");
    if (!fs.existsSync(protoBaseDir)) {
        return CLI_PARSE_OPTIONS;
    }

    const { resolver, stats } = loadProDirResolver(protoBaseDir);
    if (stats.filesScanned === 0) {
        return CLI_PARSE_OPTIONS;
    }

    if (!CLI_QUIET) {
        const errSuffix = stats.errors.length > 0 ? `, ${stats.errors.length} errors` : "";
        console.error(
            `Loaded ${stats.subtypesResolved} proto overrides from ${protoBaseDir} ` +
                `in ${stats.durationMs.toFixed(0)}ms${errSuffix}`,
        );
        for (const err of stats.errors) console.error(`  ${err}`);
    }

    return { ...CLI_PARSE_OPTIONS, pidResolver: composePidResolvers(resolver, resolvePidSubType) };
}

async function processFile(filePath: string, mode: OutputMode): Promise<FileResult> {
    return safeProcess(filePath, () => {
        const ext = path.extname(filePath);
        const parser = parserRegistry.getByExtension(ext);

        if (!parser) {
            console.error(`No parser for extension: ${ext} (${filePath})`);
            return "error";
        }

        const data = fs.readFileSync(filePath);
        const result = parser.parse(new Uint8Array(data), buildParseOptionsForFile(filePath));

        if (result.errors && result.errors.length > 0) {
            console.error(`Error parsing ${filePath}:`);
            for (const err of result.errors) {
                console.error(`  ${err}`);
            }
            return "error";
        }

        // Warnings are non-fatal: surface them to stderr but proceed with the
        // snapshot output. `parse` reserves `errors` for structural failures
        // that prevent display (size mismatch, truncation, unknown root type);
        // value-level oddities arrive in `warnings` and the canonical doc is
        // built permissively for them.
        if (result.warnings && result.warnings.length > 0) {
            console.error(`Warnings parsing ${filePath}:`);
            for (const w of result.warnings) {
                console.error(`  ${w}`);
            }
        }

        const json = createBinaryJsonSnapshot(result).trimEnd();
        const jsonPath = getSnapshotPath(filePath);

        if (mode === "save") {
            // Read with try/catch instead of existsSync→readFileSync to avoid
            // the TOCTOU window CodeQL js/file-system-race flags.
            let existing: string | null = null;
            try {
                existing = fs.readFileSync(jsonPath, "utf-8").trim();
            } catch (err) {
                if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
            }
            if (existing !== json) {
                fs.writeFileSync(jsonPath, json + "\n");
                console.log(`Saved: ${jsonPath}`);
                return "changed";
            }
            return "unchanged";
        } else if (mode === "check") {
            let expectedText: string;
            try {
                expectedText = fs.readFileSync(jsonPath, "utf-8");
            } catch (err) {
                if ((err as NodeJS.ErrnoException).code === "ENOENT") {
                    console.error(`Missing: ${jsonPath}`);
                    return "error";
                }
                throw err;
            }
            let expected = expectedText.trim();
            try {
                expected = createBinaryJsonSnapshot(parseBinaryJsonSnapshot(expectedText)).trimEnd();
            } catch {
                // Keep the raw text for malformed snapshots so diff reporting still helps.
            }
            if (json !== expected) {
                reportDiff(filePath, expected, json);
                return "changed";
            }
            return "unchanged";
        } else {
            process.stdout.write(json + "\n");
            return "unchanged";
        }
    });
}

const HELP = `Usage: fgbin <file.pro|file.map|dir> [--save] [--check] [--load] [-r] [-q]
  --save    Save parsed JSON alongside the binary file (.pro.json/.map.json)
  --check   Compare parsed output against existing JSON snapshot (exit 1 if diff)
  --load    Load JSON and write binary using the parser's native extension
  --graceful-map  Opt into permissive MAP boundary guessing for ambiguous files (default is strict;
                  required again on --load for JSON snapshots created from ambiguous MAP bytes)
  -r        Recursively process all supported files in directory
  -q        Quiet mode: suppress summary, only print errors

Examples:
  fgbin file.pro                  # Parse single file, print JSON to stdout
  fgbin proto/ -r --save          # Save JSON snapshots for all files
  fgbin proto/ -r -q --check      # Verify files match snapshots (CI)
  fgbin file.pro.json --load      # Convert JSON back to binary (.pro/.map/etc.)
  fgbin sfsheng.map.json --load --graceful-map
                                   # Reload an ambiguous MAP snapshot saved with --graceful-map`;

/**
 * Load a JSON file and serialize it back to binary format.
 * Validation and semantic round-trip checks happen inside the shared snapshot loader.
 */
function loadJsonToBinary(jsonPath: string): void {
    let jsonText: string;
    try {
        // Read with try/catch instead of existsSync→readFileSync to avoid
        // the TOCTOU window CodeQL js/file-system-race flags.
        jsonText = fs.readFileSync(jsonPath, "utf-8");
    } catch (err) {
        if ((err as NodeJS.ErrnoException).code === "ENOENT") {
            console.error(`Not found: ${jsonPath}`);
            process.exit(1);
        }
        throw err;
    }

    const loaded = loadBinaryJsonSnapshot(jsonText, {
        proParseOptions: CLI_PARSE_OPTIONS,
        mapParseOptions: CLI_PARSE_OPTIONS,
    });
    const result: ParseResult = loaded.parseResult;

    // Determine the parser from the format field
    const parser = parserRegistry.getById(result.format);
    if (!parser) {
        console.error(`Unknown format: ${result.format}`);
        process.exit(1);
    }
    if (!parser.serialize) {
        console.error(`Parser "${result.format}" does not support serialization`);
        process.exit(1);
    }

    const bytes = loaded.bytes ?? parser.serialize(result);

    const outputExtension = parser.extensions[0];
    if (!outputExtension) {
        console.error(`Parser "${result.format}" does not declare an output extension`);
        process.exit(1);
    }

    const outputPath = getOutputPathForJsonSnapshot(jsonPath, outputExtension);
    fs.writeFileSync(outputPath, bytes);
    console.log(`Wrote: ${outputPath} (${bytes.length} bytes)`);
}

async function main() {
    const argv = process.argv.slice(2);

    // Handle --load separately: it takes .json input, not .pro
    if (argv.includes("--load")) {
        const jsonPath = argv.find((a) => !a.startsWith("-"));
        if (!jsonPath) {
            console.error("Error: No file specified");
            process.exit(1);
        }
        loadJsonToBinary(jsonPath);
        return;
    }

    const args = parseCliArgs(HELP);
    if (!args) return;

    await runCli({
        args,
        extensions: EXTENSIONS,
        description: ".pro binary",
        processFile,
    });
}

main().catch((err) => {
    console.error("Error:", err.message);
    process.exit(1);
});
