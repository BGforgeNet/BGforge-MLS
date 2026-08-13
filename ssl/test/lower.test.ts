/**
 * Unit tests for the parts of the pipeline the corpus differential cannot reach.
 *
 * That differential proves the happy path exhaustively - every script the reference can build compiles
 * byte-identically - but by construction it only exercises code real scripts reach. What it never
 * touches is the refusal behaviour: the lowering is written to throw rather than emit something
 * approximate, and an unexercised throw is a promise nobody has checked. These tests hold the compiler
 * to that promise, and cover the emitter and writer edges real scripts happen not to hit.
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { Language, Parser } from "web-tree-sitter";
import { CompileError, compileFile, compileText } from "../src/compile.ts";
import { EmitError, emitInt } from "../src/int/emit.ts";
import { NameTable } from "../src/int/namelist.ts";
import { IntWriter } from "../src/int/writer.ts";
import { engineFunction } from "../src/int/engine-functions.ts";
import { lowerProgram } from "../src/lower.ts";
import type { Program, Stmt } from "../src/int/ir.ts";
import { REPO_ROOT } from "../../shared/cli/test/repo-root.ts";

const WASM_DIR = path.join(REPO_ROOT, "server/out");
const wasmPresent = fs.existsSync(path.join(WASM_DIR, "tree-sitter-ssl.wasm"));

describe("byte writer", () => {
    it("grows past its initial capacity", () => {
        const writer = new IntWriter(4);
        for (let i = 0; i < 100; i++) writer.byte(i & 0xff);
        expect(writer.toBytes().length).toBe(100);
        expect(writer.toBytes()[99]).toBe(99);
    });

    it("writes a negative longword as two's complement", () => {
        const writer = new IntWriter();
        writer.long(-1);
        expect([...writer.toBytes()]).toEqual([0xff, 0xff, 0xff, 0xff]);
    });

    it("writes a float as its IEEE-754 bit pattern", () => {
        const writer = new IntWriter();
        writer.float(1.5);
        // 0xa001 typed opcode, then 1.5 as float32.
        expect([...writer.toBytes()]).toEqual([0xa0, 0x01, 0x3f, 0xc0, 0x00, 0x00]);
    });

    it("patches a longword without moving the write position", () => {
        const writer = new IntWriter();
        writer.long(0);
        writer.byte(0x7f);
        writer.patchLong(0, 0x11223344);
        expect([...writer.toBytes()]).toEqual([0x11, 0x22, 0x33, 0x44, 0x7f]);
    });
});

describe("name table", () => {
    it("pads an entry to an even length and interns by value", () => {
        const table = new NameTable();
        expect(table.intern("ab")).toBe(6);
        // "ab" plus its terminator is 3 bytes, padded to 4, so the next entry's data lands at 12.
        expect(table.intern("cde")).toBe(12);
        expect(table.intern("ab")).toBe(6);
    });

    it("refuses to reveal an offset for a name it never interned", () => {
        // Interning during the write phase would grow a table already serialized, shifting every later
        // offset. Failing loudly is the point.
        const table = new NameTable();
        expect(() => table.offsetOf("absent")).toThrow(/was not interned/);
    });

    it("serializes an empty table as the terminator alone", () => {
        expect([...new NameTable().toBytes()]).toEqual([0xff, 0xff, 0xff, 0xff]);
    });
});

describe("engine function lookup edges", () => {
    it("returns nothing for a name no game defines", () => {
        expect(engineFunction("not_a_real_engine_function")).toBeUndefined();
        expect(engineFunction("not_a_real_engine_function", 1)).toBeUndefined();
    });
});

describe("emitter refusals", () => {
    const bare = (body: Program["declarations"]): Program => ({ declarations: body });

    it("rejects an operator with no opcode", () => {
        expect(() =>
            emitInt(
                bare([
                    {
                        kind: "procedure",
                        procedure: {
                            name: "start",
                            args: [],
                            locals: [],
                            body: [
                                {
                                    kind: "return",
                                    // `in` is a grammar-level operator with no runtime opcode.
                                    value: {
                                        kind: "binary",
                                        op: "in" as never,
                                        left: { kind: "int", value: 1 },
                                        right: { kind: "int", value: 2 },
                                    },
                                },
                            ],
                        },
                    },
                ]),
            ),
        ).toThrow(EmitError);
    });

    it("rejects a continue outside any loop", () => {
        expect(() =>
            emitInt(
                bare([
                    {
                        kind: "procedure",
                        procedure: { name: "start", args: [], locals: [], body: [{ kind: "continue" }] },
                    },
                ]),
            ),
        ).toThrow(/outside a loop/);
    });

    it("rejects calling something that is not callable", () => {
        expect(() =>
            emitInt(
                bare([
                    {
                        kind: "procedure",
                        procedure: {
                            name: "start",
                            args: [],
                            locals: [],
                            body: [{ kind: "callStmt", target: { kind: "int", value: 3 }, args: [] }],
                        },
                    },
                ]),
            ),
        ).toThrow(/cannot call/);
    });
});

describe("compile guards", () => {
    it("fails loudly when the parser yields no tree", () => {
        // Rather than emitting from nothing, which would produce a valid-looking but empty program.
        const stub = { parse: () => null } as unknown as Parser;
        expect(() => compileText(stub, "procedure start begin end")).toThrow(CompileError);
        expect(() => compileText(stub, "procedure start begin end")).toThrow(/no tree/);
    });
});

describe("emitter shapes the corpus does not produce", () => {
    /** Emits a one-procedure program and returns its size, asserting only that it emitted. */
    const emitted = (program: Program) => emitInt(program).length;

    it("emits timed, imported, conditional and critical procedures", () => {
        expect(
            emitted({
                declarations: [
                    {
                        kind: "procedure",
                        procedure: {
                            name: "timed_one",
                            args: [],
                            locals: [],
                            body: [],
                            timed: 5,
                            conditional: { kind: "int", value: 1 },
                            critical: true,
                        },
                    },
                    // An imported procedure has a table entry but no body of its own.
                    {
                        kind: "procedure",
                        procedure: { name: "elsewhere", args: [], locals: [], body: [], imported: true },
                    },
                    { kind: "procedure", procedure: { name: "start", args: [], locals: [], body: [] } },
                ],
            }),
        ).toBeGreaterThan(0);
    });

    it("emits every storage class and constant type", () => {
        const external = { kind: "var", scope: "external", index: 0, name: "shared" } as const;
        expect(
            emitted({
                declarations: [
                    {
                        kind: "external",
                        variable: { name: "shared", initial: { kind: "int", value: 0 }, exported: true },
                    },
                    { kind: "global", variable: { name: "g", initial: { kind: "float", value: 2.5 } } },
                    {
                        kind: "procedure",
                        procedure: {
                            name: "start",
                            args: [],
                            locals: [{ name: "s", initial: { kind: "string", value: "x" } }],
                            body: [
                                { kind: "assign", target: external, op: "=", value: { kind: "int", value: 1 } },
                                { kind: "assign", target: external, op: "+=", value: external },
                                {
                                    kind: "assign",
                                    target: { kind: "var", scope: "global", index: 0, name: "g" },
                                    op: "=",
                                    value: { kind: "float", value: 1.5 },
                                },
                                { kind: "expr", expr: { kind: "string", value: "x" } },
                                {
                                    kind: "expr",
                                    expr: {
                                        kind: "ternary",
                                        cond: { kind: "int", value: 1 },
                                        whenTrue: { kind: "string", value: "x" },
                                        whenFalse: { kind: "unary", op: "not", operand: { kind: "int", value: 0 } },
                                    },
                                },
                                {
                                    kind: "libStmt",
                                    opcode: 0x80b8,
                                    args: [{ kind: "string", value: "x" }],
                                    popsResult: true,
                                },
                            ],
                        },
                    },
                ],
            }),
        ).toBeGreaterThan(0);
    });

    it("emits a stringified procedure reference and an indirect call", () => {
        const holder = { kind: "var", scope: "local", index: 0, name: "cb" } as const;
        expect(
            emitted({
                declarations: [
                    { kind: "procedure", procedure: { name: "target", args: [], locals: [], body: [] } },
                    {
                        kind: "procedure",
                        procedure: {
                            name: "start",
                            args: [],
                            locals: [{ name: "cb", initial: { kind: "int", value: 0 } }],
                            body: [
                                {
                                    kind: "assign",
                                    target: holder,
                                    op: "=",
                                    value: { kind: "procRef", index: 0, stringify: true },
                                },
                                { kind: "callStmt", target: holder, args: [], checkArgCount: true },
                                {
                                    kind: "expr",
                                    expr: { kind: "call", target: { kind: "string", value: "target" }, args: [] },
                                },
                            ],
                        },
                    },
                ],
            }),
        ).toBeGreaterThan(0);
    });
});

