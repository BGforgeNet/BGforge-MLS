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
});

describe("refusals", () => {
    it.each([
        [
            "procedure parameters",
            "function start(a: number) {\n    display_msg(a);\n}\n",
            /parameters are not lowered yet/,
        ],
        ["an unknown identifier", "function start() {\n    display_msg(nope);\n}\n", /unknown identifier 'nope'/],
        ["an operator with no mapping", "function start() {\n    let x = 1 << 2;\n}\n", /'<<' is not lowered yet/],
        ["a statement with no mapping", "function start() {\n    for (;;) {}\n}\n", /ForStatement is not lowered yet/],
    ])("refuses %s rather than approximating it", (_name, source, message) => {
        expect(() => lower(source)).toThrow(message);
    });
});
