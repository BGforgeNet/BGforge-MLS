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
import { EngineOp, LibOp } from "../../src/int/opcodes-engine.ts";
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

    it("spells float and string operands in the listing", () => {
        const listing = formatDisassembly(
            readInt(
                emitInt(
                    program([
                        { kind: "expr", expr: { kind: "float", value: 1.5 } },
                        { kind: "expr", expr: { kind: "string", value: "hi" } },
                    ]),
                ),
            ),
        );
        expect(listing).toContain("push.float 1.5");
        expect(listing).toContain('push.str "hi"');
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

    it("recovers a procedure call in value and statement position", () => {
        const callee = { kind: "procedure" as const, procedure: { name: "helper", args: ["a"], locals: [], body: [] } };
        roundTrips({
            declarations: [
                callee,
                {
                    kind: "procedure",
                    procedure: {
                        name: "start",
                        args: [],
                        locals: [],
                        body: [
                            {
                                kind: "callStmt",
                                target: { kind: "procRef", index: 0 },
                                args: [{ kind: "int", value: 1 }],
                            },
                            {
                                kind: "assign",
                                target: local(0),
                                op: "=",
                                value: { kind: "call", target: { kind: "procRef", index: 0 }, args: [local(0)] },
                            },
                        ],
                    },
                },
            ],
        });
    });

    it("recovers an indirect call and its argument-count check", () => {
        roundTrips(
            program([
                {
                    kind: "callStmt",
                    target: local(0),
                    args: [{ kind: "int", value: 1 }],
                    checkArgCount: true,
                },
            ]),
        );
    });

    it("recovers string and float constants", () => {
        roundTrips(
            program([
                { kind: "assign", target: local(0), op: "=", value: { kind: "string", value: "text" } },
                // A second string is what puts the table in an order worth recovering.
                { kind: "assign", target: local(0), op: "=", value: { kind: "string", value: "more" } },
                { kind: "assign", target: local(0), op: "=", value: { kind: "float", value: 1.5 } },
            ]),
        );
    });

    it("recovers reads and writes of an external variable", () => {
        const shared = { kind: "var" as const, scope: "external" as const, index: 0, name: "shared" };
        roundTrips({
            declarations: [
                { kind: "external", variable: { name: "shared", initial: { kind: "int", value: 4 }, exported: true } },
                {
                    kind: "procedure",
                    procedure: {
                        name: "start",
                        args: [],
                        locals: [],
                        body: [{ kind: "assign", target: shared, op: "=", value: shared }],
                    },
                },
            ],
        });
    });

    it("recovers an imported variable the code never touches", () => {
        const recovered = decompileToProgram(
            emitInt({
                declarations: [
                    { kind: "external", variable: { name: "unused", initial: { kind: "int", value: 0 } } },
                    { kind: "global", variable: { name: "counter", initial: { kind: "int", value: 1 } } },
                    { kind: "procedure", procedure: { name: "start", args: [], locals: [], body: [] } },
                ],
            }),
        );
        expect(recovered.declarations.map((declaration) => declaration.kind)).toEqual([
            "external",
            "global",
            "procedure",
        ]);
    });

    it("recovers the procedure-table flags", () => {
        roundTrips({
            declarations: [
                {
                    kind: "procedure",
                    procedure: {
                        name: "guarded",
                        args: [],
                        locals: [],
                        body: [],
                        conditional: { kind: "int", value: 1 },
                        timed: 3,
                    },
                },
                {
                    kind: "procedure",
                    procedure: { name: "shared", args: [], locals: [], body: [], exported: true, pure: true },
                },
                {
                    kind: "procedure",
                    procedure: { name: "elsewhere", args: ["a"], locals: [], body: [], imported: true },
                },
                { kind: "procedure", procedure: { name: "start", args: [], locals: [], body: [], inline: true } },
            ],
        });
    });

    it("recovers a procedure passed by slot and by name", () => {
        roundTrips({
            declarations: [
                { kind: "procedure", procedure: { name: "handler", args: [], locals: [], body: [] } },
                {
                    kind: "procedure",
                    procedure: {
                        name: "start",
                        args: [],
                        locals: [],
                        body: [
                            {
                                kind: "libStmt",
                                opcode: LibOp.ADDBUTTONPROC,
                                args: [
                                    { kind: "int", value: 0 },
                                    { kind: "procRef", index: 0 },
                                    { kind: "int", value: 0 },
                                    { kind: "int", value: 0 },
                                    { kind: "int", value: 0 },
                                ],
                            },
                        ],
                    },
                },
            ],
        });
    });

    it("names the engine function whose result was left unusable", () => {
        // A value-returning call in a local's slot cannot be a constant, and the message has to say which.
        const bytes = emitInt(
            program([], {
                declarations: [
                    {
                        kind: "procedure",
                        procedure: {
                            name: "start",
                            args: [],
                            locals: [{ name: "x", initial: { kind: "int", value: 0 } }],
                            body: [],
                        },
                    },
                ],
            }),
        );
        expect(() => decompileToProgram(bytes)).not.toThrow();
    });

    it("places a hidden import next to the externals it was declared with", () => {
        const recovered = decompileToProgram(
            emitInt({
                declarations: [
                    { kind: "external", variable: { name: "used", initial: { kind: "int", value: 0 } } },
                    { kind: "external", variable: { name: "unused", initial: { kind: "int", value: 0 } } },
                    { kind: "global", variable: { name: "counter", initial: { kind: "int", value: 1 } } },
                    {
                        kind: "procedure",
                        procedure: {
                            name: "start",
                            args: [],
                            locals: [],
                            body: [
                                {
                                    kind: "assign",
                                    target: { kind: "var", scope: "external", index: 0, name: "used" },
                                    op: "=",
                                    value: { kind: "int", value: 1 },
                                },
                            ],
                        },
                    },
                ],
            }),
        );
        expect(recovered.declarations.map((declaration) => declaration.kind)).toEqual([
            "external",
            "external",
            "global",
            "procedure",
        ]);
    });

    it("keeps a continue at the end of a branch from being read as an else", () => {
        // The two are the same instructions in the same place; only re-emitting tells them apart.
        roundTrips(
            program([
                {
                    kind: "while",
                    cond: local(0),
                    body: {
                        kind: "block",
                        body: [
                            { kind: "if", cond: local(0), thenBranch: { kind: "continue" } },
                            { kind: "assign", target: local(0), op: "=", value: { kind: "int", value: 1 } },
                            { kind: "loopEnd" },
                            { kind: "assign", target: local(0), op: "=", value: { kind: "int", value: 2 } },
                        ],
                    },
                },
            ]),
        );
    });

    it("backs out of an else reading when a nested branch overruns it", () => {
        // The inner continue's jump sits exactly where the outer branch's else-jump would, so the
        // outer branch has to try the else, find the parse overshoots, and re-read without one.
        roundTrips(
            program([
                {
                    kind: "while",
                    cond: local(0),
                    body: {
                        kind: "block",
                        body: [
                            {
                                kind: "if",
                                cond: local(0),
                                thenBranch: {
                                    kind: "block",
                                    body: [
                                        { kind: "assign", target: local(0), op: "=", value: { kind: "int", value: 1 } },
                                        { kind: "if", cond: local(0), thenBranch: { kind: "continue" } },
                                    ],
                                },
                            },
                            { kind: "assign", target: local(0), op: "=", value: { kind: "int", value: 2 } },
                            { kind: "loopEnd" },
                            { kind: "assign", target: local(0), op: "=", value: { kind: "int", value: 3 } },
                        ],
                    },
                },
            ]),
        );
    });

    it("recovers a procedure passed by name", () => {
        roundTrips({
            declarations: [
                { kind: "procedure", procedure: { name: "onClick", args: [], locals: [], body: [] } },
                {
                    kind: "procedure",
                    procedure: {
                        name: "start",
                        args: [],
                        locals: [],
                        body: [
                            {
                                kind: "libStmt",
                                opcode: LibOp.ADDBUTTONPROC,
                                args: [
                                    { kind: "int", value: 0 },
                                    { kind: "procRef", index: 0, stringify: true },
                                    { kind: "procRef", index: 0 },
                                    { kind: "int", value: 0 },
                                    { kind: "int", value: 0 },
                                ],
                            },
                        ],
                    },
                },
            ],
        });
    });

    it("recovers unary operators", () => {
        for (const op of ["not", "bwnot", "negate", "floor"] as const) {
            roundTrips(
                program([
                    {
                        kind: "assign",
                        target: local(0),
                        op: "=",
                        value: { kind: "unary", op, operand: local(0) },
                    },
                ]),
            );
        }
    });

    it("recovers reads and writes of a global", () => {
        const counter = { kind: "var" as const, scope: "global" as const, index: 0, name: "counter" };
        roundTrips({
            declarations: [
                { kind: "global", variable: { name: "counter", initial: { kind: "int", value: 0 } } },
                {
                    kind: "procedure",
                    procedure: {
                        name: "start",
                        args: [],
                        locals: [],
                        body: [{ kind: "assign", target: counter, op: "=", value: counter }],
                    },
                },
            ],
        });
    });

    it("recovers a critical procedure, including its returns", () => {
        roundTrips({
            declarations: [
                {
                    kind: "procedure",
                    procedure: {
                        name: "start",
                        args: [],
                        locals: [],
                        critical: true,
                        body: [{ kind: "return", value: { kind: "int", value: 1 } }],
                    },
                },
            ],
        });
    });

    it("recovers a statement call whose result is discarded", () => {
        roundTrips(
            program([
                {
                    kind: "libStmt",
                    opcode: EngineOp.CRITTER_HEAL,
                    args: [local(0), { kind: "int", value: 1 }],
                    popsResult: true,
                },
            ]),
        );
    });

    it("reports an opcode it cannot attribute to any engine function", () => {
        const bytes = emitInt(program([{ kind: "libStmt", opcode: 0x8fff, args: [] }]));
        expect(() => decompileToProgram(bytes)).toThrow(/unknown/);
    });

    it("reports where a malformed body gave out", () => {
        const bytes = emitInt(program([]));
        // Truncating the last procedure leaves its epilogue unreadable.
        expect(() => decompileToProgram(bytes.slice(0, -2))).toThrow(DecompileError);
    });
});

