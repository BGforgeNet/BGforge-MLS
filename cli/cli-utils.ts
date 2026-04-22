/**
 * Shared CLI utilities for format, transpile, and bin CLIs.
 * Provides argument parsing, file discovery, batch processing, diff reporting,
 * and safe error-handling wrappers.
 */

import * as fs from "fs";
import * as path from "path";
import { TranspileError } from "../transpilers/common/transpile-error";

export type FileResult = "changed" | "unchanged" | "error";
export type OutputMode = "save" | "stdout" | "check" | "save-and-check";

export interface CliArgs {
    target: string;
    mode: OutputMode;
    recursive: boolean;
    quiet: boolean;
}

export function parseCliArgs(helpText: string): CliArgs | null {
    const args = process.argv.slice(2);

    if (args.length === 0 || args.includes("--help") || args.includes("-h")) {
        console.log(helpText);
        process.exit(0);
    }

    const target = args.find(a => !a.startsWith("-"));
    const save = args.includes("--save");
    const check = args.includes("--check");
    const saveAndCheck = args.includes("--save-and-check");
    const recursive = args.includes("-r") || args.includes("--recursive");
    const quiet = args.includes("-q") || args.includes("--quiet");

    if (!target) {
        console.error("Error: No file or directory specified");
        process.exit(1);
    }

    if (!fs.existsSync(target)) {
        console.error(`Error: Not found: ${target}`);
        process.exit(1);
    }

    const mode: OutputMode = saveAndCheck ? "save-and-check" : save ? "save" : check ? "check" : "stdout";

    return { target, mode, recursive, quiet };
}

export function findFiles(dir: string, extensions: readonly string[]): string[] {
    const files: string[] = [];
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            if (entry.name === "node_modules" || entry.name === ".git") {
                continue;
            }
            files.push(...findFiles(fullPath, extensions));
        } else if (extensions.some(ext => entry.name.toLowerCase().endsWith(ext))) {
            files.push(fullPath);
        }
    }
    return files;
}

/** Prints a compact line-by-line diff between expected and actual content. */
export function reportDiff(label: string, expected: string, actual: string): void {
    console.error(`DIFF: ${label}`);
    const expectedLines = expected.split("\n");
    const actualLines = actual.split("\n");
    const maxLines = Math.max(expectedLines.length, actualLines.length);
    for (let i = 0; i < maxLines; i++) {
        if (expectedLines[i] !== actualLines[i]) {
            console.error(`  Line ${i + 1}:`);
            console.error(`    - ${expectedLines[i] ?? "(missing)"}`);
            console.error(`    + ${actualLines[i] ?? "(missing)"}`);
        }
    }
}

/** Wraps a processFile function in try/catch for consistent error handling. */
export async function safeProcess(
    filePath: string,
    fn: () => FileResult | Promise<FileResult>,
): Promise<FileResult> {
    try {
        return await fn();
    } catch (err) {
        if (err instanceof TranspileError) {
            const loc = err.location;
            const file = loc.file ?? filePath;
            const linePart = loc.line !== undefined ? `:${loc.line}` : "";
            const colPart = loc.column !== undefined ? `:${loc.column}` : "";
            console.error(`${file}${linePart}${colPart}: ${err.message}`);
        } else {
            const msg = err instanceof Error ? err.message : String(err);
            console.error(`${filePath}: ${msg}`);
        }
        return "error";
    }
}

export interface RunOptions {
    args: CliArgs;
    extensions: readonly string[];
    description: string;
    init?: () => Promise<void>;
    processFile: (filePath: string, mode: OutputMode) => Promise<FileResult> | FileResult;
}

export async function runCli(options: RunOptions): Promise<void> {
    const { args, extensions, description, init, processFile } = options;
    const stat = fs.statSync(args.target);

    if (init) {
        await init();
    }

    if (stat.isDirectory()) {
        if (!args.recursive) {
            console.error("Error: Target is a directory. Use -r for recursive.");
            process.exit(1);
        }

        const files = findFiles(args.target, extensions);
        if (files.length === 0) {
            console.error(`No ${description} files found in ${args.target}`);
            process.exit(1);
        }

        if (!args.quiet) console.log(`Found ${files.length} ${description} files`);
        let changed = 0, unchanged = 0;

        for (const file of files) {
            // Sequential processing — CLI mode needs deterministic output and
            // early exit on first mismatch in check mode.
            // eslint-disable-next-line no-await-in-loop
            const result = await processFile(file, args.mode);
            if (result === "error") process.exit(1);
            if (result === "changed") {
                // In check mode, exit on first mismatch
                if (args.mode === "check") process.exit(1);
                changed++;
            } else {
                unchanged++;
            }
        }

        if (!args.quiet) console.log(`\nSummary: ${changed} changed, ${unchanged} unchanged`);
    } else {
        const result = await processFile(args.target, args.mode);
        if (result === "error") process.exit(1);
        if (args.mode === "check" && result === "changed") process.exit(1);
    }
}
