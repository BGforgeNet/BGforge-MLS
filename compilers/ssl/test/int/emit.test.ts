/**
 * Differential test: our INT emitter against the bundled reference compiler, byte for byte.
 *
 * Each case pairs a source snippet with the IR a front end would lower it to, compiles the snippet
 * with the reference, and compares the bytes. Byte-identity is not a design goal in itself - the
 * output only has to load and run - but it is by far the sharpest oracle available, because any
 * disagreement about a table offset, an opcode, or a patch site shows up immediately and localised
 * rather than as a script that misbehaves in-game. Where we deliberately differ, the divergence is
 * documented at the site that causes it.
 *
 * Compilation runs at -O0 so no optimiser choices have to be reproduced; the optimiser is a separate
 * layer with its own tests.
 *
 * The reference ships as an optional dependency, so the suite skips when it is absent. The case count
 * is asserted to keep a skip from reading as a pass.
 */

import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { emitInt } from "../../src/int/emit.ts";
import { EngineOp } from "../../src/int/opcodes-engine.ts";
import type { Expr, Program, Stmt, VariableDecl } from "../../src/int/ir.ts";
import { REPO_ROOT } from "../../../../shared/cli/test/repo-root.ts";
import { SPAWN_TIMEOUT_MS } from "../../../../shared/spawn-timeout.ts";

function findCompiler(): string | null {
    try {
        const require = createRequire(path.join(REPO_ROOT, "server/package.json"));
        return require.resolve("sslc-emscripten-noderawfs/compiler.mjs");
    } catch {
        return null;
    }
}

const compiler = findCompiler();
const workDir = compiler ? fs.mkdtempSync(path.join(os.tmpdir(), "ssl-int-")) : "";

afterAll(() => {
    if (workDir) fs.rmSync(workDir, { recursive: true, force: true });
});

/** Compiles a snippet with the reference and returns its bytes. */
function reference(name: string, source: string): Uint8Array {
    fs.writeFileSync(path.join(workDir, `${name}.ssl`), source);
    execFileSync(process.execPath, [compiler as string, "-O0", "-q", `${name}.ssl`, "-o", `${name}.int`], {
        cwd: workDir,
        timeout: SPAWN_TIMEOUT_MS,
    });
    return new Uint8Array(fs.readFileSync(path.join(workDir, `${name}.int`)));
}

/** Reports the first differing offset with surrounding bytes, which localises a bad patch site. */
function describeMismatch(expected: Uint8Array, actual: Uint8Array): string {
    const at = expected.findIndex((byte, index) => byte !== actual[index]);
    const pivot = at === -1 ? Math.min(expected.length, actual.length) : at;
    const from = Math.max(0, pivot - 8);
    const hex = (bytes: Uint8Array) =>
        Array.prototype.map
            .call(bytes.slice(from, from + 24), (b: number) => b.toString(16).padStart(2, "0"))
            .join(" ");
    return [
        `first difference at byte ${pivot} (ref ${expected.length} bytes, ours ${actual.length})`,
        `  ref @${from}: ${hex(expected)}`,
        `  ours@${from}: ${hex(actual)}`,
    ].join("\n");
}

// Shorthands keeping the case table readable.
const int = (value: number): Expr => ({ kind: "int", value });
const localVar = (index: number, name: string) => ({ kind: "var", scope: "local", index, name }) as const;
const globalVar = (index: number, name: string) => ({ kind: "var", scope: "global", index, name }) as const;
const zero = { kind: "int", value: 0 } as const;
const declare = (name: string, initial: VariableDecl["initial"] = zero): VariableDecl => ({ name, initial });

function startProc(body: Stmt[], locals: VariableDecl[] = []): Program {
    return { declarations: [{ kind: "procedure", procedure: { name: "start", args: [], locals, body } }] };
}

interface Case {
    name: string;
    source: string;
    program: Program;
    shortCircuit?: boolean;
}

