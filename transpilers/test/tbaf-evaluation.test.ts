/**
 * TBAF through the compile-time evaluator: every value, condition and statement compiles to what the TypeScript
 * means, or the transpile refuses, naming the construct. Each case was a silent miscompile of the text layer
 * this replaced (the table in the evaluator plan), so each asserts the intended output, not the old one.
 */
import * as fs from "fs";
import * as path from "path";
import { describe, expect, it } from "vitest";
import { transpile } from "../tbaf/src/index";
import { REPO_ROOT } from "./repo-root";

const t = (src: string) => transpile("/virtual/foo.tbaf", src);

/** One IF/THEN/END block as the emitter writes it. */
function block(conditions: readonly string[], actions: readonly string[]): string {
    const ifs = conditions.map((c) => `  ${c}\n`).join("");
    const thens = actions.map((a) => `    ${a}\n`).join("");
    return `IF\n${ifs}THEN\n  RESPONSE #100\n${thens}END`;
}

/** The emitted blocks, without the one-line generated header; empty for a script that emits none. */
async function blocks(src: string): Promise<string> {
    const out = await t(src);
    return out.split("\n").slice(1).join("\n").trim();
}

describe("values", () => {
    it("resolves a constant built from another constant", async () => {
        const src = 'const a = 10;\nconst b = a + 1;\nif (See(Player1)) {\n    SetGlobal("x", "GLOBAL", b * 2);\n}\n';
        expect(await blocks(src)).toBe(block(["See(Player1)"], ['SetGlobal("x", "GLOBAL", 22)']));
    });

    it("refuses a division with a remainder, and folds the integer-division form", async () => {
        const src = (expr: string) =>
            `const spellid1 = 123;\nif (See(Player1)) {\n    SetGlobal("x", "GLOBAL", ${expr});\n}\n`;
        await expect(t(src("spellid1 / 2"))).rejects.toThrow(/is 61\.5, not an integer; write Math\.trunc/);
        expect(await blocks(src("Math.trunc(spellid1 / 2)"))).toBe(
            block(["See(Player1)"], ['SetGlobal("x", "GLOBAL", 61)']),
        );
    });

    it("folds arithmetic next to a name ending in a digit without renaming it", async () => {
        const src = 'const x1 = 5;\nif (See(Player1)) {\n    SetGlobal("x", "GLOBAL", (x1 * 2) / 2);\n}\n';
        expect(await blocks(src)).toBe(block(["See(Player1)"], ['SetGlobal("x", "GLOBAL", 5)']));
    });

    it("computes indexes, fields, strings, ternaries and bit flags", async () => {
        const src = [
            "const a = 10;",
            "const arr = [100, 200];",
            "const cfg = { id: 7 };",
            "if (See(Player1)) {",
            '    SetGlobal("i", "GLOBAL", arr[1]);',
            '    SetGlobal("f", "GLOBAL", cfg.id);',
            '    SetGlobal("t", "GLOBAL", a > 5 ? 1 : 2);',
            '    SetGlobal("b", "GLOBAL", 1 | 4);',
            '    SetGlobal("u", "GLOBAL", 1_000);',
            "    ApplySpellRES(`SPWI${a}`, Myself);",
            '    ApplySpellRES("SP" + "WI" + 101, Myself);',
            "}",
            "",
        ].join("\n");
        expect(await blocks(src)).toBe(
            block(
                ["See(Player1)"],
                [
                    'SetGlobal("i", "GLOBAL", 200)',
                    'SetGlobal("f", "GLOBAL", 7)',
                    'SetGlobal("t", "GLOBAL", 1)',
                    'SetGlobal("b", "GLOBAL", 5)',
                    'SetGlobal("u", "GLOBAL", 1000)',
                    'ApplySpellRES("SPWI10", Myself)',
                    'ApplySpellRES("SPWI101", Myself)',
                ],
            ),
        );
    });

    it("refuses a float", async () => {
        await expect(t('if (See(Player1)) {\n    SetGlobal("x", "GLOBAL", 1.5);\n}\n')).rejects.toThrow(
            /not an integer/,
        );
    });

    it("leaves a string's contents as written", async () => {
        const src = 'if (See(Player1)) {\n    DisplayStringHead(Myself, "[1, 2] tra(5)");\n}\n';
        expect(await blocks(src)).toBe(block(["See(Player1)"], ['DisplayStringHead(Myself, "[1, 2] tra(5)")']));
    });

    it("keeps each function's local constant to that function", async () => {
        const src = [
            'function first() {\n    const local = 99;\n    SetGlobal("a", "GLOBAL", local);\n}',
            'function second() {\n    const local = 42;\n    SetGlobal("b", "GLOBAL", local);\n}',
            "if (See(Player1)) {\n    first();\n    second();\n}",
            "",
        ].join("\n");
        expect(await blocks(src)).toBe(
            block(["See(Player1)"], ['SetGlobal("a", "GLOBAL", 99)', 'SetGlobal("b", "GLOBAL", 42)']),
        );
    });

    it("keeps each block's constant to that block", async () => {
        const src = [
            'if (See(Player1)) {\n    const v = 1;\n    SetGlobal("first", "GLOBAL", v);\n}',
            'if (See(Player2)) {\n    const v = 2;\n    SetGlobal("second", "GLOBAL", v);\n}',
            "",
        ].join("\n");
        expect(await blocks(src)).toBe(
            [
                block(["See(Player1)"], ['SetGlobal("first", "GLOBAL", 1)']),
                block(["See(Player2)"], ['SetGlobal("second", "GLOBAL", 2)']),
            ].join("\n\n"),
        );
    });

    it("reads obj() and the scope constants a bundled iets defines, never evaluating its runtime class", async () => {
        const entry = path.join(REPO_ROOT, "transpilers/test/fixtures/iets-runtime/main.tbaf");
        const out = await transpile(entry, fs.readFileSync(entry, "utf-8"));
        expect(out).toContain(
            block(['See("Melicamp")'], ['SetGlobal("met", "GLOBAL", 1)', 'SetGlobal("seen", "LOCALS", 1)']),
        );
    });
});