describe.skipIf(!wasmPresent)("lowering refusals", () => {
    let parser: Parser;

    beforeAll(async () => {
        await Parser.init({ wasmBinary: fs.readFileSync(path.join(WASM_DIR, "web-tree-sitter.wasm")) });
        parser = new Parser();
        parser.setLanguage(await Language.load(path.join(WASM_DIR, "tree-sitter-ssl.wasm")));
    });

    const refuse = (source: string) => () => compileText(parser, source);

    it("refuses source the parser could not read, naming where it gave up", () => {
        // A name the grammar cannot spell puts ERROR nodes in the tree. Lowering walks past those and
        // would emit a program assembled from the fragments around them, which is why the refusal is
        // the behaviour under test - "it compiled" would be the bug.
        expect(refuse("procedure start begin\n variable &x;\nend\n")).toThrow(CompileError);
        // The line is the contract - the server turns this prefix into a diagnostic position - while
        // the column is wherever tree-sitter chose to open the error node.
        expect(refuse("procedure start begin\n variable &x;\nend\n")).toThrow(/^2:\d+: syntax error$/);
    });

    it("names a construct the source left unfinished", () => {
        expect(refuse("procedure start begin\n variable x := 1;\n")).toThrow(/^3:1: missing end$/);
    });

    it("names an unknown identifier", () => {
        expect(refuse("procedure start begin\n variable x;\n x := nope;\nend\n")).toThrow(/unknown identifier 'nope'/);
    });

    it("names an unknown call target", () => {
        expect(refuse("procedure start begin\n call nope;\nend\n")).toThrow(/unknown procedure 'nope'/);
    });

    it("rejects a non-literal global initialiser", () => {
        expect(refuse("variable g := random(1, 2);\nprocedure start begin end\n")).toThrow(/must be a literal/);
    });

    it("rejects assigning to something that is not a variable", () => {
        expect(refuse("procedure foo begin end\nprocedure start begin\n foo := 1;\nend\n")).toThrow(
            /assignment target must be a variable/,
        );
    });

    it("rejects compound assignment into an array element", () => {
        // The reference generates temporaries for this; until that is reproduced, refusing beats
        // emitting a plausible-looking instruction sequence that is subtly wrong.
        expect(refuse("procedure start begin\n variable a;\n a[0] += 1;\nend\n")).toThrow(
            /compound assignment to an element/,
        );
    });

    it("rejects a timed call", () => {
        expect(refuse("procedure foo begin end\nprocedure start begin\n call foo in 5;\nend\n")).toThrow(
            /timed calls are not lowered/,
        );
    });

    it("rejects a procedure declared but never defined", () => {
        // Without this the slot emits an empty body, so every call to it silently returns.
        expect(refuse("procedure ghost;\nprocedure start begin\n call ghost;\nend\n")).toThrow(
            /procedure 'ghost' is declared but never defined/,
        );
    });

    it("reports an undefined procedure at its declaration", () => {
        expect(refuse("\n\nprocedure ghost;\nprocedure start begin end\n")).toThrow(/^3:1:/);
    });

    it("accepts a forward declaration that is defined later", () => {
        expect(
            refuse("procedure later;\nprocedure start begin\n call later;\nend\nprocedure later begin end\n"),
        ).not.toThrow();
    });

    it("reports the line the problem is on", () => {
        expect(refuse("procedure start begin\n\n\n x := nope;\nend\n")).toThrow(/^4:/);
    });
});

