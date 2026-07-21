/**
 * Shared CLI utilities for format, transpile, and bin CLIs.
 * Provides argument parsing, file discovery, batch processing, diff reporting,
 * and safe error-handling wrappers.
 */

import { spawn } from "child_process";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { pipeline } from "stream/promises";
import cac from "cac";
import { diffLines } from "diff";

export type FileResult = "changed" | "unchanged" | "error";
export type OutputMode = "save" | "stdout" | "check" | "save-and-check";

/**
 * Optional source-location metadata that error throwers can attach for
 * file:line:column formatting in CLI output. Duck-typed so this module does
 * not need to depend on any specific error class - the transpilers' own
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
    jobs: number;
    filesFrom?: string;
}

export function parseCliArgs(helpText: string): CliArgs | null {
    const cli = cac();
    cli.command("[target]", "File or directory to process")
        .option("--save", "Write output to files")
        .option("--check", "Check output without writing")
        .option("--save-and-check", "Write output and check for changes")
        .option("-r, --recursive", "Process directories recursively")
        .option("-q, --quiet", "Suppress informational output")
        .option("--jobs <n>", "Process directory files with N parallel workers")
        .option("--files-from <path>", "Process the newline-separated file list (internal, used by --jobs)")
        .action(() => {});
    cli.help(() => [{ title: helpText, body: "" }]);
    cli.parse(process.argv, { run: false });

    if (cli.options.help) {
        console.log(helpText);
        process.exit(0);
    }

    const target = cli.args[0] as string | undefined;
    const { save, check, saveAndCheck, recursive, quiet, jobs, filesFrom } = cli.options as {
        save: boolean;
        check: boolean;
        saveAndCheck: boolean;
        recursive: boolean;
        quiet: boolean;
        jobs?: number | string;
        filesFrom?: string;
    };

    if (!target) {
        console.error("Error: No file or directory specified");
        process.exit(1);
    }

    if (!fs.existsSync(target)) {
        console.error(`Error: Not found: ${target}`);
        process.exit(1);
    }

    const jobCount = jobs === undefined ? 1 : Number(jobs);
    if (!Number.isInteger(jobCount) || jobCount < 1) {
        console.error(`Error: --jobs must be a positive integer, got: ${jobs}`);
        process.exit(1);
    }

    const mode: OutputMode = saveAndCheck ? "save-and-check" : save ? "save" : check ? "check" : "stdout";

    return { target, mode, recursive: recursive ?? false, quiet: quiet ?? false, jobs: jobCount, filesFrom };
}

/**
 * Recursively collect absolute paths of files matching any of `extensions`
 * (each including the leading dot), skipping node_modules/.git. Deliberately
 * distinct from `server/src/path-utils.ts`'s `findFiles` (single extension,
 * fast-glob, paths relative to the search root): the CLIs feed absolute paths
 * straight to per-file processing. Different contracts, not unified.
 */
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

/**
 * Stat-then-cap guard: refuse to read files that exceed the per-extension
 * cap. Returns true if the file is within the cap (or the extension has no
 * cap entry), false after logging the refusal to stderr. fgbin uses an
 * equivalent inline check in its own CLI because the per-format max sizes
 * are tied to format-specific allocation hazards; fgfmt and fgtp use this
 * helper with a generic source-file cap.
 *
 * Pre-allocation defense, not validation: oversized inputs cause Node to
 * allocate a Buffer of declared size before header inspection. The hard
 * upper bound here keeps a truncated-or-malicious file from triggering an
 * unbounded read of the whole filesystem entry.
 */
export function checkFileSize(filePath: string, maxSizes: Record<string, number>): boolean {
    const ext = path.extname(filePath);
    const extKey = ext.startsWith(".") ? ext.slice(1).toLowerCase() : ext.toLowerCase();
    const maxSize = maxSizes[extKey];
    if (maxSize === undefined) return true;
    const stat = fs.statSync(filePath);
    if (stat.size > maxSize) {
        console.error(
            `File too large: ${stat.size} bytes (.${extKey} cap is ${maxSize}); refusing to read ${filePath}`,
        );
        return false;
    }
    return true;
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
    } catch (error) {
        if (error instanceof Error) {
            const loc = readLocation(error);
            if (loc !== undefined) {
                const file = loc.file ?? filePath;
                const linePart = loc.line !== undefined ? `:${loc.line}` : "";
                const colPart = loc.column !== undefined ? `:${loc.column}` : "";
                console.error(`${file}${linePart}${colPart}: ${error.message}`);
            } else {
                console.error(`${filePath}: ${error.message}`);
            }
        } else {
            console.error(`${filePath}: ${String(error)}`);
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

interface ChildCounts {
    changed: number;
    unchanged: number;
}

function readChildCounts(message: unknown): ChildCounts | undefined {
    if (typeof message !== "object" || message === null) return undefined;
    const obj = message as Record<string, unknown>;
    if (typeof obj.changed !== "number" || typeof obj.unchanged !== "number") return undefined;
    return { changed: obj.changed, unchanged: obj.unchanged };
}

/** Remove --jobs (both `--jobs N` and `--jobs=N` forms) from an argv slice. */
function stripJobsFlag(argv: string[]): string[] {
    const out: string[] = [];
    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i]!;
        if (arg === "--jobs") {
            i++;
            continue;
        }
        if (arg.startsWith("--jobs=")) continue;
        out.push(arg);
    }
    return out;
}

