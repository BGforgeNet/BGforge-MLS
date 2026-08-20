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
import { emitProgram } from "../../compilers/ssl/src/compile";
import { lowerTsslProgram } from "../tssl/src/int/lower";

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

    it("folds a negation into a global's slot, where an initial value must be constant", () => {
        const program = lower("let g = -1;\nfunction start() {\n    display_msg(g);\n}\n");
        const global = program.declarations.find((d) => d.kind === "global");
        expect(global?.kind === "global" && global.variable.initial).toEqual({ kind: "int", value: -1 });
    });
});

describe("refusals", () => {
    it.each([
        ["an unknown identifier", "function start() {\n    display_msg(nope);\n}\n", /unknown identifier 'nope'/],
        ["an operator with no mapping", "function start() {\n    let x = 1 << 2;\n}\n", /'<<' is not lowered yet/],
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
    ])("refuses %s rather than approximating it", (_name, source, message) => {
        expect(() => lower(source)).toThrow(message);
    });
});
