/**
 * The `tssl` CLI, driven as a subprocess.
 *
 * Bytecode is the DEFAULT here, which is the difference from a transpiler: `.tssl` in, `.int` out, and
 * the readable SSL only when `--ssl` asks for it, beside the bytecode unless `--no-int` drops that.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { spawnSync } from "child_process";
import * as fs from "fs";
import * as path from "path";
import tsslPackage from "../package.json";
import { REPO_ROOT } from "../../../transpilers/test/repo-root";
import { SPAWN_TIMEOUT_MS } from "../../../shared/spawn-timeout";

const CLI = path.join(REPO_ROOT, "compilers/tssl", tsslPackage.bin.tssl);
const NODE = process.execPath;

/**
 * Run the CLI, returning exit code, stdout, stderr.
 *
 * `spawnSync` rather than `execFileSync`: the latter reports stderr only by throwing, so a run that
 * exits 0 while warning - which `--no-int` does - would arrive here with its warning discarded.
 */
function run(...args: string[]): { code: number; stdout: string; stderr: string } {
    const result = spawnSync(NODE, ["--no-warnings", CLI, ...args], {
        encoding: "utf-8",
        timeout: SPAWN_TIMEOUT_MS,
    });
    // A timeout leaves `status` null, which would otherwise read as an ordinary exit 1 and send the
    // reader hunting for an assertion bug instead of a hung CLI.
    if (result.error) throw result.error;
    return { code: result.status ?? 1, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
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

    describe("which outputs a run writes", () => {
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

        it("keeps the readable SSL alongside when --ssl is given", () => {
            const file = write("both.tssl");
            const { code } = run(file, "--ssl");
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

        it("writes the .ssl and no bytecode under --ssl --no-int, saying nothing about the switches", () => {
            const file = write("sslonly.tssl");
            const { code, stderr } = run(file, "--ssl", "--no-int");
            expect(code).toBe(0);
            expect(fs.readFileSync(file.replace(/\.tssl$/, ".ssl"), "utf-8")).toContain("procedure start");
            expect(fs.existsSync(file.replace(/\.tssl$/, ".int"))).toBe(false);
            // The warning below is conditional, so this run - which passes neither switch - must be quiet.
            expect(stderr).not.toContain("no bytecode is written");
        });

        // --jobs re-spawns this CLI per chunk, so the mode has to survive the hand-off to a child.
        it("carries --ssl --no-int into the workers a --jobs run spawns", () => {
            const dir = path.join(tmpDir, "parallel");
            fs.mkdirSync(dir, { recursive: true });
            // Two files against two jobs is one chunk each, so both children are exercised; more files
            // only add ts-morph startups to a suite that runs beside the corpus sweeps.
            for (const name of ["a.tssl", "b.tssl"]) fs.writeFileSync(path.join(dir, name), source, "utf-8");

            const { code } = run(dir, "-r", "--jobs", "2", "--ssl", "--no-int");

            expect(code).toBe(0);
            expect(fs.readdirSync(dir).sort()).toEqual(["a.ssl", "a.tssl", "b.ssl", "b.tssl"]);
        });

        it.each([["--opt", "2"], ["-s"]])(
            "warns that %s is inert under --no-int, and still writes the .ssl",
            (...bytecodeSwitch: string[]) => {
                const file = write("inert.tssl");
                const { code, stderr } = run(file, "--ssl", "--no-int", ...bytecodeSwitch);
                expect(code).toBe(0);
                expect(stderr).toContain("no bytecode is written");
                expect(fs.readFileSync(file.replace(/\.tssl$/, ".ssl"), "utf-8")).toContain("procedure start");
                expect(fs.existsSync(file.replace(/\.tssl$/, ".int"))).toBe(false);
            },
        );

        it("refuses --no-int without --ssl, which would write nothing at all", () => {
            const file = write("nooutput.tssl");
            const { code, stderr } = run(file, "--no-int");
            expect(code).toBe(1);
            expect(stderr).toContain("--no-int without --ssl");
            expect(fs.existsSync(file.replace(/\.tssl$/, ".ssl"))).toBe(false);
            expect(fs.existsSync(file.replace(/\.tssl$/, ".int"))).toBe(false);
        });
    });

    // The CLI's own check mode, for a caller that keeps compiled output in tree. actions/tssl does not
    // use it: a mod does not commit .int, so "missing" there is the normal state rather than staleness.
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

        it("checks the .ssl too when --ssl asks for one, without writing it", () => {
            const file = write("withssl.tssl");
            const sslPath = file.replace(/\.tssl$/, ".ssl");
            run(file, "--save");

            const { code } = run(file, "--check", "--ssl");

            expect(code).toBe(1);
            expect(fs.existsSync(sslPath)).toBe(false);
        });

        it("checks the .ssl alone under --no-int, ignoring the absent bytecode", () => {
            const file = write("sslcheck.tssl");
            expect(run(file, "--ssl", "--no-int").code).toBe(0);
            expect(fs.existsSync(file.replace(/\.tssl$/, ".int"))).toBe(false);

            // The half that matters: with no .int on disk, the run must still pass on the .ssl it has.
            expect(run(file, "--check", "--ssl", "--no-int").code).toBe(0);

            fs.writeFileSync(file.replace(/\.tssl$/, ".ssl"), "procedure stale begin end\n");
            expect(run(file, "--check", "--ssl", "--no-int").code).toBe(1);
        });
    });
});