/**
 * A name can belong to a procedure and to a variable at once, and which one a mention means depends on
 * where it sits. Corpus scripts avoid the collision, so nothing else pins the choice.
 */
describe.skipIf(!wasmPresent)("name resolution when a variable shadows a procedure", () => {
    let parser: Parser;

    beforeAll(async () => {
        await Parser.init({ wasmBinary: fs.readFileSync(path.join(WASM_DIR, "web-tree-sitter.wasm")) });
        parser = new Parser();
        parser.setLanguage(await Language.load(path.join(WASM_DIR, "tree-sitter-ssl.wasm")));
    });

    /** The lowered body of the named procedure. */
    const bodyOf = (source: string, name: string): Stmt[] => {
        const tree = parser.parse(source);
        if (!tree) throw new Error("no tree");
        try {
            const declaration = lowerProgram(tree).declarations.find(
                (d) => d.kind === "procedure" && d.procedure.name.toLowerCase() === name,
            );
            if (declaration?.kind !== "procedure") throw new Error(`no procedure '${name}'`);
            return declaration.procedure.body;
        } finally {
            tree.delete();
        }
    };

    // `stuff` here is the procedure, its own first parameter, and the value being assigned - the one
    // spelling has to resolve three different ways in a single statement.
    const collision = [
        "procedure stuff(variable stuff, variable n);",
        "procedure stuff(variable stuff, variable n) begin",
        "   stuff := stuff(stuff, n);",
        "end",
        "",
    ].join("\n");

    it("calls the procedure, not the parameter, when the name is in call position", () => {
        const [statement] = bodyOf(collision, "stuff");
        expect(statement).toEqual({
            kind: "assign",
            op: "=",
            // Assigned into slot 0, the parameter - not into the procedure.
            target: { kind: "var", scope: "local", index: 0, name: "stuff" },
            value: {
                kind: "call",
                target: { kind: "procRef", index: 0 },
                args: [
                    { kind: "var", scope: "local", index: 0, name: "stuff" },
                    { kind: "var", scope: "local", index: 1, name: "n" },
                ],
            },
        });
    });

    it("reads the variable, not the procedure, when the name stands alone", () => {
        // Without the parentheses the same name is a value, so the local wins; were the procedure to
        // win here it would be silently called instead, since a bare procedure name calls it.
        const [statement] = bodyOf(
            [
                "procedure stuff(variable stuff);",
                "procedure stuff(variable stuff) begin",
                "   return stuff;",
                "end",
                "",
            ].join("\n"),
            "stuff",
        );
        expect(statement).toEqual({
            kind: "return",
            value: { kind: "var", scope: "local", index: 0, name: "stuff" },
        });
    });
});

