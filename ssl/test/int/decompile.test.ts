/**
 * Decompiler unit tests.
 *
 * The corpus differential in `test/integration` is what says how much of the language round-trips; this
 * file pins the pieces that corpus cannot reach - malformed input, the container reader's own error
 * paths, and the constructs whose two readings the decompiler has to choose between.
 */

import { describe, expect, it } from "vitest";
import { emitInt } from "../../src/int/emit.ts";
import { decompileToProgram, DecompileError } from "../../src/int/decompile.ts";
import { printProgram } from "../../src/int/print.ts";
import { readInt, IntReadError } from "../../src/int/read.ts";
import { decodeRange, formatDisassembly, mnemonic, toFloat } from "../../src/int/disasm.ts";
import { EngineOp } from "../../src/int/opcodes-engine.ts";
import { Op } from "../../src/int/opcodes.ts";
import type { Expr, Program, Stmt } from "../../src/int/ir.ts";

function program(body: Stmt[], extra: Partial<Program> = {}): Program {
    return {
        declarations: [{ kind: "procedure", procedure: { name: "start", args: [], locals: [], body } }],
        ...extra,
    };
}

/** Emitting then decompiling must reproduce the tree, which the byte comparison below proves. */
function roundTrips(input: Program): void {
    const bytes = emitInt(input);
    expect(emitInt(decompileToProgram(bytes))).toEqual(bytes);
}

const local = (index: number, name = `var_${index}`): Extract<Expr, { kind: "var" }> => ({
    kind: "var",
    scope: "local",
    index,
    name,
});

describe("readInt", () => {
    it("rejects a file too short to hold a procedure table", () => {
        expect(() => readInt(new Uint8Array(8))).toThrow(IntReadError);
    });

    it("rejects a procedure count that overruns the file", () => {
        const bytes = new Uint8Array(64);
        bytes[45] = 0xff;
        expect(() => readInt(bytes)).toThrow(/overruns the file/);
    });

    it("reads back the tables it was given", () => {
        const file = readInt(emitInt(program([{ kind: "expr", expr: { kind: "string", value: "hello" } }])));
        expect([...file.strings.values()]).toContain("hello");
        expect(file.procedures.map((procedure) => procedure.name)).toContain("start");
    });
});

describe("disassembly", () => {
    it("decodes a constant push as one six-byte instruction", () => {
        const decoded = decodeRange(Uint8Array.from([0xc0, 0x01, 0, 0, 0, 7, 0x80, 0x1a]), 0, 8);
        expect(decoded).toEqual([
            { address: 0, opcode: 0xc001, operand: 7, size: 6 },
            { address: 6, opcode: Op.POP, size: 2 },
        ]);
    });

    it("refuses a truncated operand rather than reading past the end", () => {
        expect(() => decodeRange(Uint8Array.from([0xc0, 0x01, 0, 0]), 0, 4)).toThrow(/truncated push operand/);
    });

    it("names core, engine and unknown opcodes", () => {
        expect(mnemonic(Op.PUSH_BASE)).toBe("PUSH_BASE");
        expect(mnemonic(EngineOp.TS_DIV)).toBe("TS_DIV");
        expect(mnemonic(0x8fff)).toBe("op_0x8fff");
    });

    it("reinterprets a float operand from its bit pattern", () => {
        expect(toFloat(0x3f800000)).toBe(1);
    });

    it("labels each procedure in the listing", () => {
        const listing = formatDisassembly(readInt(emitInt(program([]))));
        expect(listing).toContain("start:");
        expect(listing).toContain("PUSH_BASE");
    });
});

