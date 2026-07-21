/**
 * Integration tests for the format CLI.
 * Runs the built format-cli.js bundle as a child process to verify
 * exit codes, stdout output, and stderr diff reporting.
 */

import { describe, it, expect, beforeAll, beforeEach, afterEach } from "vitest";
import { execFileSync } from "child_process";
import * as fs from "fs";
import * as path from "path";

const CLI = path.resolve("format/out/cli.js");
const NODE = process.execPath;

/** Run the format CLI, returning exit code, stdout, stderr. */
function run(...args: string[]): { code: number; stdout: string; stderr: string } {
    try {
        const stdout = execFileSync(NODE, ["--no-warnings", CLI, ...args], {
            encoding: "utf-8",
            stdio: ["pipe", "pipe", "pipe"],
        });
        return { code: 0, stdout, stderr: "" };
    } catch (error: unknown) {
        const e = error as { status: number; stdout: string; stderr: string };
        return { code: e.status ?? 1, stdout: e.stdout ?? "", stderr: e.stderr ?? "" };
    }
}

describe("format CLI integration", () => {
    const tmpDir = path.resolve("tmp/cli-test-format");

    beforeEach(() => {
        if (!fs.existsSync(CLI)) {
            throw new Error("format/out/cli.js not built. Run: pnpm build:format");
        }
        fs.mkdirSync(tmpDir, { recursive: true });
    });

    afterEach(() => {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    describe("smoke", () => {
        // Each release CLI ships as its own published artefact but cannot carry
        // a numeric v8 coverage gate - subprocess instrumentation via
        // child_process does not capture in-process coverage. The smoke checks
        // substitute by asserting the bundle starts, parses flags, and exits
        // cleanly. A broken shebang, missing bundle, or startup crash fails here
        // before any feature test runs.
        it("exits 0 with --help", () => {
            const { code } = run("--help");
            expect(code).toBe(0);
        });

        it("prints a usage banner to stdout with --help", () => {
            const { stdout } = run("--help");
            expect(stdout).toContain("Usage: format-cli");
        });
    });

    describe("stdout mode", () => {
        it("outputs formatted content to stdout", () => {
            // Valid BAF with wrong indentation (content is preserved, only whitespace changes)
            const input = "IF\nTrue()\nTHEN\n  RESPONSE #100\n  NoAction()\nEND\n";
            const file = path.join(tmpDir, "test.baf");
            fs.writeFileSync(file, input);
            const { code, stdout } = run(file);
            expect(code).toBe(0);
            expect(stdout.length).toBeGreaterThan(0);
        });
    });

    describe("check mode", () => {
        const sampleDir = path.resolve("grammars/weidu-baf/test/samples-expected");
        let samples: string[];

        beforeAll(() => {
            samples = fs.readdirSync(sampleDir);
            if (samples.length === 0) {
                throw new Error(`Expected formatted BAF samples in ${sampleDir} but directory is empty`);
            }
        });

        it("exits 0 for already-formatted file", () => {
            const file = path.join(sampleDir, samples[0]!);
            const { code } = run(file, "--check");
            expect(code).toBe(0);
        });

        it("exits 1 for unformatted file", () => {
            // Valid BAF with wrong indentation
            const input = "IF\nTrue()\nTHEN\n  RESPONSE #100\n  NoAction()\nEND\n";
            const file = path.join(tmpDir, "bad.baf");
            fs.writeFileSync(file, input);
            const { code, stderr } = run(file, "--check");
            expect(code).toBe(1);
            expect(stderr).toContain("DIFF:");
        });

        it("shows line-by-line diff on stderr", () => {
            const input = "IF\nTrue()\nTHEN\n  RESPONSE #100\n  NoAction()\nEND\n";
            const file = path.join(tmpDir, "diff.baf");
            fs.writeFileSync(file, input);
            const { stderr } = run(file, "--check");
            expect(stderr).toContain("  - ");
            expect(stderr).toContain("  + ");
        });
    });

    describe("save mode", () => {
        it("writes formatted output back to file", () => {
            const input = "IF\nTrue()\nTHEN\n  RESPONSE #100\n  NoAction()\nEND\n";
            const file = path.join(tmpDir, "save.baf");
            fs.writeFileSync(file, input);
            const { code, stdout } = run(file, "--save");
            expect(code).toBe(0);
            expect(stdout).toContain("Formatted:");
            const result = fs.readFileSync(file, "utf-8");
            expect(result).not.toBe(input);
        });

        it("does not rewrite already-formatted file", () => {
            const sampleDir = path.resolve("grammars/weidu-baf/test/samples-expected");
            const allSamples = fs.readdirSync(sampleDir);
            if (allSamples.length === 0) {
                throw new Error(`Expected formatted BAF samples in ${sampleDir} but directory is empty`);
            }
            const src = path.join(sampleDir, allSamples[0]!);
            const file = path.join(tmpDir, allSamples[0]!);
            fs.copyFileSync(src, file);
            const { code, stdout } = run(file, "--save");
            expect(code).toBe(0);
            expect(stdout).not.toContain("Formatted:");
        });
    });

    describe("directory mode", () => {
        it("requires -r flag", () => {
            const { code, stderr } = run(tmpDir);
            expect(code).toBe(1);
            expect(stderr).toContain("Use -r for recursive");
        });

        it("check mode exits 1 when files need formatting", () => {
            const input = "IF\nTrue()\nTHEN\n  RESPONSE #100\n  NoAction()\nEND\n";
            fs.writeFileSync(path.join(tmpDir, "a.baf"), input);
            const { code } = run(tmpDir, "-r", "--check", "-q");
            expect(code).toBe(1);
        });

        it("prints summary in non-quiet mode", () => {
            const input = "IF\nTrue()\nTHEN\n  RESPONSE #100\n  NoAction()\nEND\n";
            fs.writeFileSync(path.join(tmpDir, "a.baf"), input);
            const { stdout } = run(tmpDir, "-r", "--save");
            expect(stdout).toContain("Summary:");
        });
    });

    describe("--jobs mode", () => {
        const unformattedBaf = "IF\nTrue()\nTHEN\n  RESPONSE #100\n  NoAction()\nEND\n";
        const unformattedTra = "@ 1  =  ~Messy whitespace~\n";

        /** Two subdirs with a mix of formatted-needed files, mirrored into two trees. */
        function makeTree(root: string): void {
            fs.mkdirSync(path.join(root, "sub-a"), { recursive: true });
            fs.mkdirSync(path.join(root, "sub-b"), { recursive: true });
            fs.writeFileSync(path.join(root, "sub-a", "one.baf"), unformattedBaf);
            fs.writeFileSync(path.join(root, "sub-a", "two.tra"), unformattedTra);
            fs.writeFileSync(path.join(root, "sub-b", "three.baf"), unformattedBaf);
            fs.writeFileSync(path.join(root, "sub-b", "four.tra"), unformattedTra);
        }

        function treeContents(root: string): Record<string, string> {
            const out: Record<string, string> = {};
            for (const sub of ["sub-a", "sub-b"]) {
                for (const name of fs.readdirSync(path.join(root, sub))) {
                    out[`${sub}/${name}`] = fs.readFileSync(path.join(root, sub, name), "utf-8");
                }
            }
            return out;
        }

        it("produces the same files and summary as a sequential run", () => {
            const seqRoot = path.join(tmpDir, "seq");
            const parRoot = path.join(tmpDir, "par");
            makeTree(seqRoot);
            makeTree(parRoot);
            const seq = run(seqRoot, "-r", "--save");
            const par = run(parRoot, "-r", "--save", "--jobs", "2");
            expect(par.code).toBe(0);
            expect(treeContents(parRoot)).toEqual(treeContents(seqRoot));
            // Same aggregate summary; per-file lines land in walk order either way.
            expect(par.stdout).toContain(seq.stdout.slice(seq.stdout.indexOf("Summary:")));
        });

        it("handles more jobs than files", () => {
            const root = path.join(tmpDir, "overshoot");
            makeTree(root);
            const { code, stdout } = run(root, "-r", "--save", "--jobs", "32");
            expect(code).toBe(0);
            expect(stdout).toContain("Summary: 4 changed, 0 unchanged");
        });

        it("check mode exits 1 when any file needs formatting", () => {
            const root = path.join(tmpDir, "check-par");
            makeTree(root);
            const { code } = run(root, "-r", "--check", "-q", "--jobs", "2");
            expect(code).toBe(1);
        });

        it("rejects a non-integer --jobs value", () => {
            const { code, stderr } = run(tmpDir, "-r", "--save", "--jobs", "zero");
            expect(code).toBe(1);
            expect(stderr).toContain("--jobs must be a positive integer");
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
            const { code, stderr } = run("/nonexistent/file.baf");
            expect(code).toBe(1);
            expect(stderr).toContain("Not found");
        });
    });

    describe(".tra format support", () => {
        const unformatted = "@ 1  =  ~Messy whitespace~\n";
        const formatted = "@1 = ~Messy whitespace~\n";

        it("stdout mode outputs formatted content", () => {
            const file = path.join(tmpDir, "test.tra");
            fs.writeFileSync(file, unformatted);
            const { code, stdout } = run(file);
            expect(code).toBe(0);
            expect(stdout).toBe(formatted);
        });

        it("check mode exits 1 for unformatted file", () => {
            const file = path.join(tmpDir, "bad.tra");
            fs.writeFileSync(file, unformatted);
            const { code } = run(file, "--check");
            expect(code).toBe(1);
        });

        it("check mode exits 0 for already-formatted file", () => {
            const file = path.join(tmpDir, "good.tra");
            fs.writeFileSync(file, formatted);
            const { code } = run(file, "--check");
            expect(code).toBe(0);
        });

        it("save mode rewrites unformatted file", () => {
            const file = path.join(tmpDir, "save.tra");
            fs.writeFileSync(file, unformatted);
            const { code, stdout } = run(file, "--save");
            expect(code).toBe(0);
            expect(stdout).toContain("Formatted:");
            expect(fs.readFileSync(file, "utf-8")).toBe(formatted);
        });
    });

    describe(".msg format support", () => {
        // The msg formatter trims number and audio fields but preserves text content verbatim.
        // So "{ text }" becomes "{ text }" (spaces inside text field are kept).
        const unformatted = "{ 100 }{ }{ text }\n";
        const formatted = "{100}{}{ text }\n";

        it("stdout mode outputs formatted content", () => {
            const file = path.join(tmpDir, "test.msg");
            fs.writeFileSync(file, unformatted);
            const { code, stdout } = run(file);
            expect(code).toBe(0);
            expect(stdout).toBe(formatted);
        });

        it("check mode exits 1 for unformatted file", () => {
            const file = path.join(tmpDir, "bad.msg");
            fs.writeFileSync(file, unformatted);
            const { code } = run(file, "--check");
            expect(code).toBe(1);
        });

        it("check mode exits 0 for already-formatted file", () => {
            const file = path.join(tmpDir, "good.msg");
            fs.writeFileSync(file, formatted);
            const { code } = run(file, "--check");
            expect(code).toBe(0);
        });

        it("save mode rewrites unformatted file", () => {
            const file = path.join(tmpDir, "save.msg");
            fs.writeFileSync(file, unformatted);
            const { code, stdout } = run(file, "--save");
            expect(code).toBe(0);
            expect(stdout).toContain("Formatted:");
            expect(fs.readFileSync(file, "utf-8")).toBe(formatted);
        });
    });

    describe(".2da format support", () => {
        // Unformatted: columns not aligned with MIN_GAP=4 between each
        const unformatted = "2DA V1.0\n0\n  COL1 COL2\nROW1 a b\n";
        // The formatter aligns columns; just test that it runs and produces output
        it("stdout mode outputs formatted content", () => {
            const file = path.join(tmpDir, "test.2da");
            fs.writeFileSync(file, unformatted);
            const { code, stdout } = run(file);
            expect(code).toBe(0);
            // Formatted output should contain the same tokens
            expect(stdout).toContain("COL1");
            expect(stdout).toContain("ROW1");
        });

        it("check mode exits 1 for unformatted file", () => {
            const file = path.join(tmpDir, "bad.2da");
            fs.writeFileSync(file, unformatted);
            const { code } = run(file, "--check");
            expect(code).toBe(1);
        });

        it("save mode rewrites unformatted file", () => {
            const file = path.join(tmpDir, "save.2da");
            fs.writeFileSync(file, unformatted);
            const { code, stdout } = run(file, "--save");
            expect(code).toBe(0);
            expect(stdout).toContain("Formatted:");
            const result = fs.readFileSync(file, "utf-8");
            expect(result).not.toBe(unformatted);
            expect(result).toContain("COL1");
        });

        it("check mode exits 0 for already-formatted file", () => {
            // Format once then check
            const file = path.join(tmpDir, "good.2da");
            fs.writeFileSync(file, unformatted);
            run(file, "--save");
            const { code } = run(file, "--check");
            expect(code).toBe(0);
        });
    });

    describe("scripts.lst format support", () => {
        // Unformatted: misaligned column spacing (LF input, CRLF output)
        const unformatted = "AR0100.int  ;  Arroyo\n";
        const formatted = "AR0100.int    ; Arroyo\r\n";

        it("stdout mode outputs formatted content", () => {
            const file = path.join(tmpDir, "scripts.lst");
            fs.writeFileSync(file, unformatted);
            const { code, stdout } = run(file);
            expect(code).toBe(0);
            expect(stdout).toBe(formatted);
        });

        it("check mode exits 1 for unformatted file", () => {
            const file = path.join(tmpDir, "scripts.lst");
            fs.writeFileSync(file, unformatted);
            const { code } = run(file, "--check");
            expect(code).toBe(1);
        });

        it("check mode exits 0 for already-formatted file", () => {
            const file = path.join(tmpDir, "scripts.lst");
            fs.writeFileSync(file, formatted);
            const { code } = run(file, "--check");
            expect(code).toBe(0);
        });

        it("save mode rewrites unformatted file", () => {
            const file = path.join(tmpDir, "scripts.lst");
            fs.writeFileSync(file, unformatted);
            const { code, stdout } = run(file, "--save");
            expect(code).toBe(0);
            expect(stdout).toContain("Formatted:");
            expect(fs.readFileSync(file, "utf-8")).toBe(formatted);
        });

        it("recursive directory mode discovers scripts.lst by exact filename", () => {
            const file = path.join(tmpDir, "scripts.lst");
            fs.writeFileSync(file, unformatted);
            const { code } = run(tmpDir, "-r", "--check", "-q");
            expect(code).toBe(1);
        });
    });

    describe("fallout-ssl preprocessor idempotence", () => {
        // Regression: a multiline `#define` whose body ends with `\<newline>`
        // followed by a blank continuation line carries that blank line as part
        // of the directive's tree-sitter node text. The terminating newline
        // makes the macro definition end *before* a following directive on the
        // next reparse; if the formatter strips it, the parser merges the next
        // `#define` into the macro body and the second formatting pass loses
        // the blank line that originally separated them.
        it("preserves blank-continuation termination of a multiline #define", () => {
            // Three consecutive directives are needed because the merge induced
            // by stripping the load-bearing newline only changes the layout
            // *between* later directives - a 2-directive case collapses on the
            // first pass and is then stably idempotent in its degraded form.
            const input = "#define A  (foo)                  \\\n\n#define B  bar\n\n#define C  baz\n";
            const file = path.join(tmpDir, "preproc.ssl");
            fs.writeFileSync(file, input);
            const { code, stderr } = run(file, "--save-and-check");
            expect(stderr).not.toContain("Formatter not idempotent");
            expect(code).toBe(0);
        });
    });

    describe("weidu-d transition idempotence", () => {
        // Regression: a ~trigger~ string abutting THEN with no source space (valid WeiDU) rendered as
        // ~..~THEN on the first pass but ~..~ THEN once the broken transition line was reparsed, so the
        // formatter was not idempotent. A separating space is now inserted at a ~/"-string<->word
        // boundary (never a %var% one, so interpolated names stay abutted).
        it("adds a stable space between a ~trigger~ and an abutting THEN across a line break", () => {
            const input =
                "EXTEND_BOTTOM ~%tutu_var%CORSON~ 6\n" +
                'IF ~InParty("faldorn") InMyArea("faldorn") !StateCheck("faldorn",CD_STATE_NOTVALID)~THEN EXTERN ~%FALDORN_JOINED%~ FaldornCorsone\n' +
                "END\n";
            const file = path.join(tmpDir, "trans.d");
            fs.writeFileSync(file, input);
            const { code, stderr } = run(file, "--save-and-check");
            expect(stderr).not.toContain("Formatter not idempotent");
            expect(code).toBe(0);
        });
    });
});
