/**
 * Unit tests for shared CLI utilities: reportDiff, safeProcess, findFiles,
 * parseCliArgs, and runCli check-mode exit behavior.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import * as path from "path";
import {
    checkFileSize,
    reportDiff,
    safeProcess,
    findFiles,
    loadExclusions,
    collectFiles,
    parseCliArgs,
    runCli,
    type FileResult,
    type OutputMode,
} from "../cli-utils";
import { REPO_ROOT } from "./repo-root";

describe("reportDiff", () => {
    let stderrSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
        stderrSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    });

    afterEach(() => {
        stderrSpy.mockRestore();
    });

    it("prints DIFF header with label", () => {
        reportDiff("test.txt", "a", "b");
        expect(stderrSpy).toHaveBeenCalledWith("DIFF: test.txt");
    });

    it("shows changed lines with prefixes", () => {
        reportDiff("f.txt", "line1\nline2\nline3", "line1\nchanged\nline3");
        expect(stderrSpy).toHaveBeenCalledWith("  - line2");
        expect(stderrSpy).toHaveBeenCalledWith("  + changed");
    });

    it("handles added lines (actual longer than expected)", () => {
        reportDiff("f.txt", "a", "a\nb");
        expect(stderrSpy).toHaveBeenCalledWith("  + b");
        expect(stderrSpy).not.toHaveBeenCalledWith(expect.stringContaining("(missing)"));
    });

    it("handles removed lines (expected longer than actual)", () => {
        reportDiff("f.txt", "a\nb", "a");
        expect(stderrSpy).toHaveBeenCalledWith("  - b");
        expect(stderrSpy).not.toHaveBeenCalledWith(expect.stringContaining("(missing)"));
    });

    it("only reports differing lines", () => {
        reportDiff("f.txt", "same\ndiff\nsame", "same\nother\nsame");
        const changeCalls = stderrSpy.mock.calls.filter(
            (c: unknown[]) => String(c[0]).startsWith("  - ") || String(c[0]).startsWith("  + "),
        );
        expect(changeCalls).toHaveLength(2);
        expect(changeCalls[0]![0]).toBe("  - diff");
        expect(changeCalls[1]![0]).toBe("  + other");
    });
});

describe("safeProcess", () => {
    let stderrSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
        stderrSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    });

    afterEach(() => {
        stderrSpy.mockRestore();
    });

    it("returns result from successful sync function", async () => {
        const result = await safeProcess("test.txt", () => "changed");
        expect(result).toBe("changed");
    });

    it("returns result from successful async function", async () => {
        const result = await safeProcess("test.txt", async (): Promise<FileResult> => "unchanged");
        expect(result).toBe("unchanged");
    });

    it("catches sync errors and returns 'error'", async () => {
        const result = await safeProcess("bad.txt", () => {
            throw new Error("parse failed");
        });
        expect(result).toBe("error");
        expect(stderrSpy).toHaveBeenCalledWith("bad.txt: parse failed");
    });

    it("catches async errors and returns 'error'", async () => {
        const result = await safeProcess("bad.txt", async () => {
            throw new Error("network timeout");
        });
        expect(result).toBe("error");
        expect(stderrSpy).toHaveBeenCalledWith("bad.txt: network timeout");
    });

    it("handles non-Error throws", async () => {
        const result = await safeProcess("bad.txt", () => {
            // eslint-disable-next-line no-throw-literal -- the point of this case is a non-Error throw
            throw "string error";
        });
        expect(result).toBe("error");
        expect(stderrSpy).toHaveBeenCalledWith("bad.txt: string error");
    });

    it("formats errors with full location as file:line:col prefix", async () => {
        const result = await safeProcess("fallback.txt", () => {
            throw Object.assign(new Error("syntax error"), {
                location: { file: "/path/to/src.txt", line: 42, column: 7 },
            });
        });
        expect(result).toBe("error");
        expect(stderrSpy).toHaveBeenCalledWith("/path/to/src.txt:42:7: syntax error");
    });

    it("uses fallback file path when location.file is missing", async () => {
        const result = await safeProcess("fallback.txt", () => {
            throw Object.assign(new Error("issue here"), { location: { line: 10 } });
        });
        expect(result).toBe("error");
        expect(stderrSpy).toHaveBeenCalledWith("fallback.txt:10: issue here");
    });

    it("formats with file only when location has neither line nor column", async () => {
        const result = await safeProcess("fallback.txt", () => {
            throw Object.assign(new Error("no position"), { location: { file: "src.txt" } });
        });
        expect(result).toBe("error");
        expect(stderrSpy).toHaveBeenCalledWith("src.txt: no position");
    });

    it("treats a location object with no usable fields as plain", async () => {
        const result = await safeProcess("plain.txt", () => {
            throw Object.assign(new Error("unstructured location"), { location: { irrelevant: true } });
        });
        expect(result).toBe("error");
        expect(stderrSpy).toHaveBeenCalledWith("plain.txt: unstructured location");
    });

    it("treats errors without location as plain", async () => {
        const result = await safeProcess("plain.txt", () => {
            throw new Error("nothing structured");
        });
        expect(result).toBe("error");
        expect(stderrSpy).toHaveBeenCalledWith("plain.txt: nothing structured");
    });
});

describe("findFiles", () => {
    const tmpDir = path.join(REPO_ROOT, "tmp/cli-test-findfiles");

    beforeEach(() => {
        fs.mkdirSync(path.join(tmpDir, "sub"), { recursive: true });
        fs.mkdirSync(path.join(tmpDir, "node_modules", "pkg"), { recursive: true });
        fs.writeFileSync(path.join(tmpDir, "a.ssl"), "");
        fs.writeFileSync(path.join(tmpDir, "b.baf"), "");
        fs.writeFileSync(path.join(tmpDir, "c.txt"), "");
        fs.writeFileSync(path.join(tmpDir, "sub", "d.ssl"), "");
        fs.writeFileSync(path.join(tmpDir, "sub", "e.baf"), "");
        fs.writeFileSync(path.join(tmpDir, "node_modules", "pkg", "ignored.map"), "");
        fs.writeFileSync(path.join(tmpDir, "node_modules", "pkg", "ignored.ssl"), "");
    });

    afterEach(() => {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    it("finds files matching extensions recursively", () => {
        const files = findFiles(tmpDir, [".ssl"]);
        const basenames = files.map((f) => path.basename(f)).sort();
        expect(basenames).toEqual(["a.ssl", "d.ssl"]);
    });

    it("supports multiple extensions", () => {
        const files = findFiles(tmpDir, [".ssl", ".baf"]);
        expect(files).toHaveLength(4);
    });

    it("ignores non-matching extensions", () => {
        const files = findFiles(tmpDir, [".tp2"]);
        expect(files).toHaveLength(0);
    });

    it("is case-insensitive for extensions", () => {
        fs.writeFileSync(path.join(tmpDir, "upper.SSL"), "");
        const files = findFiles(tmpDir, [".ssl"]);
        const basenames = files.map((f) => path.basename(f));
        expect(basenames).toContain("upper.SSL");
    });

    it("skips dependency directories like node_modules", () => {
        const files = findFiles(tmpDir, [".ssl", ".map"]);
        const basenames = files.map((f) => path.basename(f)).sort();
        expect(basenames).not.toContain("ignored.map");
        expect(basenames).not.toContain("ignored.ssl");
    });
});

describe("exclusions", () => {
    const tmpDir = path.join(REPO_ROOT, "tmp/cli-test-exclusions");
    const excludeFile = path.join(tmpDir, "excludes.txt");

    beforeEach(() => {
        fs.mkdirSync(path.join(tmpDir, "sub"), { recursive: true });
        fs.writeFileSync(path.join(tmpDir, "a.ssl"), "");
        fs.writeFileSync(path.join(tmpDir, "sub", "b.ssl"), "");
    });

    afterEach(() => {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    it("resolves entries against the base, ignoring comments and blank lines", () => {
        fs.writeFileSync(excludeFile, "# a comment\n\n  sub/b.ssl  \n");
        const excluded = loadExclusions(excludeFile, tmpDir);
        expect([...excluded]).toEqual([path.join(tmpDir, "sub", "b.ssl")]);
    });

    it("drops excluded files from the walk", () => {
        fs.writeFileSync(excludeFile, "sub/b.ssl\n");
        const files = collectFiles(
            {
                target: tmpDir,
                mode: "check-idempotency",
                recursive: true,
                quiet: true,
                jobs: 1,
                excludeFrom: excludeFile,
            },
            [".ssl"],
        );
        expect(files.map((f) => path.basename(f))).toEqual(["a.ssl"]);
    });

    it("resolves against excludeBase rather than the target when both are given", () => {
        // The entry is written relative to tmpDir while the walk targets tmpDir/sub - the shape the
        // external corpus uses, where one list serves targets at different depths. Without excludeBase
        // the same entry resolves under sub/ and matches nothing.
        fs.writeFileSync(excludeFile, "sub/b.ssl\n");
        const args = {
            target: path.join(tmpDir, "sub"),
            mode: "check-idempotency" as const,
            recursive: true,
            quiet: true,
            jobs: 1,
            excludeFrom: excludeFile,
        };
        expect(collectFiles({ ...args, excludeBase: tmpDir }, [".ssl"])).toEqual([]);
        expect(collectFiles(args, [".ssl"]).map((f) => path.basename(f))).toEqual(["b.ssl"]);
    });

    it("returns the full walk when no exclusion file is given", () => {
        const files = collectFiles(
            { target: tmpDir, mode: "check-idempotency", recursive: true, quiet: true, jobs: 1 },
            [".ssl"],
        );
        expect(files).toHaveLength(2);
    });
});

describe("parseCliArgs", () => {
    const originalArgv = process.argv;
    let exitSpy: ReturnType<typeof vi.spyOn>;
    // cac's outputHelp writes through console.info, so that is the stream --help has to be read on.
    let infoSpy: ReturnType<typeof vi.spyOn>;
    let errorSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
        exitSpy = vi.spyOn(process, "exit").mockImplementation(() => {
            throw new Error("exit");
        });
        infoSpy = vi.spyOn(console, "info").mockImplementation(() => {});
        errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    });

    afterEach(() => {
        process.argv = originalArgv;
        exitSpy.mockRestore();
        infoSpy.mockRestore();
        errorSpy.mockRestore();
    });

    it("parses save mode", () => {
        process.argv = ["node", "cli.js", __filename, "--save"];
        const args = parseCliArgs("help");
        expect(args?.mode).toBe("save");
    });

    it("parses check mode", () => {
        process.argv = ["node", "cli.js", __filename, "--check"];
        const args = parseCliArgs("help");
        expect(args?.mode).toBe("check");
    });

    it("defaults to stdout mode", () => {
        process.argv = ["node", "cli.js", __filename];
        const args = parseCliArgs("help");
        expect(args?.mode).toBe("stdout");
    });

    it("registers a caller's own options and returns their values in `extra`", () => {
        // Options belonging to one CLI rather than to all of them: registered here so cac still
        // validates them and --help still lists them, with the values kept out of CliArgs proper.
        process.argv = ["node", "cli.js", __filename, "--transpile", "--opt", "2"];
        const args = parseCliArgs("help", [
            ["--transpile", "Also write the readable text output"],
            ["--opt <level>", "Optimisation level"],
        ]);
        expect(args?.extra?.transpile).toBe(true);
        expect(String(args?.extra?.opt)).toBe("2");
    });

    it("leaves a caller option absent from `extra` when it is not passed", () => {
        process.argv = ["node", "cli.js", __filename];
        const args = parseCliArgs("help", [["--transpile", "Also write the readable text output"]]);
        expect(args?.extra?.transpile).toBeUndefined();
    });

    it("parses save-and-check mode", () => {
        process.argv = ["node", "cli.js", __filename, "--save-and-check"];
        const args = parseCliArgs("help");
        expect(args?.mode).toBe("save-and-check");
    });

    it("parses recursive flag -r", () => {
        process.argv = ["node", "cli.js", __dirname, "-r"];
        const args = parseCliArgs("help");
        expect(args?.recursive).toBe(true);
    });

    it("parses recursive flag --recursive", () => {
        process.argv = ["node", "cli.js", __dirname, "--recursive"];
        const args = parseCliArgs("help");
        expect(args?.recursive).toBe(true);
    });

    it("parses quiet flag", () => {
        process.argv = ["node", "cli.js", __filename, "-q"];
        const args = parseCliArgs("help");
        expect(args?.quiet).toBe(true);
    });

    it("returns null and prints the help text once, verbatim, on --help", () => {
        process.argv = ["node", "cli.js", "--help"];
        expect(parseCliArgs("Usage info")).toBeNull();
        // Registering the text with cac AND printing it here gave two copies, the cac one colon-suffixed.
        expect(infoSpy).toHaveBeenCalledTimes(1);
        expect(infoSpy).toHaveBeenCalledWith("Usage info");
    });

    it("exits on missing target", () => {
        process.argv = ["node", "cli.js", "--save"];
        expect(() => parseCliArgs("help")).toThrow("exit");
        expect(errorSpy).toHaveBeenCalledWith("Error: No file or directory specified");
    });

    it("exits on nonexistent target", () => {
        process.argv = ["node", "cli.js", "/nonexistent/path/xyz"];
        expect(() => parseCliArgs("help")).toThrow("exit");
        expect(errorSpy).toHaveBeenCalledWith("Error: Not found: /nonexistent/path/xyz");
    });

    it("defaults jobs to 1 and parses --jobs", () => {
        process.argv = ["node", "cli.js", __dirname, "-r"];
        expect(parseCliArgs("help")?.jobs).toBe(1);
        process.argv = ["node", "cli.js", __dirname, "-r", "--jobs", "4"];
        expect(parseCliArgs("help")?.jobs).toBe(4);
    });

    it("exits on a non-positive or non-numeric --jobs", () => {
        process.argv = ["node", "cli.js", __dirname, "-r", "--jobs", "0"];
        expect(() => parseCliArgs("help")).toThrow("exit");
        process.argv = ["node", "cli.js", __dirname, "-r", "--jobs", "many"];
        expect(() => parseCliArgs("help")).toThrow("exit");
        expect(errorSpy).toHaveBeenCalledWith("Error: --jobs must be a positive integer, got: many");
    });

    it("parses --files-from", () => {
        process.argv = ["node", "cli.js", __dirname, "-r", "--files-from", "list.txt"];
        expect(parseCliArgs("help")?.filesFrom).toBe("list.txt");
    });
});

describe("runCli", () => {
    let exitSpy: ReturnType<typeof vi.spyOn>;
    let logSpy: ReturnType<typeof vi.spyOn>;
    let errorSpy: ReturnType<typeof vi.spyOn>;
    const tmpDir = path.join(REPO_ROOT, "tmp/cli-test-runcli");

    beforeEach(() => {
        exitSpy = vi.spyOn(process, "exit").mockImplementation(() => {
            throw new Error("exit");
        });
        logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
        errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
        fs.mkdirSync(tmpDir, { recursive: true });
        fs.writeFileSync(path.join(tmpDir, "a.txt"), "content");
        fs.writeFileSync(path.join(tmpDir, "b.txt"), "content");
    });

    afterEach(() => {
        exitSpy.mockRestore();
        logSpy.mockRestore();
        errorSpy.mockRestore();
        fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    it("single file check mode: exits 1 on 'changed'", async () => {
        const processFile = vi.fn<(f: string, m: OutputMode) => FileResult>().mockReturnValue("changed");
        await expect(
            runCli({
                args: { target: path.join(tmpDir, "a.txt"), mode: "check", recursive: false, quiet: false, jobs: 1 },
                extensions: [".txt"],
                description: "test",
                processFile,
            }),
        ).rejects.toThrow("exit");
        expect(exitSpy).toHaveBeenCalledWith(1);
    });

    it("single file check mode: exits 1 on 'error'", async () => {
        const processFile = vi.fn<(f: string, m: OutputMode) => FileResult>().mockReturnValue("error");
        await expect(
            runCli({
                args: { target: path.join(tmpDir, "a.txt"), mode: "check", recursive: false, quiet: false, jobs: 1 },
                extensions: [".txt"],
                description: "test",
                processFile,
            }),
        ).rejects.toThrow("exit");
        expect(exitSpy).toHaveBeenCalledWith(1);
    });

    it("single file check mode: does not exit on 'unchanged'", async () => {
        const processFile = vi.fn<(f: string, m: OutputMode) => FileResult>().mockReturnValue("unchanged");
        await runCli({
            args: { target: path.join(tmpDir, "a.txt"), mode: "check", recursive: false, quiet: false, jobs: 1 },
            extensions: [".txt"],
            description: "test",
            processFile,
        });
        expect(exitSpy).not.toHaveBeenCalled();
    });

    it("single file stdout mode: does not exit on 'changed'", async () => {
        const processFile = vi.fn<(f: string, m: OutputMode) => FileResult>().mockReturnValue("changed");
        await runCli({
            args: { target: path.join(tmpDir, "a.txt"), mode: "stdout", recursive: false, quiet: false, jobs: 1 },
            extensions: [".txt"],
            description: "test",
            processFile,
        });
        expect(exitSpy).not.toHaveBeenCalled();
    });

    it("directory check mode: exits 1 when any file returns 'changed'", async () => {
        const processFile = vi
            .fn<(f: string, m: OutputMode) => FileResult>()
            .mockReturnValueOnce("unchanged")
            .mockReturnValueOnce("changed");
        await expect(
            runCli({
                args: { target: tmpDir, mode: "check", recursive: true, quiet: true, jobs: 1 },
                extensions: [".txt"],
                description: "test",
                processFile,
            }),
        ).rejects.toThrow("exit");
        expect(exitSpy).toHaveBeenCalledWith(1);
    });

    it("directory check mode: exits 1 on errors", async () => {
        const processFile = vi
            .fn<(f: string, m: OutputMode) => FileResult>()
            .mockReturnValueOnce("unchanged")
            .mockReturnValueOnce("error");
        await expect(
            runCli({
                args: { target: tmpDir, mode: "check", recursive: true, quiet: true, jobs: 1 },
                extensions: [".txt"],
                description: "test",
                processFile,
            }),
        ).rejects.toThrow("exit");
        expect(exitSpy).toHaveBeenCalledWith(1);
    });

    it("directory check mode: does not exit when all unchanged", async () => {
        const processFile = vi.fn<(f: string, m: OutputMode) => FileResult>().mockReturnValue("unchanged");
        await runCli({
            args: { target: tmpDir, mode: "check", recursive: true, quiet: true, jobs: 1 },
            extensions: [".txt"],
            description: "test",
            processFile,
        });
        expect(exitSpy).not.toHaveBeenCalled();
    });

    it("directory save mode: does not exit on 'changed'", async () => {
        const processFile = vi.fn<(f: string, m: OutputMode) => FileResult>().mockReturnValue("changed");
        await runCli({
            args: { target: tmpDir, mode: "save", recursive: true, quiet: true, jobs: 1 },
            extensions: [".txt"],
            description: "test",
            processFile,
        });
        expect(exitSpy).not.toHaveBeenCalled();
    });

    it("directory mode: requires -r flag", async () => {
        const processFile = vi.fn<(f: string, m: OutputMode) => FileResult>();
        await expect(
            runCli({
                args: { target: tmpDir, mode: "save", recursive: false, quiet: false, jobs: 1 },
                extensions: [".txt"],
                description: "test",
                processFile,
            }),
        ).rejects.toThrow("exit");
        expect(errorSpy).toHaveBeenCalledWith("Error: Target is a directory. Use -r for recursive.");
    });

    it("calls init before processing", async () => {
        const init = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);
        const processFile = vi.fn<(f: string, m: OutputMode) => FileResult>().mockReturnValue("unchanged");
        await runCli({
            args: { target: path.join(tmpDir, "a.txt"), mode: "stdout", recursive: false, quiet: false, jobs: 1 },
            extensions: [".txt"],
            description: "test",
            init,
            processFile,
        });
        expect(init).toHaveBeenCalledOnce();
        expect(processFile).toHaveBeenCalledOnce();
    });

    it("directory mode: exits 1 with a message when no matching files are found", async () => {
        const processFile = vi.fn<(f: string, m: OutputMode) => FileResult>();
        await expect(
            runCli({
                args: { target: tmpDir, mode: "save", recursive: true, quiet: false, jobs: 1 },
                extensions: [".xyz"],
                description: "test",
                processFile,
            }),
        ).rejects.toThrow("exit");
        expect(errorSpy).toHaveBeenCalledWith(`No test files found in ${tmpDir}`);
        expect(processFile).not.toHaveBeenCalled();
    });

    it("directory mode: logs the found-count and summary when not quiet", async () => {
        const processFile = vi
            .fn<(f: string, m: OutputMode) => FileResult>()
            .mockReturnValueOnce("changed")
            .mockReturnValueOnce("unchanged");
        await runCli({
            args: { target: tmpDir, mode: "save", recursive: true, quiet: false, jobs: 1 },
            extensions: [".txt"],
            description: "test",
            processFile,
        });
        expect(logSpy).toHaveBeenCalledWith("Found 2 test files");
        expect(logSpy).toHaveBeenCalledWith("\nSummary: 1 changed, 1 unchanged");
    });

    it("child mode (--files-from): processes the listed files, no summary, no check-mode exit", async () => {
        const listFile = path.join(tmpDir, "list.txt");
        fs.writeFileSync(listFile, `${path.join(tmpDir, "a.txt")}\n${path.join(tmpDir, "b.txt")}\n`);
        const processFile = vi
            .fn<(f: string, m: OutputMode) => FileResult>()
            .mockReturnValueOnce("changed")
            .mockReturnValueOnce("unchanged");
        await runCli({
            args: { target: tmpDir, mode: "check", recursive: true, quiet: false, jobs: 1, filesFrom: listFile },
            extensions: [".txt"],
            description: "test",
            processFile,
        });
        expect(processFile).toHaveBeenCalledTimes(2);
        expect(exitSpy).not.toHaveBeenCalled();
        expect(logSpy).not.toHaveBeenCalledWith(expect.stringContaining("Summary:"));
    });

    it("child mode (--files-from): exits 1 on the first error", async () => {
        const listFile = path.join(tmpDir, "list.txt");
        fs.writeFileSync(listFile, `${path.join(tmpDir, "a.txt")}\n${path.join(tmpDir, "b.txt")}\n`);
        const processFile = vi.fn<(f: string, m: OutputMode) => FileResult>().mockReturnValue("error");
        await expect(
            runCli({
                args: { target: tmpDir, mode: "save", recursive: true, quiet: true, jobs: 1, filesFrom: listFile },
                extensions: [".txt"],
                description: "test",
                processFile,
            }),
        ).rejects.toThrow("exit");
        expect(exitSpy).toHaveBeenCalledWith(1);
        expect(processFile).toHaveBeenCalledTimes(1);
    });
});

describe("runCli --jobs fan-out", () => {
    // runChild() re-invokes process.argv[1]; point it at the fixture child CLI
    // so the real spawn/spool/IPC/replay path runs against a controlled child.
    const fixtureCli = path.join(REPO_ROOT, "shared/cli/test/fixtures/jobs-child.cjs");
    const tmpDir = path.join(REPO_ROOT, "tmp/cli-test-jobs");
    const originalArgv = process.argv;
    let exitSpy: ReturnType<typeof vi.spyOn>;
    let logSpy: ReturnType<typeof vi.spyOn>;
    let stdoutSpy: ReturnType<typeof vi.spyOn>;
    let stderrSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
        exitSpy = vi.spyOn(process, "exit").mockImplementation(() => {
            throw new Error("exit");
        });
        logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
        stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
        stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
        fs.mkdirSync(tmpDir, { recursive: true });
        fs.writeFileSync(path.join(tmpDir, "a.txt"), "alpha");
        fs.writeFileSync(path.join(tmpDir, "b.txt"), "beta");
        // --jobs appears in both forms so stripJobsFlag's removal is exercised;
        // a leaked flag would make the fixture child re-fan-out.
        process.argv = ["node", fixtureCli, tmpDir, "-r", "--save", "--jobs", "2", "--jobs=2"];
    });

    afterEach(() => {
        process.argv = originalArgv;
        exitSpy.mockRestore();
        logSpy.mockRestore();
        stdoutSpy.mockRestore();
        stderrSpy.mockRestore();
        fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    const unusedProcessFile = () => {
        throw new Error("parent must not process files itself when fanning out");
    };

    it("processes every file through children and aggregates counts", async () => {
        // First replay write reports backpressure so the drain wait is exercised.
        stdoutSpy.mockImplementationOnce(() => {
            setTimeout(() => process.stdout.emit("drain"), 0);
            return false;
        });
        await runCli({
            args: { target: tmpDir, mode: "save", recursive: true, quiet: false, jobs: 2 },
            extensions: [".txt"],
            description: "test",
            processFile: unusedProcessFile,
        });
        expect(fs.readFileSync(path.join(tmpDir, "a.txt"), "utf-8")).toBe("ALPHA");
        expect(fs.readFileSync(path.join(tmpDir, "b.txt"), "utf-8")).toBe("BETA");
        const replayed = stdoutSpy.mock.calls.map((c: unknown[]) => String(c[0])).join("");
        expect(replayed).toContain("Processed:");
        expect(logSpy).toHaveBeenCalledWith("\nSummary: 2 changed, 0 unchanged");
        expect(exitSpy).not.toHaveBeenCalled();
    });

    it("skips the parent's init when fanning out", async () => {
        const init = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);
        await runCli({
            args: { target: tmpDir, mode: "save", recursive: true, quiet: true, jobs: 2 },
            extensions: [".txt"],
            description: "test",
            init,
            processFile: unusedProcessFile,
        });
        expect(init).not.toHaveBeenCalled();
    });

    it("exits 1 and forwards stderr when a child fails", async () => {
        fs.writeFileSync(path.join(tmpDir, "b.txt"), "fail me");
        await expect(
            runCli({
                args: { target: tmpDir, mode: "save", recursive: true, quiet: true, jobs: 2 },
                extensions: [".txt"],
                description: "test",
                processFile: unusedProcessFile,
            }),
        ).rejects.toThrow("exit");
        expect(exitSpy).toHaveBeenCalledWith(1);
        const forwarded = stderrSpy.mock.calls.map((c: unknown[]) => String(c[0])).join("");
        expect(forwarded).toContain("jobs-child: refusing");
    });

    it("check mode: exits 1 when children report changes", async () => {
        // The fixture reports every file as changed; check mode must aggregate
        // to a failing exit even though every child exited 0.
        await expect(
            runCli({
                args: { target: tmpDir, mode: "check", recursive: true, quiet: true, jobs: 2 },
                extensions: [".txt"],
                description: "test",
                processFile: unusedProcessFile,
            }),
        ).rejects.toThrow("exit");
        expect(exitSpy).toHaveBeenCalledWith(1);
    });

    it("still requires -r for a directory target", async () => {
        await expect(
            runCli({
                args: { target: tmpDir, mode: "save", recursive: false, quiet: true, jobs: 2 },
                extensions: [".txt"],
                description: "test",
                processFile: unusedProcessFile,
            }),
        ).rejects.toThrow("exit");
        expect(exitSpy).toHaveBeenCalledWith(1);
    });

    it("still exits 1 when no matching files are found", async () => {
        await expect(
            runCli({
                args: { target: tmpDir, mode: "save", recursive: true, quiet: true, jobs: 2 },
                extensions: [".xyz"],
                description: "test",
                processFile: unusedProcessFile,
            }),
        ).rejects.toThrow("exit");
        expect(exitSpy).toHaveBeenCalledWith(1);
    });
});

describe("checkFileSize", () => {
    let tmpDir: string;
    let errorSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
        tmpDir = fs.mkdtempSync(path.join("tmp", ".cli-checksize-"));
        errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    });

    afterEach(() => {
        fs.rmSync(tmpDir, { recursive: true, force: true });
        errorSpy.mockRestore();
    });

    it("accepts files within the per-extension cap", () => {
        const p = path.join(tmpDir, "a.ssl");
        fs.writeFileSync(p, "x".repeat(100));
        expect(checkFileSize(p, { ssl: 1024 })).toBe(true);
        expect(errorSpy).not.toHaveBeenCalled();
    });

    it("rejects files larger than the cap and logs the refusal", () => {
        const p = path.join(tmpDir, "a.ssl");
        fs.writeFileSync(p, "x".repeat(2000));
        expect(checkFileSize(p, { ssl: 1024 })).toBe(false);
        expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining(".ssl cap is 1024"));
    });

    it("passes through when the extension has no cap entry", () => {
        const p = path.join(tmpDir, "a.unknown");
        fs.writeFileSync(p, "x".repeat(10_000_000));
        expect(checkFileSize(p, { ssl: 1024 })).toBe(true);
    });

    it("treats extension comparison case-insensitively", () => {
        const p = path.join(tmpDir, "a.TP2");
        fs.writeFileSync(p, "x".repeat(100));
        expect(checkFileSize(p, { tp2: 1024 })).toBe(true);
    });

    it("rejects oversized files when extension key has no leading dot", () => {
        const p = path.join(tmpDir, "a.td");
        fs.writeFileSync(p, "x".repeat(2000));
        expect(checkFileSize(p, { td: 1024 })).toBe(false);
    });
});