describe("decompiling", () => {
    it("recovers an assignment", () => {
        roundTrips(program([{ kind: "assign", target: local(0), op: "=", value: { kind: "int", value: 3 } }]));
    });

    it("recovers arithmetic and comparison", () => {
        for (const op of ["+", "-", "*", "/", "%", "==", "!=", "<", ">", "<=", ">="] as const) {
            roundTrips(
                program([
                    {
                        kind: "assign",
                        target: local(0),
                        op: "=",
                        value: { kind: "binary", op, left: local(0), right: { kind: "int", value: 2 } },
                    },
                ]),
            );
        }
    });

    it("recovers the engine's own division and exponentiation operators", () => {
        for (const op of ["div", "^"] as const) {
            roundTrips(
                program([
                    {
                        kind: "assign",
                        target: local(0),
                        op: "=",
                        value: { kind: "binary", op, left: local(0), right: { kind: "int", value: 2 } },
                    },
                ]),
            );
        }
    });

    it("recovers a branch with and without an else", () => {
        const assign: Stmt = { kind: "assign", target: local(0), op: "=", value: { kind: "int", value: 1 } };
        roundTrips(program([{ kind: "if", cond: local(0), thenBranch: assign }]));
        roundTrips(program([{ kind: "if", cond: local(0), thenBranch: assign, elseBranch: assign }]));
    });

    it("recovers a conditional expression rather than reading it as a branch", () => {
        const ternary: Expr = {
            kind: "ternary",
            cond: local(0),
            whenTrue: { kind: "int", value: 1 },
            whenFalse: { kind: "int", value: 2 },
        };
        roundTrips(program([{ kind: "assign", target: local(0), op: "=", value: ternary }]));
    });

    it("recovers a loop with break and continue", () => {
        roundTrips(
            program([
                {
                    kind: "while",
                    cond: local(0),
                    body: {
                        kind: "block",
                        body: [
                            { kind: "if", cond: local(0), thenBranch: { kind: "break" } },
                            { kind: "if", cond: local(0), thenBranch: { kind: "continue" } },
                            { kind: "assign", target: local(0), op: "=", value: { kind: "int", value: 0 } },
                        ],
                    },
                },
            ]),
        );
    });

    it("recovers a counted loop's continue target", () => {
        roundTrips(
            program([
                {
                    kind: "while",
                    cond: local(0),
                    body: {
                        kind: "block",
                        body: [
                            { kind: "if", cond: local(0), thenBranch: { kind: "continue" } },
                            { kind: "loopEnd" },
                            {
                                kind: "assign",
                                target: local(0),
                                op: "=",
                                value: { kind: "binary", op: "+", left: local(0), right: { kind: "int", value: 1 } },
                            },
                        ],
                    },
                },
            ]),
        );
    });

    it("recovers both short-circuit operators", () => {
        for (const op of ["andalso", "orelse"] as const) {
            roundTrips(
                program([
                    {
                        kind: "assign",
                        target: local(0),
                        op: "=",
                        value: { kind: "binary", op, left: local(0), right: { kind: "int", value: 1 } },
                    },
                ]),
            );
        }
    });

    it("recovers an engine call in both statement and value position", () => {
        roundTrips(program([{ kind: "libStmt", opcode: EngineOp.SET_LIGHT_LEVEL, args: [{ kind: "int", value: 1 }] }]));
        roundTrips(
            program([
                {
                    kind: "assign",
                    target: local(0),
                    op: "=",
                    value: { kind: "libCall", opcode: EngineOp.DUDE_OBJ, args: [] },
                },
            ]),
        );
    });

    it("recovers an engine result nothing consumes as a statement", () => {
        // `use_obj_on_obj` is documented as returning a value, yet the reference emits no discard for
        // it in statement position; the decompiler has to read that from the code, not the signature.
        const bytes = emitInt(
            program([
                { kind: "libStmt", opcode: EngineOp.USE_OBJ_ON_OBJ, args: [local(0), local(0)] },
                { kind: "libStmt", opcode: EngineOp.SET_LIGHT_LEVEL, args: [{ kind: "int", value: 1 }] },
            ]),
        );
        const recovered = decompileToProgram(bytes);
        const first = recovered.declarations[0];
        const body = first?.kind === "procedure" ? first.procedure.body : [];
        expect(body.map((statement) => statement.kind)).toEqual(["libStmt", "libStmt"]);
        expect(emitInt(recovered)).toEqual(bytes);
    });

    it("recovers globals, externals and their initial values", () => {
        roundTrips({
            declarations: [
                { kind: "global", variable: { name: "count", initial: { kind: "int", value: 7 } } },
                { kind: "external", variable: { name: "shared", initial: { kind: "int", value: 1 }, exported: true } },
                { kind: "procedure", procedure: { name: "start", args: [], locals: [], body: [] } },
            ],
        });
    });

    it("keeps declaration order across variables and procedures", () => {
        const recovered = decompileToProgram(
            emitInt({
                declarations: [
                    { kind: "global", variable: { name: "first", initial: { kind: "int", value: 0 } } },
                    { kind: "procedure", procedure: { name: "middle", args: [], locals: [], body: [] } },
                    { kind: "global", variable: { name: "last", initial: { kind: "int", value: 0 } } },
                ],
            }),
        );
        expect(
            recovered.declarations.map((declaration) =>
                declaration.kind === "procedure" ? declaration.procedure.name : declaration.variable.name,
            ),
        ).toEqual(["first", "middle", "last"]);
    });

    it("recovers a procedure's arguments and locals", () => {
        const recovered = decompileToProgram(
            emitInt({
                declarations: [
                    {
                        kind: "procedure",
                        procedure: {
                            name: "start",
                            args: ["a", "b"],
                            locals: [{ name: "x", initial: { kind: "int", value: 5 } }],
                            body: [],
                        },
                    },
                ],
            }),
        );
        const first = recovered.declarations[0];
        const procedure = first?.kind === "procedure" ? first.procedure : null;
        expect(procedure?.args).toHaveLength(2);
        expect(procedure?.locals).toEqual([{ name: "var_2", initial: { kind: "int", value: 5 } }]);
    });

    it("reports where a malformed body gave out", () => {
        const bytes = emitInt(program([]));
        // Truncating the last procedure leaves its epilogue unreadable.
        expect(() => decompileToProgram(bytes.slice(0, -2))).toThrow(DecompileError);
    });
});

