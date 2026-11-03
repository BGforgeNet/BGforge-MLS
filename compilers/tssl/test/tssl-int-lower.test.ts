/**
 * The TSSL front end that targets the compiler's IR directly, with no SSL text in between.
 *
 * These assert the tree it builds and the refusals it gives for what it does not yet lower. What they
 * deliberately do NOT assert is agreement with the text route - that needs the tree-sitter grammar built,
 * so it lives in `pnpm tssl-int-diff`, which compares compiled bytes across both routes.
 */
import { describe, expect, it, beforeAll, afterAll } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { emitProgram } from "@bgforge/ssl";
import { lowerTsslProgram } from "../src/int/lower";

let tmpDir: string;
let fileSeq = 0;

beforeAll(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "tssl-int-"));
});

afterAll(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
});

function lower(source: string): ReturnType<typeof lowerTsslProgram> {
    const file = path.join(tmpDir, `case${fileSeq++}.tssl`);
    fs.writeFileSync(file, source, "utf-8");
    return lowerTsslProgram(file, source);
}

describe("declarations", () => {
    it("allocates a procedure slot per kept function, in emission order", () => {
        const program = lower("function helper() {\n    return 1;\n}\nfunction start() {\n    helper();\n}\n");
        expect(program.declarations.map((d) => (d.kind === "procedure" ? d.procedure.name : d.kind))).toEqual([
            "helper",
            "start",
        ]);
    });

    it("folds a literal initialiser into the slot instead of assigning it", () => {
        const program = lower("function start() {\n    let count = 7;\n}\n");
        const [first] = program.declarations;
        if (first?.kind !== "procedure") throw new Error("expected a procedure");
        expect(first.procedure.locals).toEqual([{ name: "count", initial: { kind: "int", value: 7 } }]);
        // The slot already holds it, so the body emits nothing at all.
        expect(first.procedure.body).toEqual([]);
    });

    // `e` is an exponent only in a decimal spelling; in hex it is a digit, and the value stays an integer.
    it.each<[string, { kind: "int" | "float"; value: number }]>([
        ["0xFE", { kind: "int", value: 254 }],
        ["0xe", { kind: "int", value: 14 }],
        ["1e3", { kind: "float", value: 1000 }],
        ["1E-3", { kind: "float", value: 0.001 }],
        ["2.5", { kind: "float", value: 2.5 }],
        // Binary and octal are integers by value, whatever spelling the text route writes them in.
        ["0b101", { kind: "int", value: 5 }],
        ["0o17", { kind: "int", value: 15 }],
        // A numeric separator is spelling only: the value is the literal without it.
        ["1_000", { kind: "int", value: 1000 }],
        ["0xFF_FF", { kind: "int", value: 65535 }],
        ["1_000.5", { kind: "float", value: 1000.5 }],
    ])("types the literal %s by its spelling", (literal, initial) => {
        const [first] = lower(`function start() {\n    let x = ${literal};\n}\n`).declarations;
        if (first?.kind !== "procedure") throw new Error("expected a procedure");
        expect(first.procedure.locals).toEqual([{ name: "x", initial }]);
    });

    it("interns strings in written order, which is what fixes the string table", () => {
        const program = lower('function start() {\n    display_msg("first");\n    display_msg("second");\n}\n');
        expect(program.stringLiterals).toEqual(["first", "second"]);
    });

    it("builds a program the emitter accepts", () => {
        const program = lower('function start() {\n    display_msg("hi");\n}\n');
        expect(emitProgram(program).length).toBeGreaterThan(0);
    });

    it("gives arguments the first local slots, so locals index after them", () => {
        const program = lower("function start(a: number, b: number) {\n    let c = 0;\n    c = a + b;\n}\n");
        const [first] = program.declarations;
        if (first?.kind !== "procedure") throw new Error("expected a procedure");
        expect(first.procedure.args).toEqual(["a", "b"]);
        const assignment = first.procedure.body[0];
        if (assignment?.kind !== "assign") throw new Error("expected an assignment");
        // `c` is the third slot: two arguments precede it.
        expect(assignment.target.index).toBe(2);
    });

    it("does not fold a negation in expression position, where it is a push and a NEGATE", () => {
        const program = lower("function start() {\n    let x = 0;\n    x = -1;\n}\n");
        const [first] = program.declarations;
        if (first?.kind !== "procedure") throw new Error("expected a procedure");
        const assignment = first.procedure.body[0];
        if (assignment?.kind !== "assign") throw new Error("expected an assignment");
        expect(assignment.value).toEqual({ kind: "unary", op: "negate", operand: { kind: "int", value: 1 } });
    });

    it("lowers a local function as a procedure when an uncalled @inline one elsewhere shares its name", () => {
        const lib = `lib${fileSeq}`;
        fs.writeFileSync(
            path.join(tmpDir, `${lib}.ts`),
            "/** @inline */\nexport function twice(v: number): number {\n    return add(v, v);\n}\nexport function touch(): void {}\n",
            "utf-8",
        );
        const program = lower(
            `import { touch } from "./${lib}";\nfunction twice(v: number): number {\n    return v * 2;\n}\nfunction start() {\n    touch();\n    display_msg(twice(3));\n}\n`,
        );
        expect(program.declarations.map((d) => (d.kind === "procedure" ? d.procedure.name : d.kind))).toEqual([
            "touch",
            "twice",
            "start",
        ]);
    });

    // TypeScript's `?:` is right-associative: the chain is `a ? 1 : (b ? 2 : 3)`, not `(a ? 1 : b) ? 2 : 3`.
    it("lowers a ternary chain with the nested conditional as the alternative", () => {
        const program = lower(
            "function start(a: number, b: number) {\n    let x = 0;\n    x = a ? 1 : b ? 2 : 3;\n}\n",
        );
        const [first] = program.declarations;
        if (first?.kind !== "procedure") throw new Error("expected a procedure");
        const assignment = first.procedure.body[0];
        if (assignment?.kind !== "assign") throw new Error("expected an assignment");
        expect(assignment.value).toEqual({
            kind: "ternary",
            cond: { kind: "var", scope: "local", index: 0, name: "a" },
            whenTrue: { kind: "int", value: 1 },
            whenFalse: {
                kind: "ternary",
                cond: { kind: "var", scope: "local", index: 1, name: "b" },
                whenTrue: { kind: "int", value: 2 },
                whenFalse: { kind: "int", value: 3 },
            },
        });
    });

    it("lowers a left shift by a literal count to a multiply, SSL having no shift", () => {
        const program = lower("function start() {\n    let x = 0;\n    x = 5 << 12;\n}\n");
        const [first] = program.declarations;
        if (first?.kind !== "procedure") throw new Error("expected a procedure");
        const assignment = first.procedure.body[0];
        if (assignment?.kind !== "assign") throw new Error("expected an assignment");
        expect(assignment.value).toEqual({
            kind: "binary",
            op: "*",
            left: { kind: "int", value: 5 },
            right: { kind: "int", value: 4096 },
        });
    });

    it("folds a negation into a global's slot, where an initial value must be constant", () => {
        const program = lower("let g = -1;\nfunction start() {\n    display_msg(g);\n}\n");
        const global = program.declarations.find((d) => d.kind === "global");
        expect(global?.kind === "global" && global.variable.initial).toEqual({ kind: "int", value: -1 });
    });
});

