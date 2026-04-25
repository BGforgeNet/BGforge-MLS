#!/usr/bin/env node
/**
 * CLI tool to parse binary files (Fallout PRO) and output structured JSON.
 * Also supports loading JSON back to binary via --load.
 * Usage: node bin-cli.js <file.pro|file.map|dir> [--save] [--check] [--load] [-r] [-q]
 */

import * as fs from "fs";
import * as path from "path";
import { parserRegistry, type ParseOptions, type ParseResult } from "../../../client/src/parsers";
import { getOutputPathForJsonSnapshot, getSnapshotPath } from "../../../client/src/parsers/json-snapshot-path";
import {
    createBinaryJsonSnapshot,
    loadBinaryJsonSnapshot,
    parseBinaryJsonSnapshot,
} from "../../../client/src/parsers/json-snapshot";
import { type FileResult, type OutputMode, parseCliArgs, runCli, safeProcess, reportDiff } from "../../cli-utils";

const EXTENSIONS = parserRegistry.getExtensions().map((ext) => `.${ext}`);
const CLI_PARSE_OPTIONS: ParseOptions = {
    gracefulMapBoundaries: process.argv.includes("--graceful-map"),
};

async function processFile(filePath: string, mode: OutputMode): Promise<FileResult> {
    return safeProcess(filePath, () => {
        const ext = path.extname(filePath);
        const parser = parserRegistry.getByExtension(ext);

        if (!parser) {
            console.error(`No parser for extension: ${ext} (${filePath})`);
            return "error";
        }

        const data = fs.readFileSync(filePath);
        const result = parser.parse(new Uint8Array(data), CLI_PARSE_OPTIONS);

        if (result.errors && result.errors.length > 0) {
            console.error(`Error parsing ${filePath}:`);
            for (const err of result.errors) {
                console.error(`  ${err}`);
            }
            return "error";
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

const HELP = `Usage: bin-cli <file.pro|file.map|dir> [--save] [--check] [--load] [-r] [-q]
  --save    Save parsed JSON alongside the binary file (.pro.json/.map.json)
  --check   Compare parsed output against existing JSON snapshot (exit 1 if diff)
  --load    Load JSON and write binary using the parser's native extension
  --graceful-map  Opt into permissive MAP boundary guessing for ambiguous files (default is strict;
                  required again on --load for JSON snapshots created from ambiguous MAP bytes)
  -r        Recursively process all supported files in directory
  -q        Quiet mode: suppress summary, only print errors

Examples:
  bin-cli file.pro                  # Parse single file, print JSON to stdout
  bin-cli proto/ -r --save          # Save JSON snapshots for all files
  bin-cli proto/ -r -q --check      # Verify files match snapshots (CI)
  bin-cli file.pro.json --load      # Convert JSON back to binary (.pro/.map/etc.)
  bin-cli sfsheng.map.json --load --graceful-map
                                   # Reload an ambiguous MAP snapshot saved with --graceful-map`;

/**
 * Load a JSON file and serialize it back to binary format.
 * Validation and semantic round-trip checks happen inside the shared snapshot loader.
 */
function loadJsonToBinary(jsonPath: string): void {
    if (!fs.existsSync(jsonPath)) {
        console.error(`Not found: ${jsonPath}`);
        process.exit(1);
    }

    const jsonText = fs.readFileSync(jsonPath, "utf-8");
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
