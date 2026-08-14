/**
 * Integration tests for the ssl CLI.
 *
 * Runs the built bundle as a child process, which is the only way to cover what the library tests
 * cannot: the shebang and bundle start-up, the grammar loading from beside the bundle, output paths,
 * console reporting and exit codes. The switches themselves are covered against the reference
 * compiler's grammar in args.test.ts; here the question is whether they reach the compiler.
 */

import { spawnSync } from "child_process";
import * as fs from "fs";
import * as path from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { REPO_ROOT } from "../../../shared/cli/test/repo-root.ts";
import { SPAWN_TIMEOUT_MS } from "../../../shared/spawn-timeout.ts";

const CLI = path.join(REPO_ROOT, "compilers/ssl/out/cli.js");
const tmpDir = path.join(REPO_ROOT, "tmp/cli-test-ssl");

interface Run {
    code: number;
    stdout: string;
    stderr: string;
}

/** spawnSync rather than execFileSync: the CLI warns on stderr while still exiting 0, and execFileSync
 * hands back only stdout when the child succeeds. */
function run(...args: string[]): Run {
    const result = spawnSync(process.execPath, ["--no-warnings", CLI, ...args], {
        encoding: "utf-8",
        timeout: SPAWN_TIMEOUT_MS,
    });
    if (result.error) throw result.error;
    return { code: result.status ?? 1, stdout: result.stdout, stderr: result.stderr };
}

/** Writes a source file into the scratch directory and returns its path. */
function source(name: string, text: string): string {
    const file = path.join(tmpDir, name);
    fs.writeFileSync(file, text);
    return file;
}

const HELLO = 'procedure start begin\n   display_msg("hi");\nend\n';

