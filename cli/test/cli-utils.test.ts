/**
 * Unit tests for shared CLI utilities: reportDiff, safeProcess, findFiles,
 * parseCliArgs, and runCli check-mode exit behavior.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import * as path from "path";
import { reportDiff, safeProcess, findFiles, parseCliArgs, runCli, FileResult, OutputMode } from "../cli-utils";

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

    it("shows changed lines with line numbers", () => {
        reportDiff("f.txt", "line1\nline2\nline3", "line1\nchanged\nline3");
        expect(stderrSpy).toHaveBeenCalledWith("  Line 2:");
        expect(stderrSpy).toHaveBeenCalledWith("    - line2");
        expect(stderrSpy).toHaveBeenCalledWith("    + changed");
    });

    it("handles added lines (actual longer than expected)", () => {
        reportDiff("f.txt", "a", "a\nb");
        expect(stderrSpy).toHaveBeenCalledWith("  Line 2:");
        expect(stderrSpy).toHaveBeenCalledWith('    - (missing)');
        expect(stderrSpy).toHaveBeenCalledWith("    + b");
    });

    it("handles removed lines (expected longer than actual)", () => {
        reportDiff("f.txt", "a\nb", "a");
        expect(stderrSpy).toHaveBeenCalledWith("  Line 2:");
        expect(stderrSpy).toHaveBeenCalledWith("    - b");
        expect(stderrSpy).toHaveBeenCalledWith('    + (missing)');
    });

    it("only reports differing lines", () => {
        reportDiff("f.txt", "same\ndiff\nsame", "same\nother\nsame");
        const lineCalls = stderrSpy.mock.calls.filter((c: unknown[]) => String(c[0]).includes("Line"));
        expect(lineCalls).toHaveLength(1);
        expect(lineCalls[0]![0]).toBe("  Line 2:");
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
            // eslint-disable-next-line @typescript-eslint/only-throw-error, no-throw-literal
            throw "string error";
        });
        expect(result).toBe("error");
        expect(stderrSpy).toHaveBeenCalledWith("bad.txt: string error");
    });
});

describe("findFiles", () => {
    const tmpDir = path.resolve("tmp/cli-test-findfiles");

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
        const basenames = files.map(f => path.basename(f)).sort();
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
        const basenames = files.map(f => path.basename(f));
        expect(basenames).toContain("upper.SSL");
    });

    it("skips dependency directories like node_modules", () => {
        const files = findFiles(tmpDir, [".ssl", ".map"]);
        const basenames = files.map(f => path.basename(f)).sort();
        expect(basenames).not.toContain("ignored.map");
        expect(basenames).not.toContain("ignored.ssl");
    });
});

describe("parseCliArgs", () => {
    const originalArgv = process.argv;
    let exitSpy: ReturnType<typeof vi.spyOn>;
    let logSpy: ReturnType<typeof vi.spyOn>;
    let errorSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
        exitSpy = vi.spyOn(process, "exit").mockImplementation(() => { throw new Error("exit"); });
        logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
        errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    });

    afterEach(() => {
        process.argv = originalArgv;
        exitSpy.mockRestore();
        logSpy.mockRestore();
        errorSpy.mockRestore();
    });

    it("parses save mode", () => {
        process.argv = ["node", "cli.js", "cli/test/cli-utils.test.ts", "--save"];
        const args = parseCliArgs("help");
        expect(args?.mode).toBe("save");
    });

    it("parses check mode", () => {
        process.argv = ["node", "cli.js", "cli/test/cli-utils.test.ts", "--check"];
        const args = parseCliArgs("help");
        expect(args?.mode).toBe("check");
    });

    it("defaults to stdout mode", () => {
        process.argv = ["node", "cli.js", "cli/test/cli-utils.test.ts"];
        const args = parseCliArgs("help");
        expect(args?.mode).toBe("stdout");
    });

    it("parses recursive flag -r", () => {
        process.argv = ["node", "cli.js", "cli/test", "-r"];
        const args = parseCliArgs("help");
        expect(args?.recursive).toBe(true);
    });

    it("parses recursive flag --recursive", () => {
        process.argv = ["node", "cli.js", "cli/test", "--recursive"];
        const args = parseCliArgs("help");
        expect(args?.recursive).toBe(true);
    });

    it("parses quiet flag", () => {
        process.argv = ["node", "cli.js", "cli/test/cli-utils.test.ts", "-q"];
        const args = parseCliArgs("help");
        expect(args?.quiet).toBe(true);
    });

    it("exits with help text on --help", () => {
        process.argv = ["node", "cli.js", "--help"];
        expect(() => parseCliArgs("Usage info")).toThrow("exit");
        expect(logSpy).toHaveBeenCalledWith("Usage info");
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
});

describe("runCli", () => {
    let exitSpy: ReturnType<typeof vi.spyOn>;
    let logSpy: ReturnType<typeof vi.spyOn>;
    let errorSpy: ReturnType<typeof vi.spyOn>;
    const tmpDir = path.resolve("tmp/cli-test-runcli");

    beforeEach(() => {
        exitSpy = vi.spyOn(process, "exit").mockImplementation(() => { throw new Error("exit"); });
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
        await expect(runCli({
            args: { target: path.join(tmpDir, "a.txt"), mode: "check", recursive: false, quiet: false },
            extensions: [".txt"],
            description: "test",
            processFile,
        })).rejects.toThrow("exit");
        expect(exitSpy).toHaveBeenCalledWith(1);
    });

    it("single file check mode: exits 1 on 'error'", async () => {
        const processFile = vi.fn<(f: string, m: OutputMode) => FileResult>().mockReturnValue("error");
        await expect(runCli({
            args: { target: path.join(tmpDir, "a.txt"), mode: "check", recursive: false, quiet: false },
            extensions: [".txt"],
            description: "test",
            processFile,
        })).rejects.toThrow("exit");
        expect(exitSpy).toHaveBeenCalledWith(1);
    });

    it("single file check mode: does not exit on 'unchanged'", async () => {
        const processFile = vi.fn<(f: string, m: OutputMode) => FileResult>().mockReturnValue("unchanged");
        await runCli({
            args: { target: path.join(tmpDir, "a.txt"), mode: "check", recursive: false, quiet: false },
            extensions: [".txt"],
            description: "test",
            processFile,
        });
        expect(exitSpy).not.toHaveBeenCalled();
    });

    it("single file stdout mode: does not exit on 'changed'", async () => {
        const processFile = vi.fn<(f: string, m: OutputMode) => FileResult>().mockReturnValue("changed");
        await runCli({
            args: { target: path.join(tmpDir, "a.txt"), mode: "stdout", recursive: false, quiet: false },
            extensions: [".txt"],
            description: "test",
            processFile,
        });
        expect(exitSpy).not.toHaveBeenCalled();
    });

    it("directory check mode: exits 1 when any file returns 'changed'", async () => {
        const processFile = vi.fn<(f: string, m: OutputMode) => FileResult>()
            .mockReturnValueOnce("unchanged")
            .mockReturnValueOnce("changed");
        await expect(runCli({
            args: { target: tmpDir, mode: "check", recursive: true, quiet: true },
            extensions: [".txt"],
            description: "test",
            processFile,
        })).rejects.toThrow("exit");
        expect(exitSpy).toHaveBeenCalledWith(1);
    });

    it("directory check mode: exits 1 on errors", async () => {
        const processFile = vi.fn<(f: string, m: OutputMode) => FileResult>()
            .mockReturnValueOnce("unchanged")
            .mockReturnValueOnce("error");
        await expect(runCli({
            args: { target: tmpDir, mode: "check", recursive: true, quiet: true },
            extensions: [".txt"],
            description: "test",
            processFile,
        })).rejects.toThrow("exit");
        expect(exitSpy).toHaveBeenCalledWith(1);
    });

    it("directory check mode: does not exit when all unchanged", async () => {
        const processFile = vi.fn<(f: string, m: OutputMode) => FileResult>().mockReturnValue("unchanged");
        await runCli({
            args: { target: tmpDir, mode: "check", recursive: true, quiet: true },
            extensions: [".txt"],
            description: "test",
            processFile,
        });
        expect(exitSpy).not.toHaveBeenCalled();
    });

    it("directory save mode: does not exit on 'changed'", async () => {
        const processFile = vi.fn<(f: string, m: OutputMode) => FileResult>().mockReturnValue("changed");
        await runCli({
            args: { target: tmpDir, mode: "save", recursive: true, quiet: true },
            extensions: [".txt"],
            description: "test",
            processFile,
        });
        expect(exitSpy).not.toHaveBeenCalled();
    });

    it("directory mode: requires -r flag", async () => {
        const processFile = vi.fn<(f: string, m: OutputMode) => FileResult>();
        await expect(runCli({
            args: { target: tmpDir, mode: "save", recursive: false, quiet: false },
            extensions: [".txt"],
            description: "test",
            processFile,
        })).rejects.toThrow("exit");
        expect(errorSpy).toHaveBeenCalledWith("Error: Target is a directory. Use -r for recursive.");
    });

    it("calls init before processing", async () => {
        const init = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);
        const processFile = vi.fn<(f: string, m: OutputMode) => FileResult>().mockReturnValue("unchanged");
        await runCli({
            args: { target: path.join(tmpDir, "a.txt"), mode: "stdout", recursive: false, quiet: false },
            extensions: [".txt"],
            description: "test",
            init,
            processFile,
        });
        expect(init).toHaveBeenCalledOnce();
        expect(processFile).toHaveBeenCalledOnce();
    });
});