function runChild(
    childArgs: string[],
    stdoutSpool: string,
): Promise<{ code: number; stderr: string; counts?: ChildCounts }> {
    return new Promise((resolve) => {
        // stdout is spooled to a temp file rather than buffered in memory:
        // stdout-mode JSON for a large corpus can exceed V8's maximum string
        // length (GNU parallel's --keep-order spools for the same reason).
        // stderr stays in memory - it only carries diagnostics.
        const out = fs.openSync(stdoutSpool, "w");
        // process.execPath rather than a bare "node" PATH lookup: the CLI may
        // run on hosts where no node is on PATH (editor-bundled runtimes).
        const child = spawn(process.execPath, [process.argv[1]!, ...childArgs], {
            stdio: ["ignore", out, "pipe", "ipc"],
        });
        let stderr = "";
        let counts: ChildCounts | undefined;
        child.stderr!.on("data", (d: Buffer) => {
            stderr += d;
        });
        child.on("message", (m) => {
            counts = readChildCounts(m) ?? counts;
        });
        child.on("close", (code) => {
            fs.closeSync(out);
            resolve({ code: code ?? 1, stderr, counts });
        });
    });
}

/**
 * Fan a directory run out to N child processes, each re-invoking this same CLI
 * over a contiguous chunk of the file list via --files-from. The original argv
 * is passed through (minus --jobs) so CLI-specific extra flags survive, and
 * each child's spooled output is replayed in chunk order so the combined
 * output matches the sequential walk. Counts come back over the IPC channel.
 */
async function runParallelJobs(files: string[], args: CliArgs): Promise<void> {
    const jobs = Math.min(args.jobs, files.length);
    // Many more chunks than workers: per-file cost is highly skewed (one big
    // record can cost 1000x a small one), and with one contiguous chunk per
    // worker an expensive file cluster lands in a single child while the rest
    // idle. Small chunks pulled from a shared queue level that out while
    // keeping chunk-order output deterministic; contiguity preserves the
    // sequential walk order within and across chunks.
    const chunkSize = Math.max(1, Math.ceil(files.length / (jobs * 8)));
    const chunks: string[][] = [];
    for (let i = 0; i < files.length; i += chunkSize) {
        chunks.push(files.slice(i, i + chunkSize));
    }

    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "fgcli-jobs-"));
    try {
        const baseArgs = stripJobsFlag(process.argv.slice(2));
        const results: (Awaited<ReturnType<typeof runChild>> | undefined)[] = Array.from({
            length: chunks.length,
        });
        let nextChunk = 0;
        const runWorker = async (): Promise<void> => {
            while (nextChunk < chunks.length) {
                const i = nextChunk++;
                const listFile = path.join(tmpDir, `chunk-${i}.txt`);
                fs.writeFileSync(listFile, chunks[i]!.join("\n") + "\n");
                // eslint-disable-next-line no-await-in-loop
                results[i] = await runChild([...baseArgs, "--files-from", listFile], path.join(tmpDir, `stdout-${i}`));
            }
        };
        await Promise.all(Array.from({ length: jobs }, runWorker));

        let changed = 0;
        let unchanged = 0;
        let failed = false;
        for (let i = 0; i < results.length; i++) {
            // Non-null: the worker loop above assigned every index before Promise.all resolved.
            const result = results[i]!;
            const spool = path.join(tmpDir, `stdout-${i}`);
            if (fs.statSync(spool).size > 0) {
                // eslint-disable-next-line no-await-in-loop
                await pipeline(fs.createReadStream(spool), process.stdout, { end: false });
            }
            fs.rmSync(spool, { force: true });
            if (result.stderr) process.stderr.write(result.stderr);
            if (result.code !== 0) failed = true;
            if (result.counts) {
                changed += result.counts.changed;
                unchanged += result.counts.unchanged;
            }
        }

        if (failed) process.exit(1);
        if (args.mode === "check" && changed > 0) process.exit(1);
        if (!args.quiet) console.log(`\nSummary: ${changed} changed, ${unchanged} unchanged`);
    } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    }
}

export async function runCli(options: RunOptions): Promise<void> {
    const { args, extensions, description, init, processFile } = options;

    // Child mode (spawned by runParallelJobs): process the handed list with
    // the normal sequential loop and report counts back over IPC. No summary
    // and no check-mode early exit - the parent aggregates and decides.
    if (args.filesFrom !== undefined) {
        const files = fs
            .readFileSync(args.filesFrom, "utf-8")
            .split("\n")
            .filter((line) => line !== "");
        if (init) {
            await init();
        }
        let changed = 0,
            unchanged = 0;
        for (const file of files) {
            // eslint-disable-next-line no-await-in-loop
            const result = await processFile(file, args.mode);
            if (result === "error") process.exit(1);
            if (result === "changed") {
                changed++;
            } else {
                unchanged++;
            }
        }
        process.send?.({ changed, unchanged });
        return;
    }

    const stat = fs.statSync(args.target);

    if (stat.isDirectory() && args.jobs > 1) {
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
        // init() is skipped here: the parent only orchestrates, each child
        // initializes its own parsers.
        await runParallelJobs(files, args);
        return;
    }

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
            // Sequential processing - CLI mode needs deterministic output and
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
