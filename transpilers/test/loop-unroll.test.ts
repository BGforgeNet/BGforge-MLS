/**
 * Compile-time loop unroll guard tests for TBAF and TD.
 *
 * These drive the real transpile() entry points (not the internal unroll
 * functions), which both unroll through the shared compile-time evaluator.
 */
import { describe, expect, it } from "vitest";
import { transpile as tbafTranspile } from "../tbaf/src/index";
import { transpile as tdTranspile } from "../td/src/index";

describe("loop unroll: multi-variable for-initializer", () => {
    it("TBAF rejects a for loop with more than one variable in its initializer", async () => {
        const src = `for (let i = 0, j = 0; i < 3; i++) {\n    Continue();\n}\n`;
        await expect(tbafTranspile("/virtual/foo.tbaf", src)).rejects.toMatchObject({
            name: "TranspileError",
            message: expect.stringMatching(/a compile-time for loop declares one counter/),
        });
    });

    it("TD rejects a for loop with more than one variable in its initializer", async () => {
        const src = [
            "function start() {",
            "    say(tra(1));",
            "    for (let i = 0, j = 0; i < 3; i++) {",
            "        reply(tra(2));",
            "        exit();",
            "    }",
            "}",
            "",
            'export default begin("MYDLG", [start]);',
            "",
        ].join("\n");
        await expect(tdTranspile("/virtual/foo.td", src)).rejects.toMatchObject({
            name: "TranspileError",
            message: expect.stringMatching(/a compile-time for loop declares one counter/),
        });
    });
});

// Additional scenarios below drive the evaluator's unrollFor/unrollForOf through TBAF, each loop inside an if:
// an action outside any if is refused, since its block would match on every pass.
const tbaf = (src: string) => tbafTranspile("/virtual/foo.tbaf", `if (See(Player1)) {\n${src}}\n`);

describe("loop unroll: for-loop iteration and cleanup", () => {
    it("unrolls a for loop, threading the loop variable into each iteration's action args", async () => {
        const out = await tbaf(`for (let i = 1; i <= 3; i++) {\n    Attack(i);\n}\n`);
        expect(out).toContain("Attack(1)");
        expect(out).toContain("Attack(2)");
        expect(out).toContain("Attack(3)");
        expect(out).not.toContain("Attack(4)");
    });

    it("leaves the loop variable's name alone inside a string argument", async () => {
        const out = await tbaf(`for (let i = 1; i <= 2; i++) {\n    DisplayString(i, "step i");\n}\n`);
        expect(out).toContain('DisplayString(1, "step i")');
        expect(out).toContain('DisplayString(2, "step i")');
    });

    it("supports a += step increment", async () => {
        const out = await tbaf(`for (let i = 0; i < 6; i += 3) {\n    Attack(i);\n}\n`);
        expect(out).toContain("Attack(0)");
        expect(out).toContain("Attack(3)");
        expect(out).not.toContain("Attack(6)");
    });

    it("deletes the loop variable after the loop, so later code sees it unsubstituted", async () => {
        const out = await tbaf(`for (let i = 0; i < 2; i++) {\n    Attack(i);\n}\nDelay(i);\n`);
        expect(out).toContain("Delay(i)");
    });

    it("rejects a for loop whose initializer is not a variable declaration (complex initializer)", async () => {
        await expect(tbaf(`for (i = 0; i < 3; i++) {\n    Attack(Player1);\n}\n`)).rejects.toMatchObject({
            name: "TranspileError",
            message: expect.stringMatching(/a compile-time for loop declares one counter/),
        });
    });

    it("rejects a for loop with a non-numeric initializer", async () => {
        await expect(tbaf(`for (let i = "abc"; i < 3; i++) {\n    Attack(Player1);\n}\n`)).rejects.toMatchObject({
            name: "TranspileError",
            message: expect.stringMatching(/an integer was expected, not a string/),
        });
    });

    it("rejects a for loop with no condition", async () => {
        await expect(tbaf(`for (let i = 0; ; i++) {\n    Attack(Player1);\n}\n`)).rejects.toMatchObject({
            name: "TranspileError",
            message: "a compile-time for loop needs a condition",
        });
    });

    it("rejects a for loop with no incrementor", async () => {
        await expect(tbaf(`for (let i = 0; i < 3; ) {\n    Attack(Player1);\n}\n`)).rejects.toMatchObject({
            name: "TranspileError",
            message: "a compile-time for loop needs an incrementor",
        });
    });

    it("rejects a for loop that would exceed the maximum iteration count", async () => {
        await expect(tbaf(`for (let i = 0; i < 5000; i++) {\n    Attack(Player1);\n}\n`)).rejects.toMatchObject({
            name: "TranspileError",
            message: expect.stringMatching(/runs past 1000 passes/),
        });
    });
});

describe("loop unroll: for-of destructuring", () => {
    it("destructures a [a, b] pair per iteration, threading both into the body", async () => {
        const out = await tbaf(`const pairs = [[1, 2], [3, 4]];\nfor (const [a, b] of pairs) {\n    Attack(a);\n}\n`);
        expect(out).toContain("Attack(1)");
        expect(out).toContain("Attack(3)");
        expect(out).not.toContain("Attack(2)");
    });

    it("rejects destructuring an element that isn't itself an array literal", async () => {
        await expect(
            tbaf(`const items = [1, 2, 3];\nfor (const [a, b] of items) {\n    Attack(a);\n}\n`),
        ).rejects.toMatchObject({
            name: "TranspileError",
            message: expect.stringMatching(/an integer cannot be destructured as an array/),
        });
    });
});

describe("TBAF loop unroll nested inside an if body", () => {
    // A top-level for/for-of loop is unrolled by transformForStatement/
    // transformForOfStatement, which re-invoke transformStatement per iteration.
    // Nested inside an if's then-block, processBlock instead routes the block
    // through transformActionsFromStatements, which calls unrollForAsActions/
    // unrollForOfAsActions - a distinct path this suite otherwise never reaches.
    it("unrolls a for-of loop nested inside an if body into repeated actions", async () => {
        const src =
            'if (See(Player1)) {\n    for (const enemy of ["Player1", "Player2"]) {\n        Attack(enemy);\n    }\n}\n';
        const out = await tbafTranspile("/virtual/foo.tbaf", src);
        expect(out).toContain(
            'IF\n  See(Player1)\nTHEN\n  RESPONSE #100\n    Attack("Player1")\n    Attack("Player2")\nEND',
        );
    });

    it("unrolls a numeric for loop nested inside an if body into repeated actions", async () => {
        const src =
            'if (See(Player1)) {\n    for (let i = 0; i < 3; i++) {\n        GiveItemCreate("POTN08", Player1, i, 0, 0);\n    }\n}\n';
        const out = await tbafTranspile("/virtual/foo.tbaf", src);
        expect(out).toContain(
            'GiveItemCreate("POTN08", Player1, 0, 0, 0)\n    GiveItemCreate("POTN08", Player1, 1, 0, 0)\n    GiveItemCreate("POTN08", Player1, 2, 0, 0)',
        );
    });
});
