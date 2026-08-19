/**
 * The TSSL program model, through the public transpile: module resolution, reachability, import
 * renames, collisions, and the refusals that replaced the old pipeline's broken-output passthrough.
 */
import { describe, expect, it, beforeAll, afterAll } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { createBatchState, transpile } from "../tssl/src/index";

// One ts-morph project for the whole file: creating one per case re-parses the TypeScript default
// library every time, which is most of a small fixture's transpile cost.
const batch = createBatchState();

let tmpDir: string;

beforeAll(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "tssl-model-"));
});

afterAll(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
});

let fileSeq = 0;
async function emit(src: string, extras: Record<string, string> = {}): Promise<string> {
    const dir = path.join(tmpDir, `case${fileSeq++}`);
    fs.mkdirSync(dir, { recursive: true });
    for (const [name, body] of Object.entries(extras)) {
        fs.writeFileSync(path.join(dir, name), body, "utf-8");
    }
    const filePath = path.join(dir, "main.tssl");
    fs.writeFileSync(filePath, src, "utf-8");
    return transpile(filePath, src, batch);
}

describe("imports and renames", () => {
    it("renders an aliased import as the name its declaration carries", async () => {
        const out = await emit(`import { helper as h } from "./lib";\nfunction start() {\n    h(1);\n}\n`, {
            "lib.ts": "export function helper(x: number): void {\n    display_msg(x);\n}\n",
        });
        expect(out).toContain("procedure helper(variable x);");
        expect(out).toContain("call helper(1);");
        expect(out).not.toMatch(/\bh\(/);
    });

    it("tree-shakes an imported function nothing calls", async () => {
        const out = await emit(`import { used, unused } from "./lib";\nfunction start() {\n    used();\n}\n`, {
            "lib.ts":
                "export function used(): void {\n    display_msg(1);\n}\nexport function unused(): void {\n    display_msg(2);\n}\n",
        });
        expect(out).toContain("procedure used()");
        expect(out).not.toContain("unused");
    });

    it("emits the implementation of an overloaded function, not an empty body", async () => {
        const out = await emit(`import { pick } from "./lib";\nfunction start() {\n    pick(1);\n}\n`, {
            "lib.ts": [
                "export function pick(a: number): number;",
                "export function pick(a: string): string;",
                "export function pick(a: any): any {",
                "    return a;",
                "}",
                "",
            ].join("\n"),
        });
        expect(out).toContain("procedure pick(variable a) begin\n    return a;\nend");
    });

    it("skips a declare const, which the entry's define fulfils", async () => {
        const out = await emit(
            `import { greet } from "./lib";\nconst NAME = "main";\nfunction start() {\n    greet();\n}\n`,
            {
                "lib.ts": [
                    "declare const NAME: string;",
                    "export function greet(): void {",
                    "    display_msg(NAME);",
                    "}",
                    "",
                ].join("\n"),
            },
        );
        expect(out.match(/#define NAME /g)).toHaveLength(1);
        expect(out).toContain('#define NAME "main"');
    });

    it("refuses a default import", async () => {
        await expect(
            emit(`import lib from "./lib";\nfunction start() {}\n`, { "lib.ts": "export default 1;\n" }),
        ).rejects.toThrow(/only named imports are supported/);
    });
});

describe("collisions", () => {
    it("refuses one name bound to two different definitions, naming both", async () => {
        // Both modules keep a `helper` of their own: whichever the output declared last would silently
        // win every call. The bundler used to rename one and the repair pass guessed the rename back.
        await expect(
            emit(
                `import { a } from "./one";\nimport { b } from "./two";\nfunction start() {\n    a();\n    b();\n}\n`,
                {
                    "one.ts":
                        "function helper(): void {\n    display_msg(1);\n}\nexport function a(): void {\n    helper();\n}\n",
                    "two.ts":
                        "function helper(): void {\n    display_msg(2);\n}\nexport function b(): void {\n    helper();\n}\n",
                },
            ),
        ).rejects.toThrow(/'helper' is defined in both .*one\.ts:1 and .*two\.ts:1/);
    });

    it("tolerates two constants stating the same value", async () => {
        const out = await emit(
            `import { touch } from "./lib";\nconst WIDTH = 32;\nfunction start() {\n    touch();\n    display_msg(WIDTH);\n}\n`,
            {
                "lib.ts": [
                    "export const WIDTH = 32;",
                    "export function touch(): number {",
                    "    return WIDTH;",
                    "}",
                    "",
                ].join("\n"),
            },
        );
        expect(out).toContain("#define WIDTH 32");
    });
});

describe("literal fidelity", () => {
    it("preserves a whole float literal the old bundler normalised to an integer", async () => {
        // `100.0` forces float division; losing the `.0` silently turns it into integer division.
        const out = await emit(`function start() {\n    let x = 7 / 100.0;\n}\n`);
        expect(out).toContain("7 / 100.0");
    });

    it("re-quotes a single-quoted string double", async () => {
        const out = await emit(`function start() {\n    display_msg('say "hi"');\n}\n`);
        expect(out).toContain('display_msg("say \\"hi\\"");');
    });

    it("erases a type assertion rather than printing it", async () => {
        const out = await emit(`function start() {\n    let x = global_var(1) as unknown as number;\n}\n`);
        expect(out).toContain("variable x = global_var(1);");
    });
});

describe("refusals of syntax with no SSL counterpart", () => {
    it.each([
        ["a template literal", "let x = `a${1}b`;", /template literals are not supported/],
        ["an arrow function", "let f = () => 1;", /arrow functions are not supported/],
        ["exponentiation", "let x = global_var(1) ** 2;", /'\*\*' is not supported/],
        ["nullish coalescing", "let x = global_var(1) ?? 2;", /'\?\?' is not supported/],
        ["optional chaining", "let x = obj?.field;", /'\?\.' is not supported/],
        ["new", "let x = new Thing();", /'new' is not supported/],
    ])("refuses %s with the line it sits on", async (_name, statement, message) => {
        await expect(emit(`function start() {\n    ${statement}\n}\n`)).rejects.toThrow(message);
    });
});
