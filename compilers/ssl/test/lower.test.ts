/**
 * Unit tests for the parts of the pipeline the corpus differential cannot reach.
 *
 * That differential proves the happy path exhaustively - every script the reference can build compiles
 * byte-identically - but by construction it only exercises code real scripts reach. What it never
 * touches is the refusal behaviour: the lowering is written to refuse rather than emit something
 * approximate, and an unexercised refusal is a promise nobody has checked. These tests hold the compiler
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
import { LowerError, lowerProgram } from "../src/lower.ts";
import type { Program, Stmt } from "../src/int/ir.ts";
import { REPO_ROOT } from "../../../shared/cli/test/repo-root.ts";

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

    it("refuses an engine call with the wrong number of arguments, in either direction", () => {
        // The opcode pops a fixed count whatever was pushed, so a miscounted call unbalances the stack
        // for everything after it - the compiled script is unreadable, not merely wrong at that line.
        expect(refuse("procedure start begin\n display_msg();\nend\n")).toThrow(
            /^2:2: 'display_msg' takes 1 argument, not 0$/,
        );
        expect(refuse('procedure start begin\n display_msg("a", "b");\nend\n')).toThrow(
            /'display_msg' takes 1 argument, not 2/,
        );
        expect(refuse('procedure start begin\n display_msg("a");\nend\n')).not.toThrow();
    });

    it("names an unknown call target", () => {
        expect(refuse("procedure start begin\n call nope;\nend\n")).toThrow(/unknown procedure 'nope'/);
    });

    it("takes a negated parameter default, but not one whose operand is parenthesised", () => {
        // The operator must be followed by the constant itself. Parentheses around the WHOLE default are
        // read before the operator and fold away, so `((-7))` is a constant expression while `-(7)` is
        // not, and neither is `- -7`. That boundary is the reference's, and it is why the wrapper peel
        // in `constantOf` stops at a group node instead of unwrapping everything it finds.
        const declare = (value: string) =>
            `procedure p(variable a = ${value});\nprocedure p(variable a) begin end\nprocedure start begin\n call p;\nend\n`;
        expect(refuse(declare("-1"))).not.toThrow();
        expect(refuse(declare("((-7))"))).not.toThrow();
        expect(refuse(declare("-(7)"))).toThrow(/^1:26: initial value must be a literal, got param_default_unary$/);
        expect(refuse(declare("- -7"))).toThrow(/^1:26: initial value must be a literal, got param_default_unary$/);
    });

    it.each(["break", "continue"])("rejects %s outside a loop, at the statement", (what) => {
        // `break` compiled silently before this guard: it emits a bare jump consuming the exit address a
        // loop leaves on the stack, so outside one it jumped into whatever happened to be there.
        expect(refuse(`procedure start begin\n ${what};\nend\n`)).toThrow(
            new RegExp(`^2:2: '${what}' outside a loop$`),
        );
    });

    it("accepts break in a loop nested inside a conditional", () => {
        expect(refuse("procedure start begin\n while (1) do begin\n  if (1) then break;\n end\nend\n")).not.toThrow();
    });

    it("rejects a procedure called as a bare statement", () => {
        // Only an engine function may be called without `call`. Compiling this would produce a script
        // the compiler the user actually builds with refuses, which is the worse of the two failures.
        const source =
            "procedure foo(variable a);\nprocedure foo(variable a) begin end\nprocedure start begin\n foo(1);\nend\n";
        expect(refuse(source)).toThrow(/^4:2: 'foo' is not an engine function; write 'call foo\(\.\.\.\)'$/);
    });

    it("rejects a bare variable as a statement", () => {
        expect(refuse("variable g;\nprocedure start begin\n g;\nend\n")).toThrow(/^3:2: assignment operator expected$/);
    });

    it("still accepts the statement forms that are not assignments", () => {
        // An engine call needs no `call`, one that takes nothing needs no parentheses either, and a lone
        // literal is the language's no-op. The parenthesis-free form appears in nearly every real script,
        // so rejecting it as "not an assignment" breaks the whole corpus - it did, once.
        expect(refuse('procedure start begin\n display_msg("x");\n refresh_pc_art;\n 0;\nend\n')).not.toThrow();
    });

    it.each(["-(7)", "not (0)", "- -7"])("rejects %s as a global initialiser", (initial) => {
        // Parentheses are read BEFORE the operator, so the operand of a unary has to be the constant
        // itself. `((-7))` is the same value written the way the language accepts.
        expect(refuse(`variable g := ${initial};\nprocedure start begin\n g := g;\nend\n`)).toThrow(
            /initial value must be a literal/,
        );
    });

    it("accepts a negation inside the parentheses", () => {
        expect(refuse("variable g := ((-7));\nprocedure start begin\n g := g;\nend\n")).not.toThrow();
    });

    it.each([
        [
            "a timed procedure marked pure",
            "pure procedure foo in 5 begin end\nprocedure start begin end\n",
            /cannot be 'pure'/,
        ],
        [
            "a conditional procedure marked inline",
            "variable g;\ninline procedure foo when (g) begin end\nprocedure start begin end\n",
            /cannot be 'inline'/,
        ],
        [
            "a forward-declared inline procedure",
            "inline procedure foo;\ninline procedure foo begin end\nprocedure start begin call foo; end\n",
            /cannot be forward-declared/,
        ],
        [
            "a return inside an inline procedure",
            "inline procedure foo begin return 1; end\nprocedure start begin call foo; end\n",
            /an inline procedure cannot return/,
        ],
        [
            "a default before a required parameter",
            "procedure foo(variable a := 1, variable b) begin end\nprocedure start begin call foo(1, 2); end\n",
            /cannot precede one without/,
        ],
        [
            "a definition that changes the parameter count",
            "procedure foo(variable a);\nprocedure foo(variable a, variable b) begin end\nprocedure start begin end\n",
            /declared with 1 parameters/,
        ],
        [
            "a definition that restates a default",
            "procedure foo(variable a := 1);\nprocedure foo(variable a := 1) begin end\nprocedure start begin call foo; end\n",
            /defaults belong to that declaration/,
        ],
    ])("rejects %s", (_name, source, message) => {
        expect(refuse(source)).toThrow(message);
    });

    it("accepts the header shapes those rules leave legal", () => {
        // The default on the declaration alone, an undeclared procedure carrying its own, and a
        // redeclaration that simply matches.
        expect(
            refuse(
                "procedure foo(variable a := 1);\nprocedure foo(variable a) begin end\nprocedure start begin call foo; end\n",
            ),
        ).not.toThrow();
        expect(refuse("procedure foo(variable a := 1) begin end\nprocedure start begin call foo; end\n")).not.toThrow();
        expect(
            refuse(
                "procedure foo(variable a);\nprocedure foo(variable a) begin end\nprocedure start begin call foo(1); end\n",
            ),
        ).not.toThrow();
    });

    it("rejects the prefix increment the language does not have", () => {
        // `x++` is a statement; `++x` is not a second spelling of it, in a statement or an expression.
        expect(refuse("procedure start begin\n variable x;\n ++x;\nend\n")).toThrow(/syntax error/);
        expect(refuse("procedure start begin\n variable x;\n x++;\nend\n")).not.toThrow();
    });

    it("rejects an inline procedure used as a value, but not called", () => {
        // `inline` pastes the body into the caller, so there is nothing to take a value from.
        expect(refuse("inline procedure foo begin end\nprocedure start begin\n variable x := foo;\nend\n")).toThrow(
            /'foo' is an inline procedure and has no value/,
        );
        expect(refuse("inline procedure foo begin end\nprocedure start begin\n call foo;\nend\n")).not.toThrow();
    });

    it.each(["/", "%", "div"])("rejects division by a literal zero with %s", (op) => {
        expect(refuse(`procedure start begin\n variable x;\n x := 7 ${op} 0;\nend\n`)).toThrow(/division by zero/);
    });

    it("sees a zero divisor through parentheses and a false", () => {
        // The language's own check looks at the constant the divisor emits, which parentheses do not
        // change; `false` is the same zero written another way.
        expect(refuse("procedure start begin\n variable x;\n x := 7 / (0);\nend\n")).toThrow(/division by zero/);
        expect(refuse("procedure start begin\n variable x;\n x := 7 / false;\nend\n")).toThrow(/division by zero/);
        expect(refuse("procedure start begin\n variable x;\n x := 7 / (2);\nend\n")).not.toThrow();
    });

    it("rejects a chained comparison but not a parenthesised one", () => {
        const chain = "procedure start begin\n variable a;\n variable b;\n variable c;\n a := b == c == 1;\nend\n";
        expect(refuse(chain)).toThrow(/comparisons do not chain/);
        // Parentheses make the inner comparison an operand, which the language does accept.
        expect(
            refuse("procedure start begin\n variable a;\n variable b;\n variable c;\n a := (b == c) == 1;\nend\n"),
        ).not.toThrow();
    });

    it("rejects an array declaration outside a procedure", () => {
        // The creation is a statement, so a global has nowhere to run it. Accepting the declaration
        // would leave the slot holding no array, which is worse than refusing it.
        expect(refuse("variable g[5];\nprocedure start begin\n g[0] := 1;\nend\n")).toThrow(
            /^1:12: array declarations are only allowed on a local variable$/,
        );
    });

    it("rejects a non-literal global initialiser", () => {
        expect(refuse("variable g := random(1, 2);\nprocedure start begin end\n")).toThrow(/must be a literal/);
    });

    /**
     * The reference accepts every one of these: it resolves the procedure's name to a number that is no
     * variable slot and stores into the local frame at that offset, which the frame does not reach. The
     * engine indexes its value stack there, so the write lands past the end or on an unrelated live value.
     * Refusing is the difference; nothing in the corpus writes to a procedure's name.
     */
    it.each([
        [
            "assignment",
            "procedure foo begin end\nprocedure start begin\n foo := 1;\nend\n",
            /^3:2: assignment target must be a variable$/,
        ],
        [
            "increment",
            "procedure foo begin end\nprocedure start begin\n foo++;\nend\n",
            /^3:2: increment target must be a variable$/,
        ],
        [
            "a for target",
            "procedure p begin end\nprocedure start begin\n for (p := 0; 1; p := 1) begin end\nend\n",
            /^3:7: for target must be a variable$/,
        ],
        [
            "a foreach variable",
            "procedure p begin end\nvariable arr;\nprocedure start begin\n foreach p in arr begin end\nend\n",
            /^4:2: foreach loop variable is not a variable$/,
        ],
    ])("rejects a procedure's name as %s target", (_what, source, message) => {
        expect(refuse(source)).toThrow(message);
    });

    it("compiles compound assignment into an array element", () => {
        expect(refuse("procedure start begin\n variable a;\n a[0] += 1;\nend\n")).not.toThrow();
    });

    it("rejects a timed call that passes arguments", () => {
        // The engine schedules the procedure rather than entering it, so there is no frame to put
        // arguments in; the reference refuses this at code generation for the same reason.
        expect(refuse("procedure foo(variable a) begin end\nprocedure start begin\n call foo(1) in 5;\nend\n")).toThrow(
            /timed call cannot pass arguments/,
        );
    });

    /**
     * `pure` promises the procedure has no side effects, which is what lets a call whose result nothing
     * reads be dropped. `call` discards the result, so it asks for exactly the effects that were promised
     * away - the reference refuses all three spellings, and this compiler accepted them until it was asked.
     */
    it.each([
        ["bare", "call helper;", /^5:9: 'helper' is a pure procedure; use its value instead of 'call'$/],
        ["with parentheses", "call helper();", /^5:9: 'helper\(\)' is a pure procedure/],
        ["timed", "call helper in 5;", /^5:9: 'helper' is a pure procedure/],
    ])("rejects a %s call of a pure procedure", (_form, statement, message) => {
        const source = `pure procedure helper begin\n   return 1;\nend\nprocedure start begin\n   ${statement}\nend\n`;
        expect(refuse(source)).toThrow(message);
    });

    it("accepts a pure procedure used for its value, which is what the modifier is for", () => {
        expect(
            refuse(
                "pure procedure helper begin\n return 1;\nend\nprocedure start begin\n variable x := helper();\nend\n",
            ),
        ).not.toThrow();
    });

    it("rejects a delay that is not an integer on a timed procedure", () => {
        // The value lands in the procedure table, which is written before any code runs.
        expect(refuse("variable g := 2;\nprocedure foo in g begin end\n")).toThrow(
            /^2:18: a timed procedure's delay must be an integer$/,
        );
        // A float is constant and still refused: the field is read as an unsigned deadline, so its bit
        // pattern is a deadline in the past rather than the delay that was written. The reference emits it.
        expect(refuse("procedure foo in 1.5 begin end\n")).toThrow(
            /^1:18: a timed procedure's delay must be an integer$/,
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

describe.skipIf(!wasmPresent)("the critical procedure modifier", () => {
    let parser: Parser;

    beforeAll(async () => {
        await Parser.init({ wasmBinary: fs.readFileSync(path.join(WASM_DIR, "web-tree-sitter.wasm")) });
        parser = new Parser();
        parser.setLanguage(await Language.load(path.join(WASM_DIR, "tree-sitter-ssl.wasm")));
    });

    /** The lowered declaration of the named procedure. */
    const procedureOf = (source: string, name: string) => {
        const tree = parser.parse(source);
        if (!tree) throw new Error("no tree");
        try {
            const declaration = lowerProgram(tree).declarations.find(
                (d) => d.kind === "procedure" && d.procedure.name.toLowerCase() === name,
            );
            if (declaration?.kind !== "procedure") throw new Error(`no procedure '${name}'`);
            return declaration.procedure;
        } finally {
            tree.delete();
        }
    };

    it("sets the flag from the definition", () => {
        expect(procedureOf("critical procedure foo begin end\n", "foo").critical).toBe(true);
    });

    it("combines with another modifier, which must follow it", () => {
        const procedure = procedureOf("critical pure procedure foo begin end\n", "foo");
        expect(procedure.critical).toBe(true);
        expect(procedure.pure).toBe(true);
    });

    it("sets the flag when only the forward declaration carries it", () => {
        // The slot is allocated at the declaration, so a definition that omits the modifier must not
        // clear what the declaration already set.
        const source = "critical procedure foo;\nprocedure foo begin end\n";
        expect(procedureOf(source, "foo").critical).toBe(true);
    });

    it("leaves an unmarked procedure alone", () => {
        expect(procedureOf("procedure foo begin end\n", "foo").critical).toBeUndefined();
    });

    it("lowers a timed procedure's delay into the table", () => {
        expect(procedureOf("procedure foo in 5 begin end\n", "foo").timed).toBe(5);
    });

    it("lowers a guarded procedure's condition outside the body", () => {
        const procedure = procedureOf("procedure foo when (1) begin end\n", "foo");
        expect(procedure.conditional).toEqual({ kind: "int", value: 1 });
        expect(procedure.body).toEqual([]);
    });

    it("reads a cheap index twice rather than spending a temporary on it", () => {
        // A literal or a variable fetch costs nothing to re-emit and cannot observe being read twice.
        const body = procedureOf("procedure start begin\n variable a;\n a[0] += 1;\nend\n", "start").body;
        expect(body).toHaveLength(1);
        expect(body[0]?.kind).toBe("libStmt");
    });

    it("evaluates a side-effecting index once, into a temporary", () => {
        // Without the temporary the call would be emitted twice and so would fire twice.
        const source =
            "procedure idx begin\n return 1;\nend\nprocedure start begin\n variable a;\n a[idx()] += 1;\nend\n";
        const procedure = procedureOf(source, "start");
        const body = procedure.body;
        expect(body).toHaveLength(1);
        expect(body[0]?.kind).toBe("block");
        const block = body[0] as Extract<Stmt, { kind: "block" }>;
        // One assignment holding the call, then the set_array that reads the temporary twice.
        expect(block.body.map((s) => s.kind)).toEqual(["assign", "libStmt"]);
        expect(procedure.locals.map((l) => l.name)).toContain("tmp.0");
    });

    it("lowers a timed call to its own statement, with no arguments", () => {
        const source = "procedure foo begin end\nprocedure start begin\n call foo in 10;\nend\n";
        expect(procedureOf(source, "start").body).toEqual([
            { kind: "timedCallStmt", target: { kind: "procRef", index: 0 }, delay: { kind: "int", value: 10 } },
        ]);
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
            // The default is stated by the forward declaration alone - restating it here is refused, the
            // way the language refuses it, so that one declaration owns what a short call pads with.
            "procedure fwd(variable a, variable b) begin",
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

/**
 * The whole escape table, not the rows the corpus happens to use.
 *
 * The corpus reaches `\n` and little else, so a differential over it cannot tell a correct table from a
 * partial one - `\v` was decoded as the letter `v` for as long as this compiler has existed, and 1517
 * matching scripts said nothing about it. Every row here is the reference compiler's own mapping.
 */
describe.skipIf(!wasmPresent)("string escapes", () => {
    let parser: Parser;

    beforeAll(async () => {
        await Parser.init({ wasmBinary: fs.readFileSync(path.join(WASM_DIR, "web-tree-sitter.wasm")) });
        parser = new Parser();
        parser.setLanguage(await Language.load(path.join(WASM_DIR, "tree-sitter-ssl.wasm")));
    });

    /** The decoded value of a string literal, read off the local it initialises. */
    const decode = (literal: string): string => {
        const tree = parser.parse(`procedure start begin\n variable s := ${literal};\nend\n`);
        if (!tree) throw new Error("no tree");
        try {
            const declaration = lowerProgram(tree).declarations.find((d) => d.kind === "procedure");
            if (declaration?.kind !== "procedure") throw new Error("no procedure");
            const initial = declaration.procedure.locals[0]?.initial;
            if (initial?.kind !== "string") throw new Error(`local is ${initial?.kind ?? "absent"}, not a string`);
            return initial.value;
        } finally {
            tree.delete();
        }
    };

    it.each([
        ["\\a", "\u0007"],
        ["\\b", "\b"],
        ["\\f", "\f"],
        ["\\n", "\n"],
        ["\\r", "\r"],
        ["\\t", "\t"],
        // A vertical tab is what the escape spells and NOT what it produces: the reference maps it to a
        // horizontal tab, so a script's compiled bytes carry 0x09.
        ["\\v", "\t"],
        ["\\\\", "\\"],
        ['\\"', '"'],
        // An escape the table does not list keeps its own character.
        ["\\z", "z"],
        ["\\0", "0"],
    ])("decodes %j", (escape, expected) => {
        expect(decode(`"x${escape}y"`)).toBe(`x${expected}y`);
    });

    it("joins literals written next to each other", () => {
        expect(decode('"ab" "cd"')).toBe("abcd");
        // Whitespace between them includes a line break: a long message is written across lines.
        expect(decode('"ab"\n   "cd"\t"ef"')).toBe("abcdef");
    });
});

describe.skipIf(!wasmPresent)("character constants", () => {
    let parser: Parser;

    beforeAll(async () => {
        await Parser.init({ wasmBinary: fs.readFileSync(path.join(WASM_DIR, "web-tree-sitter.wasm")) });
        parser = new Parser();
        parser.setLanguage(await Language.load(path.join(WASM_DIR, "tree-sitter-ssl.wasm")));
    });

    /** The integer a character constant lowers to. */
    const value = (literal: string): number => {
        const tree = parser.parse(`procedure start begin\n variable c := ${literal};\nend\n`);
        if (!tree) throw new Error("no tree");
        try {
            const declaration = lowerProgram(tree).declarations.find((d) => d.kind === "procedure");
            if (declaration?.kind !== "procedure") throw new Error("no procedure");
            const initial = declaration.procedure.locals[0]?.initial;
            if (initial?.kind !== "int") throw new Error(`local is ${initial?.kind ?? "absent"}, not an int`);
            return initial.value;
        } finally {
            tree.delete();
        }
    };

    it.each([
        ["'A'", 65],
        ["' '", 32],
        ["'\\n'", 10],
        ["'\\t'", 9],
        // `\v` is a tab here too, the same way it is inside a string.
        ["'\\v'", 9],
        // `\0` marks the octal form; the two or three digits after it carry the value.
        ["'\\012'", 10],
        ["'\\0101'", 65],
    ])("%s is %d", (literal, expected) => {
        expect(value(literal)).toBe(expected);
    });

    it("refuses an escape neither table defines", () => {
        expect(() => value("'\\z'")).toThrow(/unknown escape '\\z' in a character constant/);
    });
});

/**
 * Reporting every mistake in a script, rather than the first.
 *
 * Only sites reachable by a CLEAN parse report this way - the tree has already been refused if it holds
 * an ERROR or MISSING node, so a "malformed X" guard firing after that means this file and the grammar
 * disagree, which is a defect here rather than in the script. Those still throw, so a poison value never
 * travels into code with no reason to expect one.
 */
describe.skipIf(!wasmPresent)("collecting semantic errors", () => {
    let parser: Parser;

    beforeAll(async () => {
        await Parser.init({ wasmBinary: fs.readFileSync(path.join(WASM_DIR, "web-tree-sitter.wasm")) });
        parser = new Parser();
        parser.setLanguage(await Language.load(path.join(WASM_DIR, "tree-sitter-ssl.wasm")));
    });

    /** The whole list a refused lowering carries. */
    function errorsOf(source: string): readonly LowerError[] {
        try {
            compileText(parser, source);
        } catch (error) {
            if (error instanceof LowerError) return error.all;
            throw error;
        }
        throw new Error("expected the compile to be refused");
    }

    it("names every unresolved identifier, not just the first", () => {
        const errors = errorsOf("procedure start begin\n a := 1;\n b := 2;\n c := 3;\nend\n");

        expect(errors.map((e) => e.detail)).toEqual([
            "unknown identifier 'a'",
            "unknown identifier 'b'",
            "unknown identifier 'c'",
        ]);
    });

    it("reports one misspelling once however many times it is used", () => {
        // The cascade that makes collecting worse than not collecting, if it is not controlled: thirty
        // uses of one typo would bury every other mistake in the script.
        const errors = errorsOf("procedure start begin\n nope := 1;\n nope := 2;\n nope := 3;\nend\n");

        expect(errors).toHaveLength(1);
        expect(errors[0]!.line).toBe(2);
    });

    it("collects errors of different kinds in one pass", () => {
        const errors = errorsOf("procedure start begin\n variable x;\n x := 1 / 0;\n break;\nend\n");

        expect(errors.map((e) => e.detail)).toEqual(["division by zero", "'break' outside a loop"]);
    });

    it("keeps looking after a statement it had to drop", () => {
        const errors = errorsOf("procedure start begin\n variable x;\n x;\n y := 1;\nend\n");

        expect(errors.map((e) => e.detail)).toEqual(["assignment operator expected", "unknown identifier 'y'"]);
    });

    it("keeps the first error's message and position exactly as a single-error compile had them", () => {
        // The language server places the diagnostic from this prefix, and a caller that shows one error
        // still shows this one.
        expect(() => compileText(parser, "procedure start begin\n nope := 1;\n also := 2;\nend\n")).toThrow(
            /^2:2: unknown identifier 'nope'$/,
        );
    });

    it("emits nothing while there is anything to report", () => {
        // The guarantee that makes collecting safe: a poison value can never reach an output file.
        expect(() => compileText(parser, "procedure start begin\n nope := 1;\nend\n")).toThrow(LowerError);
    });

    it("collects a declaration-pass error alongside the body errors that follow it", () => {
        // The two passes are separate walks, and a mistake in the first used to stop the second running.
        const errors = errorsOf("variable g[10];\nprocedure start begin\n nope := 1;\nend\n");

        expect(errors.map((e) => e.detail)).toEqual([
            "array declarations are only allowed on a local variable",
            "unknown identifier 'nope'",
        ]);
    });

    it("reports each construct the language has no form for and keeps walking", () => {
        const errors = errorsOf(
            [
                "procedure start begin",
                " variable a;",
                " variable b;",
                " a := b++;", // the step operators are statements, not expressions
                " a := a in b;", // membership: the grammar has the operator, the language does not
                " a := '\\q';", // an escape outside the character table
                " switch a begin end",
                " nope := 1;",
                "end",
                "",
            ].join("\n"),
        );

        expect(errors.map((e) => e.detail)).toEqual([
            "unsupported unary operator '++'",
            "unsupported operator 'in'",
            "unknown escape '\\q' in a character constant",
            "switch statement with no cases",
            "unknown identifier 'nope'",
        ]);
    });

    it("keeps walking into a loop the language will not accept", () => {
        const errors = errorsOf(
            "procedure start begin\n variable i;\n for (i := 0; ; i++) begin\n  nope := 1;\n end\nend\n",
        );

        expect(errors.map((e) => e.detail)).toEqual(["for loop has no condition", "unknown identifier 'nope'"]);
    });

    it("reports an inline procedure used as a value without stopping there", () => {
        const errors = errorsOf(
            "inline procedure f begin end\nprocedure start begin\n variable a;\n a := f;\n nope := 1;\nend\n",
        );

        expect(errors.map((e) => e.detail)).toEqual([
            "'f' is an inline procedure and has no value",
            "unknown identifier 'nope'",
        ]);
    });

    it("does not add a second complaint about a name it has already reported", () => {
        // Every site that checks its target is a variable sees the stand-in an unresolved name lowers
        // to. Complaining about that is complaining about this file's own substitution.
        const errors = errorsOf("procedure start begin\n rand++;\n for (gone := 0; 1; ) begin end\nend\n");

        expect(errors.map((e) => e.detail)).toEqual(["unknown identifier 'rand'", "unknown identifier 'gone'"]);
    });
});

/**
 * Warnings: what the compiler says about a script it nonetheless compiled.
 *
 * The corpus cannot validate these the way it validates the emitted bytes - a warning changes no output,
 * so a green differential says nothing about whether one fires when it should. What it CAN say is whether
 * they fire when they should not, and across 1526 real scripts these produce four warnings, all true. A
 * check that cried wolf on valid code would be worse than no check, so each one here is pinned both ways:
 * it fires on the case it is for, and the clean script stays silent.
 */
describe.skipIf(!wasmPresent)("compile warnings", () => {
    let parser: Parser;

    beforeAll(async () => {
        await Parser.init({ wasmBinary: fs.readFileSync(path.join(WASM_DIR, "web-tree-sitter.wasm")) });
        parser = new Parser();
        parser.setLanguage(await Language.load(path.join(WASM_DIR, "tree-sitter-ssl.wasm")));
    });

    /** Every warning a successful compile produced, formatted as the CLI shows them. */
    function warningsOf(source: string): string[] {
        const out: string[] = [];
        compileText(parser, source, { onWarning: (w) => out.push(`${w.line}:${w.column}: ${w.message}`) });
        return out;
    }

    it("warns about an escape no table entry covers, per occurrence", () => {
        // `"C:\path\to"` is the case worth catching: `\t` IS an escape, so the string silently holds a
        // tab, while `\p` merely loses its backslash. Only the unrecognised one is worth a word.
        expect(warningsOf('procedure start begin\n variable s := "C:\\path\\to";\nend\n')).toEqual([
            "2:16: unknown escape '\\p' in a string; it stands for 'p'",
        ]);
    });

    it("says nothing about the escapes the table does cover", () => {
        expect(warningsOf('procedure start begin\n variable s := "a\\nb\\tc\\\\d\\"e";\nend\n')).toEqual([]);
    });

    it("warns that a repeated declaration is ignored rather than applied", () => {
        // Both compilers keep the FIRST declaration and drop this one, so the initialiser written here
        // never runs - which is exactly the surprise worth naming.
        expect(warningsOf("variable g := 1;\nvariable g := 2;\nprocedure start begin end\n")).toEqual([
            "2:10: 'g' is already declared; this declaration is ignored",
        ]);
        expect(warningsOf("procedure start begin\n variable x;\n variable x;\nend\n")).toEqual([
            "3:11: 'x' is already declared in this procedure; this declaration is ignored",
        ]);
    });

    it("does not mistake the temporaries it allocates for redeclarations", () => {
        // `foreach` allocates several temporaries through the same path a declaration takes; naming them
        // would make the warning fire on code that declares nothing twice.
        expect(warningsOf("variable arr;\nprocedure start begin\n foreach variable v in arr begin end\nend\n")).toEqual(
            [],
        );
    });

    it("warns when nothing can enter the script", () => {
        expect(warningsOf("procedure helper begin end\n")).toEqual([
            "1:1: no 'start' procedure: the engine has no entry point into this script",
        ]);
    });

    it("emits the same bytes whether or not anyone is listening for warnings", () => {
        // The sink must not reach code generation: `-n` is meant to change what is said about a compile,
        // never what it produces.
        const source = 'procedure helper begin\n variable s := "C:\\path";\n variable s;\nend\n';
        const quiet = compileText(parser, source);
        const loud = compileText(parser, source, { onWarning: () => {} });

        expect([...quiet]).toEqual([...loud]);
    });
});