describe("ssl CLI", () => {
    beforeEach(() => {
        if (!fs.existsSync(CLI)) throw new Error("compilers/ssl/out/cli.js not built. Run: pnpm build:ssl");
        fs.mkdirSync(tmpDir, { recursive: true });
    });

    afterEach(() => {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    describe("smoke", () => {
        // The bundle ships as its own artefact and cannot carry a coverage gate - subprocess runs are
        // invisible to in-process instrumentation. These stand in for it: a broken shebang, a missing
        // WASM file beside the bundle, or a start-up crash fails here before any feature test runs.
        it("exits 0 with --help", () => {
            const { code, stdout } = run("--help");
            expect(code).toBe(0);
            expect(stdout).toContain("Usage: ssl");
        });

        it("exits 1 with no arguments, printing the usage", () => {
            const { code, stdout } = run();
            expect(code).toBe(1);
            expect(stdout).toContain("Usage: ssl");
        });

        it("compiles a script to a loadable .int beside it", () => {
            const file = source("hello.ssl", HELLO);
            const { code } = run(file);
            expect(code).toBe(0);
            const bytes = fs.readFileSync(path.join(tmpDir, "hello.int"));
            expect(bytes.length).toBeGreaterThan(0);
        });
    });

    describe("output paths", () => {
        it("writes where -o says", () => {
            const file = source("hello.ssl", HELLO);
            const target = path.join(tmpDir, "elsewhere.int");
            expect(run(file, "-o", target).code).toBe(0);
            expect(fs.existsSync(target)).toBe(true);
            expect(fs.existsSync(path.join(tmpDir, "hello.int"))).toBe(false);
        });

        it("does not overwrite a source that is already called .int", () => {
            const file = source("hello.int", HELLO);
            expect(run(file).code).toBe(0);
            expect(fs.readFileSync(file, "utf-8")).toBe(HELLO);
            expect(fs.existsSync(path.join(tmpDir, "hello1.int"))).toBe(true);
        });

        it("compiles every input given, each to its own default name", () => {
            const first = source("one.ssl", HELLO);
            const second = source("two.ssl", HELLO);
            expect(run(first, second).code).toBe(0);
            expect(fs.existsSync(path.join(tmpDir, "one.int"))).toBe(true);
            expect(fs.existsSync(path.join(tmpDir, "two.int"))).toBe(true);
        });
    });

    describe("switches reaching the compiler", () => {
        const WITH_UNUSED = `variable unused := 5;\n${HELLO}`;

        it("removes an unreferenced variable at -O1 but not at -O0", () => {
            const file = source("unused.ssl", WITH_UNUSED);
            run("-O0", file, "-o", path.join(tmpDir, "none.int"));
            run("-O1", file, "-o", path.join(tmpDir, "some.int"));
            const none = fs.readFileSync(path.join(tmpDir, "none.int"));
            const some = fs.readFileSync(path.join(tmpDir, "some.int"));
            expect(some.length).toBeLessThan(none.length);
        });

        it("changes the emitted bytes for -s", () => {
            const file = source("logic.ssl", 'procedure start begin\n   if (1 and 0) then display_msg("x");\nend\n');
            run("-O0", file, "-o", path.join(tmpDir, "plain.int"));
            run("-O0", "-s", file, "-o", path.join(tmpDir, "short.int"));
            const plain = fs.readFileSync(path.join(tmpDir, "plain.int"));
            const short = fs.readFileSync(path.join(tmpDir, "short.int"));
            expect(short.equals(plain)).toBe(false);
        });

        it("defines a macro for -m", () => {
            const file = source("cond.ssl", `#ifdef GREET\n${HELLO}#else\nprocedure start begin end\n#endif\n`);
            expect(run("-P", "-mGREET", file).code).toBe(0);
            expect(fs.readFileSync(path.join(tmpDir, "cond.preprocessed.ssl"), "utf-8")).toContain("display_msg");
        });

        it("searches an -I directory for an include", () => {
            const headers = path.join(tmpDir, "headers");
            fs.mkdirSync(headers, { recursive: true });
            fs.writeFileSync(path.join(headers, "greet.h"), '#define GREETING "hi"\n');
            const file = source("uses.ssl", '#include "greet.h"\nprocedure start begin display_msg(GREETING); end\n');
            expect(run(`-I${headers}`, file).code).toBe(0);
        });

        it("writes preprocessed source and no .int for -P", () => {
            const file = source("hello.ssl", HELLO);
            expect(run("-P", file).code).toBe(0);
            expect(fs.existsSync(path.join(tmpDir, "hello.preprocessed.ssl"))).toBe(true);
            expect(fs.existsSync(path.join(tmpDir, "hello.int"))).toBe(false);
        });

        it("prints the program for -D and still writes the output", () => {
            const file = source("hello.ssl", HELLO);
            const { code, stdout } = run("-D", file);
            expect(code).toBe(0);
            expect(stdout).toContain("procedure start begin");
            expect(fs.existsSync(path.join(tmpDir, "hello.int"))).toBe(true);
        });

        it("suppresses the banner for -l", () => {
            const file = source("hello.ssl", HELLO);
            expect(run("-l", file).stdout).not.toContain("BGforge SSL compiler");
        });
    });

    describe("failures", () => {
        it("refuses -b rather than compiling something else", () => {
            const file = source("hello.ssl", HELLO);
            const { code, stderr } = run("-b", file);
            expect(code).toBe(1);
            expect(stderr).toContain("backward compatibility");
            expect(fs.existsSync(path.join(tmpDir, "hello.int"))).toBe(false);
        });

        it("fails on a missing input rather than exiting clean", () => {
            const { code, stderr } = run(path.join(tmpDir, "absent.ssl"));
            expect(code).toBe(1);
            expect(stderr).toContain("not found");
        });

        it("reports a syntax error with its position and writes nothing", () => {
            const file = source("broken.ssl", "procedure start begin\n   display_msg(;\nend\n");
            const { code, stderr } = run(file);
            expect(code).toBe(1);
            expect(stderr).toMatch(/broken\.ssl:\d+:\d+:/);
            expect(fs.existsSync(path.join(tmpDir, "broken.int"))).toBe(false);
        });

        it("counts the failures across several inputs", () => {
            const good = source("good.ssl", HELLO);
            const { code, stderr } = run(good, path.join(tmpDir, "absent.ssl"));
            expect(code).toBe(1);
            expect(stderr).toContain("(1 of them)");
        });

        it("warns about an unknown switch but compiles anyway", () => {
            const file = source("hello.ssl", HELLO);
            const { code, stderr } = run("-Z", file);
            expect(code).toBe(0);
            expect(stderr).toContain("Unknown option -Z");
            expect(fs.existsSync(path.join(tmpDir, "hello.int"))).toBe(true);
        });

        it("warns that -O3 is honoured as -O2", () => {
            const file = source("hello.ssl", HELLO);
            const { code, stderr } = run("-O3", file);
            expect(code).toBe(0);
            expect(stderr).toContain("-O3 is honoured as -O2");
        });
    });
});