describe("refusals", () => {
    it.each([
        ["an unknown identifier", "function start() {\n    display_msg(nope);\n}\n", /unknown identifier 'nope'/],
        ["an operator with no mapping", "function start() {\n    let x = 1 in 2;\n}\n", /'in' is not lowered yet/],
        [
            "a shift by a computed count",
            "function start() {\n    let n = 2;\n    let x = 1 << n;\n}\n",
            /'<<' needs an integer literal count from 0 to 31/,
        ],
        ["a right shift", "function start() {\n    let x = 8 >> 1;\n}\n", /'>>' is not supported; SSL has no shift/],
        [
            "a statement with no mapping",
            "function start() {\n    do {} while (1);\n}\n",
            /DoStatement is not lowered yet/,
        ],
        // Reported by the expansion shared with the SSL front end, not by this file.
        [
            "a switch with no cases",
            "function start() {\n    switch (1) {\n    }\n}\n",
            /switch statement with no cases/,
        ],
        ["a for loop with no condition", "function start() {\n    for (;;) {}\n}\n", /for loop has no condition/],
        [
            "a top-level statement",
            "let g = 1;\ng = 2;\nfunction start() {\n    display_msg(g);\n}\n",
            /only declarations belong at the top level/,
        ],
        [
            "a property of something that is not an enum",
            "const cfg = { id: 7 };\nfunction start() {\n    display_msg(cfg.id);\n}\n",
            /'cfg\.id' is not lowered yet: of property accesses, only an enum member's is/,
        ],
        [
            "an integer literal past 32 bits",
            "function start() {\n    let x = 0;\n    x = 4294967296 + 1;\n}\n",
            /integer literal 4294967296 does not fit in 32 bits/,
        ],
    ])("refuses %s rather than approximating it", (_name, source, message) => {
        expect(() => lower(source)).toThrow(message);
    });
});

describe("destructuring", () => {
    // The text route refuses this; without the same refusal here the two disagree, and this side would
    // declare a local literally named "[p, q]".
    it("refuses a destructured local", () => {
        // `pair` is declared, so lowering reaches the destructured declaration rather than dying on an
        // unknown identifier first - which is what the refusal has to be provoked past.
        expect(() => lower("function start() {\n    let pair = [1, 2];\n    let [p, q] = pair;\n}\n")).toThrow(
            /destructuring/,
        );
    });

    // The two-element form a for-of takes is a different construct and must keep working.
    it("still lowers the key/value pattern a for-of takes", () => {
        const program = lower(
            "function start() {\n    let m = [1, 2];\n    for (const [k, v] of m) {\n        display_msg(k);\n    }\n}\n",
        );
        expect(program.declarations.length).toBeGreaterThan(0);
    });
});
