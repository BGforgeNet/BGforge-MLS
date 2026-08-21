/**
 * The `tssl` CLI, driven as a subprocess.
 *
 * Bytecode is the DEFAULT here, which is the difference from a transpiler: `.tssl` in, `.int` out, and
 * the readable SSL only when `--transpile` asks for it.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { execFileSync } from "child_process";
import * as fs from "fs";
import * as path from "path";
import tsslPackage from "../package.json";
import { REPO_ROOT } from "../../../transpilers/test/repo-root";
import { SPAWN_TIMEOUT_MS } from "../../../shared/spawn-timeout";

const CLI = path.join(REPO_ROOT, "compilers/tssl", tsslPackage.bin.tssl);
const NODE = process.execPath;

/** Run the CLI, returning exit code, stdout, stderr. */
function run(...args: string[]): { code: number; stdout: string; stderr: string } {
    try {
        const stdout = execFileSync(NODE, ["--no-warnings", CLI, ...args], {
            encoding: "utf-8",
            stdio: ["pipe", "pipe", "pipe"],
            timeout: SPAWN_TIMEOUT_MS,
        });
        return { code: 0, stdout, stderr: "" };
    } catch (error: unknown) {
        const e = error as { status: number; stdout: string; stderr: string };
        return { code: e.status ?? 1, stdout: e.stdout ?? "", stderr: e.stderr ?? "" };
    }
}

describe("tssl CLI integration", () => {
    const tmpDir = path.join(REPO_ROOT, "tmp/cli-test-tssl");

    beforeEach(() => {
        if (!fs.existsSync(CLI)) throw new Error("cli.js not built. Run: pnpm build:tssl");
        fs.mkdirSync(tmpDir, { recursive: true });
    });

    afterEach(() => {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    it("exits 0 with --help", () => {
        expect(run("--help").code).toBe(0);
    });

    describe("bytecode is the default output", () => {
        const source = 'function start() {\n    display_msg("hi");\n}\n';

        /** A self-contained script: no imports, so nothing depends on a mod's node_modules. */
        function write(name: string): string {
            const file = path.join(tmpDir, name);
            fs.writeFileSync(file, source, "utf-8");
            return file;
        }

        it("writes bytecode and no .ssl at all", () => {
            const file = write("solo.tssl");
            const { code } = run(file);
            expect(code).toBe(0);
            const int = fs.readFileSync(file.replace(/\.tssl$/, ".int"));
            expect(int.length).toBeGreaterThan(0);
            expect(fs.existsSync(file.replace(/\.tssl$/, ".ssl"))).toBe(false);
        });

        it("keeps the readable SSL alongside when --transpile is given", () => {
            const file = write("both.tssl");
            const { code } = run(file, "--transpile");
            expect(code).toBe(0);
            expect(fs.existsSync(file.replace(/\.tssl$/, ".int"))).toBe(true);
            expect(fs.readFileSync(file.replace(/\.tssl$/, ".ssl"), "utf-8")).toContain("procedure start");
        });

        it("changes the bytes when the optimisation level changes", () => {
            // A procedure whose every path returns: -O2 drops the fall-through epilogue, -O0 keeps it.
            // Measured at 212 bytes against 194. An unreferenced procedure would NOT do - the program
            // model tree-shakes it before the optimiser ever sees it - nor would the trivial script
            // above, which gives the optimiser nothing to remove.
            const file = path.join(tmpDir, "opt.tssl");
            fs.writeFileSync(file, 'function start() {\n    display_msg("hi");\n    return 1;\n}\n', "utf-8");
            run(file, "--opt", "0");
            const unoptimised = fs.readFileSync(file.replace(/\.tssl$/, ".int"));
            run(file, "--opt", "2");
            const optimised = fs.readFileSync(file.replace(/\.tssl$/, ".int"));
            expect(Buffer.compare(unoptimised, optimised)).not.toBe(0);
        });

        it("refuses a level the compiler does not have", () => {
            const { code, stderr } = run(write("bad.tssl"), "--opt", "9");
            expect(code).toBe(1);
            expect(stderr).toContain("--opt takes 0, 1 or 2");
        });
    });

    // What actions/tssl runs with `check: true`, and what a mod's CI gates on.
    describe("--check reports stale output instead of writing it", () => {
        const source = 'function start() {\n    display_msg("hi");\n}\n';

        function write(name: string): string {
            const file = path.join(tmpDir, name);
            fs.writeFileSync(file, source, "utf-8");
            return file;
        }

        it("exits 1 when the bytecode is missing, and writes none", () => {
            const file = write("absent.tssl");
            const intPath = file.replace(/\.tssl$/, ".int");

            const { code, stderr } = run(file, "--check");

            expect(code).toBe(1);
            expect(stderr).toContain("missing");
            expect(fs.existsSync(intPath)).toBe(false);
        });

        // The half that matters: a check firing on correct input would fail every run of a mod's CI.
        it("exits 0 when the bytecode is current", () => {
            const file = write("current.tssl");
            expect(run(file, "--save").code).toBe(0);

            expect(run(file, "--check").code).toBe(0);
        });

        it("exits 1 on stale bytecode and leaves it as it found it", () => {
            const file = write("stale.tssl");
            const intPath = file.replace(/\.tssl$/, ".int");
            run(file, "--save");
            fs.writeFileSync(intPath, "not bytecode");

            const { code } = run(file, "--check");

            expect(code).toBe(1);
            expect(fs.readFileSync(intPath, "utf-8")).toBe("not bytecode");
        });

        it("checks the .ssl too when --transpile asks for one, without writing it", () => {
            const file = write("withssl.tssl");
            const sslPath = file.replace(/\.tssl$/, ".ssl");
            run(file, "--save");

            const { code } = run(file, "--check", "--transpile");

            expect(code).toBe(1);
            expect(fs.existsSync(sslPath)).toBe(false);
        });
    });
});