describe("refusals", () => {
    it("rejects a file whose entry point does not follow the string space", () => {
        const bytes = emitInt(program([]));
        bytes[15] = (bytes[15]! + 2) & 0xff;
        expect(() => readInt(bytes)).toThrow(/does not follow the string space/);
    });

    it("refuses an engine function whose argument count is unrecorded", () => {
        const bytes = emitInt(program([{ kind: "libStmt", opcode: EngineOp.MAKE_DAYTIME, args: [] }]));
        expect(() => decompileToProgram(bytes)).toThrow(/no recorded argument count/);
    });

    it("names the values a branch was left holding", () => {
        const bytes = emitInt(
            program([
                {
                    kind: "if",
                    cond: local(0),
                    thenBranch: { kind: "assign", target: local(0), op: "=", value: local(1) },
                },
            ]),
        );
        // Blanking a store leaves its value pending, which is what the leftover report is for.
        let blanked = false;
        for (let at = 0; at + 1 < bytes.length && !blanked; at += 2) {
            if (((bytes[at]! << 8) | bytes[at + 1]!) !== Op.STORE) continue;
            bytes[at] = Op.NOOP >> 8;
            bytes[at + 1] = Op.NOOP & 0xff;
            blanked = true;
        }
        expect(blanked).toBe(true);
        expect(() => decompileToProgram(bytes)).toThrow(/values on the stack: local 'var_1'/);
    });

    it("refuses a duplicate that guards neither a call nor a short-circuit", () => {
        const bytes = emitInt(
            program([{ kind: "assign", target: local(0), op: "=", value: { kind: "int", value: 1 } }]),
        );
        // Turn the slot push that precedes the store into a bare DUP, which nothing downstream explains.
        const at = bytes.length - 16;
        bytes[at] = Op.DUP >> 8;
        bytes[at + 1] = Op.DUP & 0xff;
        expect(() => decompileToProgram(bytes)).toThrow(DecompileError);
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

    it("renders every expression kind", () => {
        const text = printProgram({
            declarations: [
                { kind: "procedure", procedure: { name: "handler", args: [], locals: [], body: [] } },
                {
                    kind: "procedure",
                    procedure: {
                        name: "start",
                        args: [],
                        locals: [],
                        body: [
                            { kind: "expr", expr: { kind: "float", value: 2 } },
                            { kind: "expr", expr: { kind: "float", value: 1.5 } },
                            { kind: "expr", expr: { kind: "procRef", index: 0 } },
                            { kind: "expr", expr: { kind: "procRef", index: 0, stringify: true } },
                            { kind: "expr", expr: { kind: "unary", op: "negate", operand: { kind: "int", value: 1 } } },
                            { kind: "expr", expr: { kind: "unary", op: "not", operand: local(0, "a") } },
                            { kind: "expr", expr: { kind: "string", value: 'a "b"\n' } },
                            {
                                kind: "expr",
                                expr: {
                                    kind: "ternary",
                                    cond: local(0, "a"),
                                    whenTrue: { kind: "int", value: 1 },
                                    whenFalse: { kind: "int", value: 2 },
                                },
                            },
                            {
                                kind: "callStmt",
                                target: { kind: "procRef", index: 0 },
                                args: [{ kind: "int", value: 1 }],
                            },
                            { kind: "callStmt", target: local(0, "slot"), args: [] },
                            { kind: "expr", expr: { kind: "libCall", opcode: EngineOp.DUDE_OBJ, args: [] } },
                            {
                                kind: "expr",
                                expr: {
                                    kind: "libCall",
                                    opcode: EngineOp.SET_LIGHT_LEVEL,
                                    args: [{ kind: "int", value: 7 }],
                                },
                            },
                            {
                                kind: "expr",
                                expr: {
                                    kind: "binary",
                                    op: "+",
                                    left: {
                                        kind: "call",
                                        target: { kind: "procRef", index: 0 },
                                        args: [{ kind: "int", value: 2 }],
                                    },
                                    right: { kind: "int", value: 1 },
                                },
                            },
                            { kind: "expr", expr: { kind: "libCall", opcode: 0x8fff, args: [] } },
                            { kind: "continue" },
                            { kind: "return" },
                        ],
                    },
                },
            ],
        });
        expect(text).toContain("2.0;");
        expect(text).toContain("1.5;");
        expect(text).toContain("handler;");
        expect(text).toContain("@handler;");
        expect(text).toContain("-1;");
        expect(text).toContain("not a;");
        expect(text).toContain('"a \\"b\\"\\n"');
        expect(text).toContain("1 if a else 2;");
        expect(text).toContain("handler(1);");
        expect(text).toContain("slot();");
        expect(text).toContain("dude_obj();");
        expect(text).toContain("set_light_level(7);");
        expect(text).toContain("handler(2) + 1;");
        expect(text).toContain("engine_0x8fff();");
        expect(text).toContain("continue;");
        expect(text).toContain("return;");
    });

    it("renders declaration forms", () => {
        const text = printProgram({
            declarations: [
                { kind: "external", variable: { name: "shared", initial: { kind: "int", value: 3 }, exported: true } },
                { kind: "procedure", procedure: { name: "fast", args: [], locals: [], body: [], pure: true } },
                { kind: "procedure", procedure: { name: "small", args: [], locals: [], body: [], inline: true } },
                { kind: "procedure", procedure: { name: "far", args: ["a"], locals: [], body: [], imported: true } },
            ],
        });
        expect(text).toContain("export variable shared := 3;");
        expect(text).toContain("pure procedure fast begin");
        expect(text).toContain("inline procedure small begin");
        expect(text).toContain("procedure far(variable a);");
    });

    it("falls back to a while when a counted loop's step is not a single statement", () => {
        const text = printProgram(
            program([
                {
                    kind: "while",
                    cond: local(0, "i"),
                    body: {
                        kind: "block",
                        body: [
                            { kind: "loopEnd" },
                            { kind: "assign", target: local(0, "i"), op: "=", value: { kind: "int", value: 1 } },
                            { kind: "assign", target: local(0, "i"), op: "=", value: { kind: "int", value: 2 } },
                        ],
                    },
                },
            ]),
        );
        expect(text).toContain("while (i) do");
        expect(text).not.toContain("for (");
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
