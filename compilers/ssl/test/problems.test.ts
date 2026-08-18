/**
 * What `problemsOf` hands a consumer, driven from real compiles.
 *
 * This is the one seam every compiler refusal flows through - the language server turns its output into
 * Problems-panel entries and the compiled-script editor refuses a save on it - and each stage packages its
 * refusals differently. A consumer that saw only one shape would silently show a single error where the
 * compiler found ten, which is the regression these guard: the counts, not just the wording.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { Language, Parser } from "web-tree-sitter";
import { compileText } from "../src/compile.ts";
import { problemsOf } from "../src/problems.ts";
import { REPO_ROOT } from "../../../shared/cli/test/repo-root.ts";

const WASM_DIR = path.join(REPO_ROOT, "server/out");
const wasmPresent = fs.existsSync(path.join(WASM_DIR, "tree-sitter-ssl.wasm"));

describe.skipIf(!wasmPresent)("problemsOf, over a real compile", () => {
    let parser: Parser;

    beforeAll(async () => {
        await Parser.init({ wasmBinary: fs.readFileSync(path.join(WASM_DIR, "web-tree-sitter.wasm")) });
        parser = new Parser();
        parser.setLanguage(await Language.load(path.join(WASM_DIR, "tree-sitter-ssl.wasm")));
    });

    /** Compile something expected to fail, and return what a consumer would be given. */
    function problemsFrom(source: string) {
        try {
            compileText(parser, source);
        } catch (error) {
            return problemsOf(error);
        }
        throw new Error("expected the compile to be refused");
    }

    it("reports every unknown identifier, not just the first", () => {
        const problems = problemsFrom(
            "procedure start begin\n  variable x;\n  x := nope1;\n  x := nope2;\n  x := nope3;\nend\n",
        );
        expect(problems).toHaveLength(3);
        expect(problems.map((p) => p.line)).toEqual([3, 4, 5]);
        expect(problems.map((p) => p.message)).toEqual([
            "unknown identifier 'nope1'",
            "unknown identifier 'nope2'",
            "unknown identifier 'nope3'",
        ]);
    });

    it("reports every syntax error, not just the first", () => {
        const problems = problemsFrom("procedure a begin\n variable &x;\n variable &y;\n variable &z;\nend\n");
        expect(problems).toHaveLength(3);
        expect(problems.map((p) => p.line)).toEqual([2, 3, 4]);
    });

    // A syntax error deletes whatever the parser could not read, so continuing into lowering would turn one
    // real mistake into a pile of consequences of it. The stages are gated for that reason, and this is
    // what that gate looks like from the outside.
    it("stops at the first stage that found anything, rather than mixing stages", () => {
        const problems = problemsFrom("procedure start begin\n variable x;\n x := nope1;\n variable &y;\nend\n");
        expect(problems).toHaveLength(1);
        expect(problems[0]?.message).toBe("syntax error");
        expect(problems[0]?.line).toBe(4);
    });

    it("gives every problem a line a consumer can place it on", () => {
        const problems = problemsFrom("procedure start begin\n  variable x;\n  x := nope1;\n  x := nope2;\nend\n");
        for (const problem of problems) {
            expect(problem.line).toBeGreaterThan(0);
        }
    });
});

describe("problemsOf, over errors it did not raise itself", () => {
    it("reads a position out of a bare error's message", () => {
        expect(problemsOf(new Error("12:5: something went wrong"))).toEqual([
            { line: 12, column: 5, message: "something went wrong" },
        ]);
    });

    it("anchors an error carrying no position at the first line rather than guessing one", () => {
        expect(problemsOf(new Error("no position here"))).toEqual([
            { line: 1, column: 0, message: "no position here" },
        ]);
    });

    it("survives something that is not an Error at all", () => {
        expect(problemsOf("just a string")).toEqual([{ line: 1, column: 0, message: "just a string" }]);
    });
});