describe.skipIf(!wasmPresent)("lowering shapes the corpus does not exercise", () => {
    let parser: Parser;

    beforeAll(async () => {
        await Parser.init({ wasmBinary: fs.readFileSync(path.join(WASM_DIR, "web-tree-sitter.wasm")) });
        parser = new Parser();
        parser.setLanguage(await Language.load(path.join(WASM_DIR, "tree-sitter-ssl.wasm")));
    });

    const compiles = (source: string) => compileText(parser, source).length;

    it("compiles a program with no start procedure", () => {
        // The entry jump keeps pointing at the exit instruction, so loading it is harmless.
        expect(compiles("procedure foo begin end\n")).toBeGreaterThan(0);
    });

    it("compiles an imported variable and a hex literal", () => {
        expect(compiles("import variable g;\nprocedure start begin\n g := 0x1F;\nend\n")).toBeGreaterThan(0);
    });

    it("compiles a foreach with an explicit key over an expression", () => {
        expect(
            compiles(
                "procedure start begin\n variable k;\n variable v;\n foreach k: v in load_array(1) begin\n  v := k;\n end\nend\n",
            ),
        ).toBeGreaterThan(0);
    });

    it("compiles nested member and subscript access", () => {
        expect(compiles("procedure start begin\n variable a;\n variable x;\n x := a.b[1].c;\nend\n")).toBeGreaterThan(
            0,
        );
    });

    it("compiles a source exercising every construct the lowering supports", () => {
        // One source rather than many: the lowering is a large switch, and a single script touching
        // every arm is both cheaper to maintain and closer to how real code arrives.
        const source = [
            "import variable shared_in;",
            "export variable shared_out := 7;",
            "variable g_int := 1;",
            "variable g_float := 2.5;",
            'variable g_str := "hi";',
            "variable g_neg := -3;",
            "variable g_true := true;",
            "variable g_paren := (5);",
            "procedure fwd(variable a, variable b := 2);",
            "pure procedure pure_one begin end",
            "inline procedure inline_one begin end",
            "procedure fwd(variable a, variable b := 2) begin",
            "   return a + b;",
            "end",
            "procedure callee begin return 1; end",
            "procedure start begin",
            "   variable i;",
            "   variable arr;",
            "   variable m;",
            '   variable s := "local";',
            '   variable esc := "a\\nb\\tc";',
            "   variable lp := (6);",
            "   variable f := 1.25;",
            "   variable cb;",
            "   arr := [1, 2, [3, 4]];",
            '   m := {"a": 1, "b": [2]};',
            "   arr[0] := 9;",
            "   m.a := 8;",
            "   i := arr[0] + m.a;",
            "   i := (7 div 2) ^ 2 % 3;",
            "   i := -i;",
            "   i := not i;",
            "   i := bwnot i;",
            "   i := floor f;",
            "   i := i bwand 1 bwor 2 bwxor 3;",
            "   i := (i > 1) and (i < 9) or (i == 2) and (i != 3);",
            "   i := (i >= 1) andalso (i <= 9) orelse (i == 0);",
            "   i := 1 if i else 2;",
            "   i++;",
            "   i--;",
            "   i += 1; i -= 1; i *= 2; i /= 2;",
            "   g_int := 5;",
            "   shared_out := 6;",
            "   i := shared_in;",
            "   call callee;",
            "   call fwd(1);",
            "   i := callee;",
            "   i := fwd(1, 2);",
            "   cb := @callee;",
            "   for (variable j := 0; j < 3; j++) begin continue; end",
            "   for (i := 0; i < 3; i += 1) begin i := i; end",
            "   foreach i in arr begin i := i; end",
            "   foreach (variable k: v in m) begin v := k; end",
            "   while (i < 2) do begin i += 1; if (i == 1) then break; end",
            "   switch (i + 1) begin",
            "      case 1: i := 10;",
            "      case 2: i := 20;",
            "      default: i := 30;",
            "   end",
            "   switch i begin case 1: 0; end",
            "   if (i) then begin i := 1; end else if (i == 2) then begin i := 2; end else begin i := 3; end",
            "   if (i) then return;",
            "   display_msg(s);",
            "   ;",
            "   return i;",
            "end",
        ].join("\n");
        expect(compileText(parser, source).length).toBeGreaterThan(0);
    });

    it("compiles from a file, running the preprocessor first", () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ssl-cf-"));
        fs.writeFileSync(path.join(dir, "inc.h"), "#define GREETING 42\n");
        fs.writeFileSync(
            path.join(dir, "main.ssl"),
            '#include "inc.h"\nprocedure start begin\n variable x := GREETING;\nend\n',
        );
        try {
            expect(compileFile(parser, path.join(dir, "main.ssl")).length).toBeGreaterThan(0);
        } finally {
            fs.rmSync(dir, { recursive: true, force: true });
        }
    });

    it("compiles a while loop containing a break", () => {
        expect(compiles("procedure start begin\n while (1) do begin\n  break;\n end\nend\n")).toBeGreaterThan(0);
    });
});
