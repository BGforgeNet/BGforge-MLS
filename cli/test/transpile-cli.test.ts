/**
 * Integration tests for the transpile CLI.
 * Runs the built transpile.js bundle as a child process to verify
 * exit codes, stdout output, and stderr diff reporting.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { execFileSync } from "child_process";
import * as fs from "fs";
import * as path from "path";
import transpileCliPackage from "../transpile/package.json";

const CLI = path.resolve("cli/transpile", transpileCliPackage.bin.fgtp);
const NODE = process.execPath;
const SAMPLES_DIR = path.resolve("server/test/td/samples");
const SAMPLES_EXPECTED = path.resolve("server/test/td/samples-expected");

/** Run the transpile CLI, returning exit code, stdout, stderr. */
function run(...args: string[]): { code: number; stdout: string; stderr: string } {
    try {
        const stdout = execFileSync(NODE, ["--no-warnings", CLI, ...args], {
            encoding: "utf-8",
            stdio: ["pipe", "pipe", "pipe"],
        });
        return { code: 0, stdout, stderr: "" };
    } catch (err: unknown) {
        const e = err as { status: number; stdout: string; stderr: string };
        return { code: e.status ?? 1, stdout: e.stdout ?? "", stderr: e.stderr ?? "" };
    }
}

describe("transpile CLI integration", () => {
    const tmpDir = path.resolve("tmp/cli-test-transpile");

    beforeEach(() => {
        if (!fs.existsSync(CLI)) {
            throw new Error("transpile.js not built. Run: pnpm build:transpile-cli");
        }
        fs.mkdirSync(tmpDir, { recursive: true });
    });

    afterEach(() => {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    describe("stdout mode", () => {
        it("outputs transpiled D content to stdout", () => {
            const sample = path.join(SAMPLES_DIR, "botsmith.td");
            if (!fs.existsSync(sample)) return;
            const { code, stdout } = run(sample);
            expect(code).toBe(0);
            expect(stdout.length).toBeGreaterThan(0);
            // TD produces WeiDU D output - should contain BEGIN or APPEND
            expect(stdout).toMatch(/BEGIN|APPEND/);
        });
    });

    describe("check mode", () => {
        it("exits 0 when output matches existing file", () => {
            const tdFile = path.join(SAMPLES_DIR, "botsmith.td");
            const expectedD = path.join(SAMPLES_EXPECTED, "botsmith.d");
            if (!fs.existsSync(tdFile) || !fs.existsSync(expectedD)) return;

            // Copy TD and matching D file to temp dir
            const tmpTd = path.join(tmpDir, "botsmith.td");
            const tmpD = path.join(tmpDir, "botsmith.d");
            fs.copyFileSync(tdFile, tmpTd);
            // Transpile once to get the exact output
            const { stdout } = run(tmpTd);
            fs.writeFileSync(tmpD, stdout);

            const { code } = run(tmpTd, "--check");
            expect(code).toBe(0);
        });

        it("exits 1 when output differs from existing file", () => {
            const tdFile = path.join(SAMPLES_DIR, "botsmith.td");
            if (!fs.existsSync(tdFile)) return;

            const tmpTd = path.join(tmpDir, "stale.td");
            const tmpD = path.join(tmpDir, "stale.d");
            fs.copyFileSync(tdFile, tmpTd);
            // Write stale/wrong content to .d file
            fs.writeFileSync(tmpD, "// stale content\n");

            const { code, stderr } = run(tmpTd, "--check");
            expect(code).toBe(1);
            expect(stderr).toContain("DIFF:");
        });

        it("shows line-by-line diff on stderr for stale output", () => {
            const tdFile = path.join(SAMPLES_DIR, "botsmith.td");
            if (!fs.existsSync(tdFile)) return;

            const tmpTd = path.join(tmpDir, "diff.td");
            const tmpD = path.join(tmpDir, "diff.d");
            fs.copyFileSync(tdFile, tmpTd);
            fs.writeFileSync(tmpD, "// old output\n");

            const { stderr } = run(tmpTd, "--check");
            expect(stderr).toContain("  - ");
            expect(stderr).toContain("  + ");
        });
    });

    describe("save mode", () => {
        it("writes transpiled output to .d file", () => {
            const tdFile = path.join(SAMPLES_DIR, "botsmith.td");
            if (!fs.existsSync(tdFile)) return;

            const tmpTd = path.join(tmpDir, "out.td");
            fs.copyFileSync(tdFile, tmpTd);

            const { code, stdout } = run(tmpTd, "--save");
            expect(code).toBe(0);
            expect(stdout).toContain("Transpiled:");
            expect(fs.existsSync(path.join(tmpDir, "out.d"))).toBe(true);
        });

        it("does not rewrite up-to-date output", () => {
            const tdFile = path.join(SAMPLES_DIR, "botsmith.td");
            if (!fs.existsSync(tdFile)) return;

            const tmpTd = path.join(tmpDir, "noop.td");
            fs.copyFileSync(tdFile, tmpTd);

            // First save creates the file
            run(tmpTd, "--save");
            // Second save should detect no change
            const { code, stdout } = run(tmpTd, "--save");
            expect(code).toBe(0);
            expect(stdout).not.toContain("Transpiled:");
        });
    });

    describe("error handling", () => {
        it("exits 1 for unsupported file type", () => {
            const file = path.join(tmpDir, "test.xyz");
            fs.writeFileSync(file, "content");
            const { code, stderr } = run(file);
            expect(code).toBe(1);
            expect(stderr).toContain("Unsupported file type");
        });

        it("exits 1 for nonexistent file", () => {
            const { code, stderr } = run("/nonexistent/file.td");
            expect(code).toBe(1);
            expect(stderr).toContain("Not found");
        });

        it("catches read errors gracefully via safeProcess", () => {
            const file = path.join(tmpDir, "unreadable.td");
            fs.writeFileSync(file, "const x = 1;");
            fs.chmodSync(file, 0o000);
            const { code, stderr } = run(file);
            expect(code).toBe(1);
            expect(stderr.length).toBeGreaterThan(0);
            // Restore for cleanup
            fs.chmodSync(file, 0o644);
        });
    });

    describe("directory mode", () => {
        it("requires -r flag", () => {
            const { code, stderr } = run(tmpDir);
            expect(code).toBe(1);
            expect(stderr).toContain("Use -r for recursive");
        });

        it("check mode exits 1 when any output is stale", () => {
            const tdFile = path.join(SAMPLES_DIR, "botsmith.td");
            if (!fs.existsSync(tdFile)) return;

            const tmpTd = path.join(tmpDir, "test.td");
            const tmpD = path.join(tmpDir, "test.d");
            fs.copyFileSync(tdFile, tmpTd);
            fs.writeFileSync(tmpD, "// stale\n");

            const { code } = run(tmpDir, "-r", "--check", "-q");
            expect(code).toBe(1);
        });
    });
});
