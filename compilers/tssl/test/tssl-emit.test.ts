/**
 * Enum emission through the public transpile: which members become #defines, and how a member access
 * prints. Members are identified by their declarations rather than by name pattern, so an unused member
 * tree-shakes away while an unrelated constant that merely looks like one (Foo_Bar) is untouched.
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
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "tssl-emit-"));
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

describe("enum emission", () => {
    it("emits a define for a referenced member and tree-shakes the rest", async () => {
        const out = await emit(
            `enum Color {\n    Red = 1,\n    Green = 2,\n}\nfunction start() {\n    display_msg(Color.Red);\n}\n`,
        );
        expect(out).toContain("#define Color_Red 1");
        expect(out).not.toContain("Color_Green");
        expect(out).toContain("display_msg(Color_Red);");
    });

    it("auto-increments member values the way TypeScript does", async () => {
        const out = await emit(
            `enum Mode {\n    A,\n    B,\n    C,\n}\nfunction start() {\n    display_msg(Mode.C);\n}\n`,
        );
        expect(out).toContain("#define Mode_C 2");
    });

    it("emits an imported enum's member under the importing script", async () => {
        const out = await emit(
            `import { Damage } from "./shared-enums";\nfunction start() {\n    display_msg(Damage.Fire);\n}\n`,
            { "shared-enums.ts": "export enum Damage {\n    Normal = 0,\n    Fire = 3,\n}\n" },
        );
        expect(out).toContain("#define Damage_Fire 3");
        expect(out).not.toContain("Damage_Normal");
        expect(out).toContain("display_msg(Damage_Fire);");
    });

    it("parenthesises a negative member, which the preprocessor would otherwise splice after a minus", async () => {
        const out = await emit(
            `enum Step {\n    Back = -1,\n}\nfunction start() {\n    display_msg(5 - Step.Back);\n}\n`,
        );
        expect(out).toContain("#define Step_Back (-1)");
    });

    it("prints a declare-enum member bare, leaving its value to the headers", async () => {
        const out = await emit(
            `import { Stat } from "./engine.d";\nfunction start() {\n    display_msg(Stat.STAT_ch);\n}\n`,
            { "engine.d.ts": "export declare enum Stat {\n    STAT_ch = 5,\n}\n" },
        );
        expect(out).toContain("display_msg(STAT_ch);");
        expect(out).not.toContain("#define STAT_ch");
    });
});

describe("@inline macros", () => {
    it("parenthesises a parameter used as an operand, so a compound argument keeps its grouping", async () => {
        const out = await emit(
            "/** @inline */\nfunction dbl(x: number): number {\n    return x * 2;\n}\n" +
                "function start() {\n    let a = 10;\n    display_msg(dbl(a + 1));\n}\n",
        );
        expect(out).toContain("#define dbl(x) ((x) * 2)");
        expect(out).toContain("display_msg(dbl(a + 1));");
    });
});

describe("constant emission", () => {
    // A define body is spliced into each use as text, so `b * 2` under a bare `#define b a + 1` reads as
    // `a + 1 * 2`. Whether the parenthesised body compiles to what TypeScript computes is checked across
    // both routes by `compilers/tssl/test/constructs/corpus-gaps.tssl`.
    const source = [
        "const a = 10;",
        "const b = a + 1;",
        "const neg = -1;",
        "const name = 'x';",
        "const pick = a > 5 ? 1 : 2;",
        "const call = get_sfall_global_int('x');",
        "function start() {",
        "    display_msg(b * 2 + neg + pick + call);",
        "    display_msg(name);",
        "}",
        "",
    ].join("\n");

    it("parenthesises an operator expression", async () => {
        const out = await emit(source);
        expect(out).toContain("#define b (a + 1)");
        expect(out).toContain("#define neg (-1)");
    });

    it("leaves a value that is already one operand bare", async () => {
        const out = await emit(source);
        expect(out).toContain("#define a 10");
        expect(out).toContain('#define name "x"');
        expect(out).toContain("#define pick ((1) if (a > 5) else (2))");
        expect(out).toContain('#define call get_sfall_global_int("x")');
    });
});
