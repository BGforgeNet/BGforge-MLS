/**
 * Shared CLI utilities for format, transpile, and bin CLIs.
 * Provides argument parsing, file discovery, batch processing, diff reporting,
 * and safe error-handling wrappers.
 */

import * as fs from "fs";
import * as path from "path";
import cac from "cac";
import { diffLines } from "diff";

export type FileResult = "changed" | "unchanged" | "error";
export type OutputMode = "save" | "stdout" | "check" | "save-and-check";

/**
 * Optional source-location metadata that error throwers can attach for
 * file:line:column formatting in CLI output. Duck-typed so this module does
 * not need to depend on any specific error class — the transpilers' own
 * TranspileError satisfies the shape, and other domains can attach the same
 * fields without sharing a class hierarchy.
 */
interface LocatedErrorShape {
    readonly file?: string;
    readonly line?: number;
    readonly column?: number;
}

function readLocation(err: Error): LocatedErrorShape | undefined {
    // Error doesn't declare a `location` property; the cast acknowledges this
    // is a duck-typed read of an optional unknown field, which we then validate
    // structurally below before trusting it.
    const raw = (err as Error & { location?: unknown }).location;
    if (typeof raw !== "object" || raw === null) return undefined;
    // After the typeof guard above, raw is a non-null object; the Record cast
    // is the only way to index unknown keys on the `object` type.
    const obj = raw as Record<string, unknown>;
    const file = typeof obj.file === "string" ? obj.file : undefined;
    const line = typeof obj.line === "number" ? obj.line : undefined;
    const column = typeof obj.column === "number" ? obj.column : undefined;
    if (file === undefined && line === undefined && column === undefined) return undefined;
    return { file, line, column };
}

interface CliArgs {
    target: string;
    mode: OutputMode;
    recursive: boolean;
    quiet: boolean;
}

export function parseCliArgs(helpText: string): CliArgs | null {
    const cli = cac();
    cli.command("[target]", "File or directory to process")
        .option("--save", "Write output to files")
        .option("--check", "Check output without writing")
        .option("--save-and-check", "Write output and check for changes")
        .option("-r, --recursive", "Process directories recursively")
        .option("-q, --quiet", "Suppress informational output")
        .action(() => {});
    cli.help(() => [{ title: helpText, body: "" }]);
    cli.parse(process.argv, { run: false });

    if (cli.options.help) {
        console.log(helpText);
        process.exit(0);
    }

    const target = cli.args[0] as string | undefined;
    const { save, check, saveAndCheck, recursive, quiet } = cli.options as {
        save: boolean;
        check: boolean;
        saveAndCheck: boolean;
        recursive: boolean;
        quiet: boolean;
    };

    if (!target) {
        console.error("Error: No file or directory specified");
        process.exit(1);
    }

    if (!fs.existsSync(target)) {
        console.error(`Error: Not found: ${target}`);
        process.exit(1);
    }

    const mode: OutputMode = saveAndCheck ? "save-and-check" : save ? "save" : check ? "check" : "stdout";

    return { target, mode, recursive: recursive ?? false, quiet: quiet ?? false };
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
        } else if (extensions.some((ext) => entry.name.toLowerCase().endsWith(ext))) {
            files.push(fullPath);
        }
    }
    return files;
}

/** Prints a unified-diff style block between expected and actual content. */
export function reportDiff(label: string, expected: string, actual: string): void {
    console.error(`DIFF: ${label}`);
    const parts = diffLines(expected, actual);
    for (const p of parts) {
        if (!p.added && !p.removed) continue;
        const prefix = p.added ? "+" : "-";
        for (const line of p.value.split("\n")) {
            if (line !== "") console.error(`  ${prefix} ${line}`);
        }
    }
}

/** Wraps a processFile function in try/catch for consistent error handling. */
export async function safeProcess(filePath: string, fn: () => FileResult | Promise<FileResult>): Promise<FileResult> {
    try {
        return await fn();
    } catch (err) {
        if (err instanceof Error) {
            const loc = readLocation(err);
            if (loc !== undefined) {
                const file = loc.file ?? filePath;
                const linePart = loc.line !== undefined ? `:${loc.line}` : "";
                const colPart = loc.column !== undefined ? `:${loc.column}` : "";
                console.error(`${file}${linePart}${colPart}: ${err.message}`);
            } else {
                console.error(`${filePath}: ${err.message}`);
            }
        } else {
            console.error(`${filePath}: ${String(err)}`);
        }
        return "error";
    }
}

interface RunOptions {
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
        let changed = 0,
            unchanged = 0;

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
