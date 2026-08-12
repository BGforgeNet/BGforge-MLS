/**
 * End-to-end differential: SSL source text through the whole pipeline, byte-compared against the
 * reference compiler.
 *
 * `emit.test.ts` drives the emitter from hand-built IR, which isolates codegen but encodes this file's
 * assumptions about what the front end produces. This one starts from source, so it is the test that
 * can catch a lowering that builds the wrong tree - the two are complements, not duplicates.
 *
 * Needs the grammar WASM (a build) and the reference compiler (an optional dependency); skips without
 * either, with the case count asserted so a skip cannot read as a pass.
 */

import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Language, Parser } from "web-tree-sitter";
import { compileFile } from "../../src/compile.ts";
import { REPO_ROOT } from "../../../shared/cli/test/repo-root.ts";

const WASM_DIR = path.join(REPO_ROOT, "server/out");

function findCompiler(): string | null {
    try {
        return createRequire(path.join(REPO_ROOT, "server/package.json")).resolve(
            "sslc-emscripten-noderawfs/compiler.mjs",
        );
    } catch {
        return null;
    }
}

const compiler = findCompiler();
const wasmPresent = fs.existsSync(path.join(WASM_DIR, "tree-sitter-ssl.wasm"));
const workDir = compiler && wasmPresent ? fs.mkdtempSync(path.join(os.tmpdir(), "ssl-e2e-")) : "";

afterAll(() => {
    if (workDir) fs.rmSync(workDir, { recursive: true, force: true });
});

interface Case {
    name: string;
    source: string;
}

const CASES: Case[] = [
    { name: "empty procedure", source: "procedure start begin end\n" },
    { name: "arithmetic assignment", source: "procedure start begin\n variable x;\n x := 1 + 2;\nend\n" },
    {
        name: "if with else",
        source: "procedure start begin\n variable x;\n if (x) then begin\n  x := 1;\n end else begin\n  x := 2;\n end\nend\n",
    },
    {
        name: "while with compound assignment",
        source: "procedure start begin\n variable x;\n while (x < 10) do begin\n  x += 1;\n end\nend\n",
    },
    { name: "global variable", source: "variable g := 3;\nprocedure start begin\n g := 4;\nend\n" },
    { name: "engine call as a statement", source: 'procedure start begin\n display_msg("hi");\nend\n' },
    {
        name: "engine call in an expression",
        source: "procedure start begin\n variable x;\n x := random(1, 10);\nend\n",
    },
    {
        name: "procedure call",
        source: "procedure foo;\nprocedure foo begin end\nprocedure start begin\n call foo;\nend\n",
    },
    {
        name: "procedure call with arguments",
        source:
            "procedure foo(variable a);\nprocedure foo(variable a) begin end\n" +
            "procedure start begin\n call foo(5);\nend\n",
    },
    { name: "return with a value", source: "procedure start begin\n return 7;\nend\n" },
    { name: "string local", source: 'procedure start begin\n variable s := "hi";\nend\n' },
    { name: "exported variable", source: "export variable g := 1;\nprocedure start begin end\n" },
    {
        name: "nested arithmetic",
        source: "procedure start begin\n variable a;\n variable b;\n a := (b + 1) * 2 - 3;\nend\n",
    },
    { name: "unary operators", source: "procedure start begin\n variable x;\n x := -(not x);\nend\n" },
    {
        name: "for loop",
        source: "procedure start begin\n variable i;\n for (i := 0; i < 3; i += 1) begin\n  i := i;\n end\nend\n",
    },
    {
        name: "for loop declaring its variable",
        source: "procedure start begin\n for (variable i := 0; i < 3; i += 1) begin\n  i := i;\n end\nend\n",
    },
    {
        // Expands to an indexed while loop over generated temporaries; their allocation order fixes
        // both the `tmp.<n>` names in the name table and the local slot indices.
        name: "foreach over a variable",
        source: "procedure start begin\n variable a;\n variable v;\n foreach v in a begin\n  v := v;\n end\nend\n",
    },
    {
        name: "foreach over an expression needs a temporary",
        source: "procedure start begin\n variable v;\n foreach v in load_array(1) begin\n  v := v;\n end\nend\n",
    },
    {
        name: "foreach with key and value",
        source: "procedure start begin\n variable a;\n variable k;\n variable v;\n foreach k: v in a begin\n  v := k;\n end\nend\n",
    },
    {
        name: "switch over a variable",
        source:
            "procedure start begin\n variable x;\n switch x begin\n  case 1: x := 10;\n" +
            "  case 2: x := 20;\n  default: x := 30;\n end\nend\n",
    },
    {
        name: "switch over an expression needs a temporary",
        source: "procedure start begin\n variable x;\n switch (x + 1) begin\n  case 1: x := 10;\n end\nend\n",
    },
    {
        name: "switch with no default",
        source: "procedure start begin\n variable x;\n switch x begin\n  case 1: x := 10;\n  case 2: x := 20;\n end\nend\n",
    },
    {
        // Built by summing engine calls, not by a dedicated instruction.
        name: "array literal",
        source: "procedure start begin\n variable a;\n a := [1, 2, 3];\nend\n",
    },
    {
        name: "empty array literal",
        source: "procedure start begin\n variable a;\n a := [];\nend\n",
    },
    {
        name: "map literal",
        source: 'procedure start begin\n variable m;\n m := {"a": 1, "b": 2};\nend\n',
    },
    {
        // A nested literal is flagged and terminated so the engine's expression stack unwinds.
        name: "nested array literal",
        source: "procedure start begin\n variable a;\n a := [1, [2, 3]];\nend\n",
    },
    {
        name: "array subscript and member access",
        source: "procedure start begin\n variable a;\n variable x;\n x := a[1];\n x := a.field;\nend\n",
    },
    {
        // `andalso`/`orelse` short-circuit even though this file compiles without the pragma.
        name: "explicitly short-circuiting operators",
        source: "procedure start begin\n variable x;\n x := (x andalso 1) orelse 2;\nend\n",
    },
    {
        name: "continue inside a for loop",
        source: "procedure start begin\n variable i;\n for (i := 0; i < 3; i += 1) begin\n  continue;\n end\nend\n",
    },
];

describe.skipIf(compiler === null || !wasmPresent)("SSL source compiles to matching bytecode", () => {
    let parser: Parser;

    beforeAll(async () => {
        await Parser.init({ wasmBinary: fs.readFileSync(path.join(WASM_DIR, "web-tree-sitter.wasm")) });
        parser = new Parser();
        parser.setLanguage(await Language.load(path.join(WASM_DIR, "tree-sitter-ssl.wasm")));
    });

    it("covers every case in the table", () => {
        expect(CASES.length).toBeGreaterThanOrEqual(27);
    });

    it.each(CASES)("$name", ({ name, source }) => {
        const stem = name.replaceAll(/\W+/g, "_");
        const file = path.join(workDir, `${stem}.ssl`);
        fs.writeFileSync(file, source);
        execFileSync(process.execPath, [compiler as string, "-O0", "-q", `${stem}.ssl`, "-o", `${stem}.int`], {
            cwd: workDir,
        });
        const expected = new Uint8Array(fs.readFileSync(path.join(workDir, `${stem}.int`)));
        const actual = compileFile(parser, file);
        expect([...actual], `ref ${expected.length} bytes, ours ${actual.length}`).toEqual([...expected]);
    });
});
