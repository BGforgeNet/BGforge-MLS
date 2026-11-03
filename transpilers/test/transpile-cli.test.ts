/**
 * Integration tests for the transpile CLI.
 * Runs the built transpile.js bundle as a child process to verify
 * exit codes, stdout output, and stderr diff reporting.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { spawnSync } from "child_process";
import * as fs from "fs";
import * as path from "path";
import transpileLibPackage from "../package.json";
import { REPO_ROOT } from "./repo-root";
import { SPAWN_TIMEOUT_MS } from "@bgforge/shared/spawn-timeout";

const CLI = path.join(REPO_ROOT, "transpilers", transpileLibPackage.bin.fgtp);
const NODE = process.execPath;
const SAMPLES_DIR = path.join(REPO_ROOT, "server/test/td/samples");
const SAMPLES_EXPECTED = path.join(REPO_ROOT, "server/test/td/samples-expected");

/**
 * Run the transpile CLI, returning exit code, stdout, stderr.
 *
 * `spawnSync` rather than `execFileSync`: the latter reports stderr only by throwing, so a run that exits 0
 * while warning would arrive here with its warning discarded.
 */
function run(...args: string[]): { code: number; stdout: string; stderr: string } {
    const result = spawnSync(NODE, ["--no-warnings", CLI, ...args], { encoding: "utf-8", timeout: SPAWN_TIMEOUT_MS });
    // A timeout leaves `status` null, which would otherwise read as an ordinary exit 1 and send the
    // reader hunting for an assertion bug instead of a hung CLI.
    if (result.error) throw result.error;
    return { code: result.status ?? 1, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
}

/** The generated and compiled files in a directory: what a refused run must not have written. */
function outputsIn(dir: string): string[] {
    return fs.readdirSync(dir).filter((name) => /\.(baf|d)$/.test(name));
}

describe("transpile CLI integration", () => {
    const tmpDir = path.join(REPO_ROOT, "tmp/cli-test-transpile");

    beforeEach(() => {
        if (!fs.existsSync(CLI)) {
            throw new Error("cli.js not built. Run: pnpm build:transpile");
        }
        fs.mkdirSync(tmpDir, { recursive: true });
        // What a mod has, so the type check the CLI runs by default sees the engine names the samples use.
        // `types: []` keeps the repo's @types/node out of it: its `Global` clashes with the stubs'.
        fs.writeFileSync(
            path.join(tmpDir, "tsconfig.json"),
            JSON.stringify({ compilerOptions: { types: [] }, include: ["**/*"] }),
        );
        fs.copyFileSync(path.join(REPO_ROOT, "server/test/td/td-engine-stubs.d.ts"), path.join(tmpDir, "stubs.d.ts"));
    });

    afterEach(() => {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    describe("smoke", () => {
        // Subprocess execution doesn't propagate v8 coverage, so the published
        // CLI entry point cannot be gated by a coverage threshold. The smoke
        // checks substitute by asserting the bundle starts, parses flags, and
        // exits cleanly before any feature test runs.
        it("exits 0 with --help", () => {
            const { code } = run("--help");
            expect(code).toBe(0);
        });

        it("prints a usage banner to stdout with --help", () => {
            const { stdout } = run("--help");
            expect(stdout).toContain("Usage: fgtp");
        });

        it("refuses a flag it does not know instead of taking the next argument as its value", () => {
            const file = path.join(tmpDir, "test.td");
            fs.writeFileSync(file, "");
            const { code, stderr } = run("--chekc", file);
            expect(code).toBe(1);
            expect(stderr).toContain("Error: Unknown option `--chekc`");
        });
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

        // A mapping that fails to swap the extension returns the INPUT path, which --save then overwrites
        // with the transpiled output - one-way, so unrecoverable. Hence the source-unchanged assertion.
        it("writes beside an uppercase-extension source without overwriting it", () => {
            const tdFile = path.join(SAMPLES_DIR, "botsmith.td");
            if (!fs.existsSync(tdFile)) return;

            const tmpTd = path.join(tmpDir, "Upper.TD");
            fs.copyFileSync(tdFile, tmpTd);
            const sourceBefore = fs.readFileSync(tmpTd, "utf-8");

            // The tsconfig's `include` does not match an uppercase extension, so the stubs would be out of
            // the check's sight; the output path is what this case is about.
            const { code } = run(tmpTd, "--save", "--no-typecheck");
            expect(code).toBe(0);
            expect(fs.existsSync(path.join(tmpDir, "Upper.d"))).toBe(true);
            expect(fs.readFileSync(tmpTd, "utf-8")).toBe(sourceBefore);
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

    describe("modes fgtp does not implement", () => {
        it.each(["--save-and-check", "--check-idempotency"])("refuses %s instead of printing the output", (flag) => {
            const tmpTd = path.join(tmpDir, "mode.td");
            fs.copyFileSync(path.join(SAMPLES_DIR, "botsmith.td"), tmpTd);

            const { code, stdout, stderr } = run(tmpTd, flag);
            expect(code).toBe(1);
            expect(stderr).toContain(`Error: ${flag} is not supported by this command`);
            expect(stdout).toBe("");
        });
    });

    describe("the type check it runs before transpiling", () => {
        const engine =
            "declare const Myself: string;\ndeclare function See(name: string): boolean;\n" +
            "declare function SmallWait(seconds: number): void;\n";
        const typo = "if (See(Mysefl)) {\n    SmallWait(1);\n}\n";

        beforeEach(() => {
            fs.writeFileSync(path.join(tmpDir, "engine.d.ts"), engine);
        });

        it("refuses a .tbaf that uses an identifier it does not bind, naming its position and writing nothing", () => {
            const file = path.join(tmpDir, "typo.tbaf");
            fs.writeFileSync(file, typo, "utf-8");

            const { code, stdout, stderr } = run(file, "--save");

            expect(code).toBe(1);
            expect(stderr).toContain(`${file}:1:9: error TS2552: Cannot find name 'Mysefl'. Did you mean 'Myself'?`);
            expect(stdout).not.toContain("Transpiled:");
            expect(outputsIn(tmpDir)).toStrictEqual([]);
        });

        it("refuses a .td that uses a name the TD API does not declare", () => {
            const file = path.join(tmpDir, "typo.td");
            fs.writeFileSync(file, 'begin("DLG", state("0", () => {\n    bogus();\n}));\n', "utf-8");

            const { code, stderr } = run(file, "--save");

            expect(code).toBe(1);
            expect(stderr).toContain(`${file}:2:5: error TS2304: Cannot find name 'bogus'.`);
            expect(outputsIn(tmpDir)).toStrictEqual([]);
        });

        it("transpiles the same script under --no-typecheck", () => {
            const file = path.join(tmpDir, "unchecked.tbaf");
            fs.writeFileSync(file, typo, "utf-8");

            expect(run(file, "--save", "--no-typecheck").code).toBe(0);
            expect(outputsIn(tmpDir)).toStrictEqual(["unchecked.baf"]);
        });

        it("says once when no tsconfig.json includes the scripts, and checks them with strict defaults", () => {
            const dir = path.join(tmpDir, "unconfigured");
            fs.mkdirSync(dir);
            // Excluded from the tsconfig above, as a script outside a mod's `include` is.
            fs.writeFileSync(
                path.join(tmpDir, "tsconfig.json"),
                JSON.stringify({ compilerOptions: { types: [] }, exclude: ["unconfigured"] }),
            );
            for (const name of ["one.tbaf", "two.tbaf"]) fs.writeFileSync(path.join(dir, name), "", "utf-8");

            const { code, stderr } = run(dir, "-r", "--save");

            expect(code).toBe(0);
            expect(stderr.split("No tsconfig.json includes")).toHaveLength(2);
            expect(stderr).toContain("; type-checking with strict defaults");
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