describe("printing", () => {
    it("renders declarations, control flow and calls as source", () => {
        const text = printProgram(
            {
                declarations: [
                    { kind: "global", variable: { name: "count", initial: { kind: "int", value: 2 } } },
                    { kind: "external", variable: { name: "shared", initial: { kind: "int", value: 0 } } },
                    {
                        kind: "procedure",
                        procedure: {
                            name: "start",
                            args: ["who"],
                            locals: [{ name: "x", initial: { kind: "string", value: "hi" } }],
                            body: [
                                {
                                    kind: "if",
                                    cond: {
                                        kind: "binary",
                                        op: "==",
                                        left: local(0, "who"),
                                        right: { kind: "int", value: 1 },
                                    },
                                    thenBranch: {
                                        kind: "libStmt",
                                        opcode: EngineOp.SET_LIGHT_LEVEL,
                                        args: [{ kind: "int", value: 1 }],
                                    },
                                    elseBranch: { kind: "return", value: { kind: "int", value: 0 } },
                                },
                                { kind: "while", cond: local(0, "who"), body: { kind: "break" } },
                            ],
                        },
                    },
                ],
            },
            { origin: "test.int" },
        );
        expect(text).toContain("// Decompiled from test.int.");
        expect(text).toContain("variable count := 2;");
        expect(text).toContain("import variable shared;");
        expect(text).toContain("procedure start(variable who) begin");
        expect(text).toContain('variable x := "hi";');
        expect(text).toContain("if (who == 1) then");
        expect(text).toContain("set_light_level(1);");
        expect(text).toContain("return 0;");
        expect(text).toContain("while (who) do");
        expect(text).toContain("break;");
    });

    it("notes procedure flags the language cannot spell", () => {
        const text = printProgram({
            declarations: [
                {
                    kind: "procedure",
                    procedure: {
                        name: "guard",
                        args: [],
                        locals: [],
                        body: [],
                        exported: true,
                        timed: 5,
                        conditional: { kind: "int", value: 1 },
                    },
                },
            ],
        });
        expect(text).toContain("// guard is exported, timed at 5, guarded by 1.");
    });

    it("renders a counted loop as a for when a continue target marks one", () => {
        const text = printProgram(
            program([
                {
                    kind: "while",
                    cond: local(0, "i"),
                    body: {
                        kind: "block",
                        body: [
                            { kind: "loopEnd" },
                            {
                                kind: "assign",
                                target: local(0, "i"),
                                op: "=",
                                value: {
                                    kind: "binary",
                                    op: "+",
                                    left: local(0, "i"),
                                    right: { kind: "int", value: 1 },
                                },
                            },
                        ],
                    },
                },
            ]),
        );
        expect(text).toContain("for (; i; i = i + 1)");
    });

    it("parenthesises compound operands but not leaves", () => {
        const text = printProgram(
            program([
                {
                    kind: "expr",
                    expr: {
                        kind: "binary",
                        op: "and",
                        left: { kind: "binary", op: "==", left: local(0, "a"), right: { kind: "int", value: 1 } },
                        right: local(1, "b"),
                    },
                },
            ]),
        );
        expect(text).toContain("(a == 1) and b;");
    });
});
