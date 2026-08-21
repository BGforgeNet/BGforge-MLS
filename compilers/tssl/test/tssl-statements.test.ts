/**
 * TSSL statement-emission tests: for/while/do-while/foreach/switch handlers
 * (tssl/src/emit.ts processFunctionBody dispatch). TSSL resolves its source
 * through the real filesystem (ts-morph addSourceFileAtPath), so fixtures are
 * written to a temp dir - same setup as tssl-convert-operators.test.ts.
 */
import { describe, expect, it, beforeAll, afterAll } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { createBatchState, transpile } from "../src/index";

// One ts-morph project for the whole file: creating one per case re-parses the TypeScript default
// library every time, which is most of a small fixture's transpile cost.
const batch = createBatchState();

let tmpDir: string;

beforeAll(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "tssl-statements-"));
});

afterAll(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
});

let fileSeq = 0;
async function emit(src: string): Promise<string> {
    const filePath = path.join(tmpDir, `case${fileSeq++}.tssl`);
    fs.writeFileSync(filePath, src, "utf-8");
    return transpile(filePath, src, batch);
}

describe("control-flow statement handlers", () => {
    it("for -> for (variable i = 0; i < 10; i++) begin ... end", async () => {
        const out = await emit(
            `function start() {\n    for (let i = 0; i < 10; i++) {\n        display_msg(i);\n    }\n}\n`,
        );
        expect(out).toContain("for (variable i = 0; i < 10; i++) begin");
        expect(out).toContain("display_msg(i);");
        expect(out).toContain("end");
    });

    it("while -> while (condition) do begin ... end", async () => {
        const out = await emit(
            `function start() {\n    let x = 1;\n    while (x < 5) {\n        x = x + 1;\n    }\n}\n`,
        );
        expect(out).toContain("while (x < 5) do begin");
    });

    it("do...while is emulated with a flag variable and a while loop", async () => {
        const out = await emit(
            `function start() {\n    let x = 1;\n    do {\n        x = x + 1;\n    } while (x < 5);\n}\n`,
        );
        expect(out).toContain("while (__tssl_do_0 or (x < 5)) do begin");
        expect(out).toContain("__tssl_do_0 = 0;");
    });

    it("for...of -> foreach (variable item in arr) begin ... end", async () => {
        const out = await emit(
            `function start(arr: number[]) {\n    for (const item of arr) {\n        display_msg(item);\n    }\n}\n`,
        );
        expect(out).toContain("foreach (variable item in arr) begin");
    });

    it("for...of destructuring -> foreach (variable k: v in map) begin ... end", async () => {
        const out = await emit(
            `function start(myMap: unknown) {\n    for (const [k, v] of myMap as unknown as [string, number][]) {\n        display_msg(k);\n    }\n}\n`,
        );
        expect(out).toContain("foreach (variable k: v in myMap) begin");
    });

    it("for...of destructuring rejects a non-2-element binding pattern", async () => {
        await expect(
            emit(
                `function start(myMap: unknown) {\n    for (const [a, b, c] of myMap as unknown as [string, number, number][]) {\n        display_msg(a);\n    }\n}\n`,
            ),
        ).rejects.toThrow(/foreach destructuring must have exactly 2 elements, got 3/);
    });

    it("for...in -> foreach (variable key in obj) begin ... end", async () => {
        const out = await emit(
            `function start(obj: unknown) {\n    for (const key in obj) {\n        display_msg(key);\n    }\n}\n`,
        );
        expect(out).toContain("foreach (variable key in obj) begin");
    });

    it("switch/case with a default clause and break-stripping", async () => {
        const out = await emit(
            [
                "function start() {",
                "    let x = 1;",
                "    switch (x) {",
                "        case 1:",
                "            display_msg(1);",
                "            break;",
                "        default:",
                "            display_msg(0);",
                "    }",
                "}",
                "",
            ].join("\n"),
        );
        expect(out).toContain("switch (x) begin");
        expect(out).toContain("case 1:");
        expect(out).toContain("default:");
        expect(out).not.toContain("break;");
    });
});

describe("a for initializer declaring more than one variable", () => {
    // SSL's `for_var_decl` holds exactly one declarator, so the extras are declared ahead of the loop.
    // They are procedure-scoped either way, which is what the bytecode front end already does with them.
    it("hoists every declarator after the first above the loop", async () => {
        const out = await emit(
            `function start() {\n    for (let i = 0, n = 10; i < n; i++) {\n        display_msg(i);\n    }\n}\n`,
        );
        expect(out).toContain("variable n = 10;");
        expect(out).toContain("for (variable i = 0; i < n; i++) begin");
    });

    it("gives a hoisted declarator without an initializer a bare declaration", async () => {
        const out = await emit(
            `function start() {\n    for (let i = 0, seen; i < 3; i++) {\n        seen = i;\n    }\n}\n`,
        );
        expect(out).toContain("variable seen;");
        expect(out).toContain("for (variable i = 0; i < 3; i++) begin");
    });
});
