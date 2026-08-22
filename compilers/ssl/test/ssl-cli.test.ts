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

    describe("decompiling", () => {
        /** Compiles HELLO and returns the path of the .int it produced. */
        function compiled(stem: string): string {
            const target = path.join(tmpDir, `${stem}.int`);
            const { code } = run(source(`${stem}-src.ssl`, HELLO), "-o", target);
            expect(code).toBe(0);
            return target;
        }

        it("writes source beside the compiled script it read", () => {
            const { code } = run("-x", compiled("built"));
            expect(code).toBe(0);
            expect(fs.readFileSync(path.join(tmpDir, "built.ssl"), "utf-8")).toContain("procedure start begin");
        });

        it("recovers source that compiles back to the bytes it came from", () => {
            const target = compiled("round");
            const before = fs.readFileSync(target);
            expect(run("-x", target).code).toBe(0);

            const again = path.join(tmpDir, "again.int");
            expect(run(path.join(tmpDir, "round.ssl"), "-o", again).code).toBe(0);
            expect(fs.readFileSync(again)).toEqual(before);
        });

        it("counts what came back under -d, which a byte size cannot show", () => {
            // A decompile always produces plausible-looking source, so its size says nothing about
            // whether the whole file returned. The counts are what a thin recovery shows up in.
            const { stdout } = run("-l", "-d", "-x", compiled("counted"));
            expect(stdout).toContain("1 procedure, 1 string");
        });

        it("writes an instruction listing for -X", () => {
            const { code } = run("-X", compiled("dis"));
            expect(code).toBe(0);
            const listing = fs.readFileSync(path.join(tmpDir, "dis.lst"), "utf-8");
            expect(listing).toContain("; globals section at");
            expect(listing).toContain("start:");
        });

        it("still lists a file too damaged to decompile, which is what a listing is for", () => {
            // Truncating leaves a header and a code section that stops mid-instruction: the decompiler
            // cannot structure it, and the listing is the honest floor that still says what is in there.
            const target = compiled("torn");
            const whole = fs.readFileSync(target);
            fs.writeFileSync(target, whole.subarray(0, -8));

            expect(run("-x", target).code).toBe(1);
            expect(run("-X", target).code).toBe(0);
            expect(fs.readFileSync(path.join(tmpDir, "torn.lst"), "utf-8")).toContain("; globals section at");
        });
    });

    describe("switches that do nothing", () => {
        it("says so, more quietly than a warning", () => {
            const { code, stderr } = run("-q", source("noop.ssl", HELLO));
            expect(code).toBe(0);
            expect(stderr).toContain("Note: -q does nothing here");
        });

        it("stays silent under -n, which is what a build script that cannot drop the switch has", () => {
            const { code, stderr } = run("-q", "-n", source("quiet.ssl", HELLO));
            expect(code).toBe(0);
            expect(stderr).not.toContain("does nothing here");
        });
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

        it("reports an error below directives on the line the author wrote", () => {
            // The compiler positions errors in the preprocessed text, where the two defines have
            // vanished - unmapped, this would say line 2.
            const file = source("drift.ssl", "#define X 9\n#define Y 8\nprocedure start begin\n bogus := 1;\nend\n");
            const { code, stderr } = run(file);
            expect(code).toBe(1);
            expect(stderr).toContain("drift.ssl:4:2: unknown identifier 'bogus'");
        });

        it("blames an included header's own line for an error inside it", () => {
            source("bad-hdr.h", "variable ok := 1;\nvariable bad[10];\n");
            const file = source("includes.ssl", '#include "bad-hdr.h"\nprocedure start begin end\n');
            const { code, stderr } = run(file);
            expect(code).toBe(1);
            expect(stderr).toMatch(/bad-hdr\.h:2:\d+: array declarations are only allowed on a local variable/);
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

/**
 * The pool exists to spend more cores, not to compile differently, so what these pin is SAMENESS: the
 * bytes, the transcript and the exit code a parallel run produces must be the ones a sequential run
 * produces. A schedule-dependent transcript would be the first thing to break, and only across enough
 * inputs that the workers finish out of order - hence a batch rather than a pair.
 */
describe("ssl CLI batch compilation", () => {
    beforeEach(() => {
        if (!fs.existsSync(CLI)) throw new Error("compilers/ssl/out/cli.js not built. Run: pnpm build:ssl");
        fs.mkdirSync(tmpDir, { recursive: true });
    });

    afterEach(() => {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    /** Distinct sources, so a mixed-up result would show as wrong bytes rather than as coincidentally equal. */
    function batch(count: number): string[] {
        return Array.from({ length: count }, (_, i) =>
            source(`batch${i}.ssl`, `procedure start begin\n   display_msg("script ${i}");\nend\n`),
        );
    }

    function outputs(files: readonly string[]): Record<string, string> {
        const out: Record<string, string> = {};
        for (const file of files) {
            const int = file.replace(/\.ssl$/, ".int");
            out[path.basename(int)] = fs.readFileSync(int).toString("base64");
        }
        return out;
    }

    it("produces the same bytes, transcript and exit code in parallel as sequentially", () => {
        const files = batch(12);

        const sequential = run("-l", "-q", "-O2", "-j1", ...files);
        expect(sequential.code).toBe(0);
        const sequentialOut = outputs(files);
        for (const file of files) fs.rmSync(file.replace(/\.ssl$/, ".int"));

        const parallel = run("-l", "-q", "-O2", "-j4", ...files);
        expect(parallel.code).toBe(sequential.code);
        expect(parallel.stdout).toBe(sequential.stdout);
        expect(parallel.stderr).toBe(sequential.stderr);
        expect(outputs(files)).toEqual(sequentialOut);
        // Not vacuous: every input really was compiled, rather than the run failing identically twice.
        expect(Object.keys(sequentialOut)).toHaveLength(12);
    });

    it("compiles the inputs after a failing one and counts the failure", () => {
        const good = source("after-ok.ssl", HELLO);
        const broken = source("broken.ssl", "procedure start begin\n   nosuchthing();\nend\n");
        const alsoGood = source("after-ok2.ssl", HELLO);

        const result = run("-l", "-q", "-O2", broken, good, alsoGood);
        expect(result.code).toBe(1);
        expect(result.stderr).toMatch(/THERE WERE ERRORS \(1 of them\)/);
        // The reference abandons the batch here; both later inputs must still have been compiled.
        expect(fs.existsSync(good.replace(/\.ssl$/, ".int"))).toBe(true);
        expect(fs.existsSync(alsoGood.replace(/\.ssl$/, ".int"))).toBe(true);
        expect(fs.existsSync(broken.replace(/\.ssl$/, ".int"))).toBe(false);
    });

    it("reports each input in the order it was given, whatever order the workers finish in", () => {
        const files = batch(8);
        const result = run("-l", "-q", "-O2", "-j4", ...files);
        expect(result.code).toBe(0);
        const reported = result.stdout
            .split("\n")
            .filter((line) => line.startsWith("Compiling "))
            .map((line) => path.basename(line.slice("Compiling ".length)));
        expect(reported).toEqual(files.map((file) => path.basename(file)));
    });
});