describe("conditions", () => {
    it("drops a block whose condition is false at compile time, as writing-tbaf.md promises", async () => {
        expect(await blocks("const x = 1;\nif (x > 3) {\n    Attack(Player1);\n}\n")).toBe("");
        expect(
            await blocks('const on = false;\nif (Global("g", "GLOBAL", 1) && on) {\n    Attack(Player1);\n}\n'),
        ).toBe("");
    });

    it("emits a block whose condition is true at compile time under True()", async () => {
        expect(await blocks("const x = 5;\nif (x > 3) {\n    Attack(Player1);\n}\n")).toBe(
            block(["True()"], ["Attack(Player1)"]),
        );
    });

    it("drops a compile-time true part of a condition and keeps the rest", async () => {
        const src = 'const a = 3;\nif (Global("g", "GLOBAL", 1) && a === 3) {\n    Attack(Player1);\n}\n';
        expect(await blocks(src)).toBe(block(['Global("g", "GLOBAL", 1)'], ["Attack(Player1)"]));
    });

    it("refuses a condition that is neither a trigger call nor a compile-time boolean", async () => {
        await expect(t("if (flag) {\n    Attack(Player1);\n}\n")).rejects.toThrow(/not the engine name 'flag'/);
    });

    it("refuses a condition function with no top-level return", async () => {
        const src =
            "function maybe() {\n    if (See(Player1)) {\n        return true;\n    }\n}\nif (maybe()) {\n    Attack(Player1);\n}\n";
        await expect(t(src)).rejects.toThrow(/'maybe' is called for its value/);
    });

    it("negates an OR group by pushing the negation to its members", async () => {
        const src = "if (!(See(Player1) || See(Player2))) {\n    Attack(Player3);\n}\n";
        expect(await blocks(src)).toBe(block(["!See(Player1)", "!See(Player2)"], ["Attack(Player3)"]));
    });
});

describe("statements", () => {
    it("refuses let, which declares a value that can change", async () => {
        await expect(t("let m = 1;\nif (See(Player1)) {\n    Attack(Player1);\n}\n")).rejects.toThrow(/use const/);
    });

    it.each([
        ["an assignment", "x = 5;"],
        ["an increment", "x++;"],
        ["a while loop", "while (See(Player1)) {\n    Attack(Player1);\n}"],
        ["a try block", "try {\n    Attack(Player1);\n} catch {\n    Attack(Player2);\n}"],
    ])("refuses %s rather than dropping it", async (_name, statement) => {
        await expect(t(`if (See(Player1)) {\n    Attack(Player1);\n    ${statement}\n}\n`)).rejects.toThrow(
            /not supported/,
        );
    });

    it("refuses a switch's default case on the line it sits on", async () => {
        const src =
            'switch (Global("s", "LOCALS")) {\n    case 1:\n        Attack(Player1);\n        break;\n    default:\n        Attack(Player2);\n}\n';
        await expect(t(src)).rejects.toMatchObject({
            message: expect.stringMatching(/Default case in switch statement is not supported/),
            location: { line: 5 },
        });
    });

    it("keeps the actions of a nested block, and the blocks a switch inside an if body makes", async () => {
        const nested = "if (See(Player1)) {\n    Attack(Player1);\n    {\n        Attack(Player2);\n    }\n}\n";
        expect(await blocks(nested)).toBe(block(["See(Player1)"], ["Attack(Player1)", "Attack(Player2)"]));
        const withSwitch =
            'if (See(Player1)) {\n    switch (Global("s", "LOCALS")) {\n        case 1:\n            Attack(Player1);\n            break;\n    }\n}\n';
        expect(await blocks(withSwitch)).toBe(block(["See(Player1)", 'Global("s", "LOCALS", 1)'], ["Attack(Player1)"]));
    });
});