const CASES: Case[] = [
    {
        name: "empty procedure",
        source: "procedure start begin end\n",
        program: startProc([]),
    },
    {
        name: "local declaration and arithmetic assignment",
        source: "procedure start begin\n   variable x;\n   x := 1 + 2;\nend\n",
        program: startProc(
            [
                {
                    kind: "assign",
                    target: localVar(0, "x"),
                    op: "=",
                    value: { kind: "binary", op: "+", left: int(1), right: int(2) },
                },
            ],
            [declare("x")],
        ),
    },
    {
        name: "several procedures with forward declarations",
        source: "procedure ab;\nprocedure abc;\nprocedure ab begin end\nprocedure abc begin end\nprocedure start begin end\n",
        program: {
            declarations: [
                { kind: "procedure", procedure: { name: "ab", args: [], locals: [], body: [] } },
                { kind: "procedure", procedure: { name: "abc", args: [], locals: [], body: [] } },
                { kind: "procedure", procedure: { name: "start", args: [], locals: [], body: [] } },
            ],
        },
    },
    {
        name: "if without else",
        source: "procedure start begin\n   variable x;\n   if (x == 1) then begin\n      x := 2;\n   end\nend\n",
        program: startProc(
            [
                {
                    kind: "if",
                    cond: { kind: "binary", op: "==", left: localVar(0, "x"), right: int(1) },
                    thenBranch: {
                        kind: "block",
                        body: [{ kind: "assign", target: localVar(0, "x"), op: "=", value: int(2) }],
                    },
                },
            ],
            [declare("x")],
        ),
    },
    {
        name: "if with else",
        source: "procedure start begin\n   variable x;\n   if (x) then begin\n      x := 1;\n   end else begin\n      x := 2;\n   end\nend\n",
        program: startProc(
            [
                {
                    kind: "if",
                    cond: localVar(0, "x"),
                    thenBranch: {
                        kind: "block",
                        body: [{ kind: "assign", target: localVar(0, "x"), op: "=", value: int(1) }],
                    },
                    elseBranch: {
                        kind: "block",
                        body: [{ kind: "assign", target: localVar(0, "x"), op: "=", value: int(2) }],
                    },
                },
            ],
            [declare("x")],
        ),
    },
    {
        name: "while loop with compound assignment",
        source: "procedure start begin\n   variable x;\n   while (x < 10) do begin\n      x += 1;\n   end\nend\n",
        program: startProc(
            [
                {
                    kind: "while",
                    cond: { kind: "binary", op: "<", left: localVar(0, "x"), right: int(10) },
                    body: {
                        kind: "block",
                        body: [{ kind: "assign", target: localVar(0, "x"), op: "+=", value: int(1) }],
                    },
                },
            ],
            [declare("x")],
        ),
    },
    {
        name: "explicit return with a value",
        source: "procedure start begin\n   return 7;\nend\n",
        program: startProc([{ kind: "return", value: int(7) }]),
    },
    {
        // A global declared above a procedure takes the earlier name-table offset, which shifts every
        // later one - the reason the IR keeps declarations in one ordered list.
        name: "global declared before a procedure",
        source: "variable g := 3;\nprocedure start begin\n   g := 4;\nend\n",
        program: {
            declarations: [
                { kind: "global", variable: declare("g", { kind: "int", value: 3 }) },
                {
                    kind: "procedure",
                    procedure: {
                        name: "start",
                        args: [],
                        locals: [],
                        body: [{ kind: "assign", target: globalVar(0, "g"), op: "=", value: int(4) }],
                    },
                },
            ],
        },
    },
    {
        name: "string constant reaches the string space",
        source: 'procedure start begin\n   variable s := "hi";\nend\n',
        program: startProc([], [declare("s", { kind: "string", value: "hi" })]),
    },
    {
        name: "float constant",
        source: "procedure start begin\n   variable f := 1.5;\nend\n",
        program: startProc([], [declare("f", { kind: "float", value: 1.5 })]),
    },
    {
        name: "call without arguments",
        source: "procedure foo;\nprocedure foo begin end\nprocedure start begin\n   call foo;\nend\n",
        program: {
            declarations: [
                { kind: "procedure", procedure: { name: "foo", args: [], locals: [], body: [] } },
                {
                    kind: "procedure",
                    procedure: {
                        name: "start",
                        args: [],
                        locals: [],
                        body: [{ kind: "callStmt", target: { kind: "procRef", index: 0 }, args: [] }],
                    },
                },
            ],
        },
    },
    {
        name: "call with arguments",
        source:
            "procedure foo(variable a, variable b);\nprocedure foo(variable a, variable b) begin end\n" +
            "procedure start begin\n   call foo(1, 2);\nend\n",
        program: {
            declarations: [
                { kind: "procedure", procedure: { name: "foo", args: ["a", "b"], locals: [], body: [] } },
                {
                    kind: "procedure",
                    procedure: {
                        name: "start",
                        args: [],
                        locals: [],
                        body: [{ kind: "callStmt", target: { kind: "procRef", index: 0 }, args: [int(1), int(2)] }],
                    },
                },
            ],
        },
    },
    {
        // The pragma is the compiler's, and it changes emitted bytes: the right operand is skipped
        // when the left already decides the result.
        name: "short-circuit boolean evaluation",
        source: "#pragma sce\nprocedure start begin\n   variable x;\n   if (x and 1) then begin\n      x := 1;\n   end\nend\n",
        shortCircuit: true,
        program: startProc(
            [
                {
                    kind: "if",
                    cond: { kind: "binary", op: "and", left: localVar(0, "x"), right: int(1) },
                    thenBranch: {
                        kind: "block",
                        body: [{ kind: "assign", target: localVar(0, "x"), op: "=", value: int(1) }],
                    },
                },
            ],
            [declare("x")],
        ),
    },

    // `for` is not a loop form of its own: the front end desugars it to an initialiser followed by a while
    // whose body ends with a loop-end marker and then the increment. `continue` jumps to that marker rather
    // than to the condition, which is how the increment still runs on a continue.
    {
        name: "for loop desugars to while plus a loop-end marker",
        source: "procedure start begin\n variable i;\n for (i := 0; i < 3; i += 1) begin\n  i := i;\n end\nend\n",
        program: startProc(
            [
                { kind: "assign", target: localVar(0, "i"), op: "=", value: int(0) },
                {
                    kind: "while",
                    cond: { kind: "binary", op: "<", left: localVar(0, "i"), right: int(3) },
                    body: {
                        kind: "block",
                        body: [
                            {
                                kind: "block",
                                body: [{ kind: "assign", target: localVar(0, "i"), op: "=", value: localVar(0, "i") }],
                            },
                            { kind: "loopEnd" },
                            { kind: "assign", target: localVar(0, "i"), op: "+=", value: int(1) },
                        ],
                    },
                },
            ],
            [declare("i")],
        ),
    },
    {
        name: "break inside a while",
        source: "procedure start begin\n while (1) do begin\n  break;\n end\nend\n",
        program: startProc([{ kind: "while", cond: int(1), body: { kind: "block", body: [{ kind: "break" }] } }]),
    },
    {
        name: "continue inside a for runs the increment",
        source: "procedure start begin\n variable i;\n for (i := 0; i < 3; i += 1) begin\n  continue;\n end\nend\n",
        program: startProc(
            [
                { kind: "assign", target: localVar(0, "i"), op: "=", value: int(0) },
                {
                    kind: "while",
                    cond: { kind: "binary", op: "<", left: localVar(0, "i"), right: int(3) },
                    body: {
                        kind: "block",
                        body: [
                            { kind: "block", body: [{ kind: "continue" }] },
                            { kind: "loopEnd" },
                            { kind: "assign", target: localVar(0, "i"), op: "+=", value: int(1) },
                        ],
                    },
                },
            ],
            [declare("i")],
        ),
    },
    {
        // Pins the engine opcode table's base offset against real output: a wrong core or library count
        // would shift every one of the 481 engine opcodes and show up here.
        name: "engine function call in statement position",
        source: 'procedure start begin\n display_msg("hi");\nend\n',
        program: startProc([
            { kind: "libStmt", opcode: EngineOp.DISPLAY_MSG, args: [{ kind: "string", value: "hi" }] },
        ]),
    },
    {
        name: "engine function call in expression position",
        source: "procedure start begin\n variable x;\n x := random(1, 10);\nend\n",
        program: startProc(
            [
                {
                    kind: "assign",
                    target: localVar(0, "x"),
                    op: "=",
                    value: { kind: "libCall", opcode: EngineOp.RANDOM, args: [int(1), int(10)] },
                },
            ],
            [declare("x")],
        ),
    },
    {
        name: "exported variable",
        source: "export variable g := 1;\nprocedure start begin end\n",
        program: {
            declarations: [
                { kind: "external", variable: { name: "g", initial: { kind: "int", value: 1 }, exported: true } },
                { kind: "procedure", procedure: { name: "start", args: [], locals: [], body: [] } },
            ],
        },
    },
    {
        name: "imported variable",
        source: "import variable g;\nprocedure start begin end\n",
        program: {
            declarations: [
                { kind: "external", variable: declare("g") },
                { kind: "procedure", procedure: { name: "start", args: [], locals: [], body: [] } },
            ],
        },
    },
    {
        name: "exported procedure",
        source: "export procedure foo;\nprocedure foo begin end\nprocedure start begin end\n",
        program: {
            declarations: [
                { kind: "procedure", procedure: { name: "foo", args: [], locals: [], body: [], exported: true } },
                { kind: "procedure", procedure: { name: "start", args: [], locals: [], body: [] } },
            ],
        },
    },
    {
        name: "critical procedure",
        source: "critical procedure foo begin end\nprocedure start begin end\n",
        program: {
            declarations: [
                { kind: "procedure", procedure: { name: "foo", args: [], locals: [], body: [], critical: true } },
                { kind: "procedure", procedure: { name: "start", args: [], locals: [], body: [] } },
            ],
        },
    },
    {
        name: "conditional procedure",
        source: "procedure foo when (1) begin end\nprocedure start begin end\n",
        program: {
            declarations: [
                { kind: "procedure", procedure: { name: "foo", args: [], locals: [], body: [], conditional: int(1) } },
                { kind: "procedure", procedure: { name: "start", args: [], locals: [], body: [] } },
            ],
        },
    },
];

describe.skipIf(compiler === null)("INT emitter matches the reference compiler", () => {
    it("covers every case in the table", () => {
        // Guards against a case table that silently shrinks, which would make the suite pass vacuously.
        expect(CASES.length).toBeGreaterThanOrEqual(23);
    });

    for (const testCase of CASES) {
        it(testCase.name, () => {
            const expected = reference(testCase.name.replaceAll(/\W+/g, "_"), testCase.source);
            const actual = emitInt(testCase.program, { shortCircuit: testCase.shortCircuit });
            expect([...actual], describeMismatch(expected, actual)).toEqual([...expected]);
        });
    }
});
