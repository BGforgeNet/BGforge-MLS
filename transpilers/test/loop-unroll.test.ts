/**
 * Compile-time loop unroll guard tests for TBAF and TD.
 *
 * These drive the real transpile() entry points (not the internal unroll
 * functions) so the assertions keep holding across the tbaf/loop-unroll.ts
 * <-> td/inline-and-unroll.ts unification and after their extraction into a
 * shared transpilers/common core.
 */
import { describe, expect, it } from "vitest";
import { transpile as tbafTranspile } from "../tbaf/src/index";
import { transpile as tdTranspile } from "../td/src/index";

describe("loop unroll: multi-variable for-initializer", () => {
    it("TBAF rejects a for loop with more than one variable in its initializer", async () => {
        const src = `for (let i = 0, j = 0; i < 3; i++) {\n    Continue();\n}\n`;
        await expect(tbafTranspile("/virtual/foo.tbaf", src)).rejects.toMatchObject({
            name: "TranspileError",
            message: "Cannot unroll for loop: multi-variable initializer",
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
            message: "Cannot unroll for loop: multi-variable initializer",
        });
    });
});

// Additional scenarios below drive the shared unroll core (transpilers/common/loop-unroll.ts)
// through TBAF's transformStatement, which dispatches every ForStatement/ForOfStatement to it
// unconditionally - so these hit the core's other branches without a second internal API.
const tbaf = (src: string) => tbafTranspile("/virtual/foo.tbaf", src);

describe("loop unroll: for-loop iteration and cleanup", () => {
    it("unrolls a for loop, threading the loop variable into each iteration's action args", async () => {
        const out = await tbaf(`for (let i = 1; i <= 3; i++) {\n    Attack(i);\n}\n`);
        expect(out).toContain("Attack(1)");
        expect(out).toContain("Attack(2)");
        expect(out).toContain("Attack(3)");
        expect(out).not.toContain("Attack(4)");
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
        await expect(tbaf(`let i = 0;\nfor (i = 0; i < 3; i++) {\n    Attack(Player1);\n}\n`)).rejects.toMatchObject({
            name: "TranspileError",
            message: "Cannot unroll for loop: complex initializer",
        });
    });

    it("rejects a for loop with a non-numeric initializer", async () => {
        await expect(tbaf(`for (let i = "abc"; i < 3; i++) {\n    Attack(Player1);\n}\n`)).rejects.toMatchObject({
            name: "TranspileError",
            message: "Cannot unroll for loop: non-numeric initializer",
        });
    });

    it("rejects a for loop with no condition", async () => {
        await expect(tbaf(`for (let i = 0; ; i++) {\n    Attack(Player1);\n}\n`)).rejects.toMatchObject({
            name: "TranspileError",
            message: "Cannot unroll for loop: no condition",
        });
    });

    it("rejects a for loop with no incrementor", async () => {
        await expect(tbaf(`for (let i = 0; i < 3; ) {\n    Attack(Player1);\n}\n`)).rejects.toMatchObject({
            name: "TranspileError",
            message: "Cannot unroll for loop: no incrementor",
        });
    });

    it("rejects a for loop that would exceed the maximum iteration count", async () => {
        await expect(tbaf(`for (let i = 0; i < 5000; i++) {\n    Attack(Player1);\n}\n`)).rejects.toMatchObject({
            name: "TranspileError",
            message: expect.stringMatching(/Loop exceeded maximum 1000 iterations/),
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
            message: expect.stringMatching(/Cannot destructure "1" - not a valid array literal/),
        });
    });
});
