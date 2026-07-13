/**
 * TBAF condition-algebra tests: &&/||/! composition, De Morgan inversion for
 * else blocks, DNF->CNF conversion, user-function inlining, and switch
 * conditions (tbaf/src/condition-algebra.ts).
 *
 * These drive the real transpile() entry point (not the internal functions)
 * so the assertions keep holding across internal refactors - same convention
 * as loop-unroll.test.ts.
 */
import { describe, expect, it } from "vitest";
import { transpile } from "../tbaf/src/index";

const t = (src: string) => transpile("/virtual/foo.tbaf", src);

describe("condition composition", () => {
    it("&& splits into stacked AND conditions", async () => {
        const out = await t(`if (See(Player1) && See(Player2)) {\n    Attack(Player1);\n}\n`);
        expect(out).toContain("IF\n  See(Player1)\n  See(Player2)\nTHEN");
    });

    it("|| becomes an OR(n) group", async () => {
        const out = await t(`if (See(Player1) || See(Player2) || See(Player3)) {\n    Attack(Player1);\n}\n`);
        expect(out).toContain("OR(3)\n    See(Player1)\n    See(Player2)\n    See(Player3)");
    });

    it("(a || b) && c emits the OR group followed by the AND condition", async () => {
        const out = await t(`if ((See(Player1) || See(Player2)) && Delay(5)) {\n    Attack(Player1);\n}\n`);
        expect(out).toContain("OR(2)\n    See(Player1)\n    See(Player2)\n  Delay(5)");
    });

    it("! negates a built-in condition", async () => {
        const out = await t(`if (!See(Player1)) {\n    Attack(Player1);\n}\n`);
        expect(out).toContain("IF\n  !See(Player1)\nTHEN");
    });

    it("rejects top-level negation of an OR group", async () => {
        await expect(t(`if (!(See(Player1) || See(Player2))) {\n    Attack(Player1);\n}\n`)).rejects.toMatchObject({
            name: "TranspileError",
            message: expect.stringMatching(/Negation of OR groups is not supported/),
        });
    });
});

describe("else-branch inversion (De Morgan)", () => {
    const withElse = (cond: string) =>
        t(`if (${cond}) {\n    Attack(Player1);\n} else {\n    RunAwayFrom(Player1, 30);\n}\n`);

    it("inverts a && b to an OR(2) of negated atoms", async () => {
        const out = await withElse("See(Player1) && See(Player2)");
        expect(out).toContain("OR(2)\n    !See(Player1)\n    !See(Player2)");
    });

    it("inverts a || b to stacked negated AND conditions", async () => {
        const out = await withElse("See(Player1) || See(Player2)");
        expect(out).toContain("IF\n  !See(Player1)\n  !See(Player2)\nTHEN");
    });

    it("converts the DNF of a && (b || c) inversion to CNF OR groups", async () => {
        // !(a && (b || c)) = !a || (!b && !c) -> CNF: (!a || !b) && (!a || !c)
        const out = await withElse("See(Player1) && (See(Player2) || See(Player3))");
        expect(out).toContain("OR(2)\n    !See(Player1)\n    !See(Player2)");
        expect(out).toContain("OR(2)\n    !See(Player1)\n    !See(Player3)");
    });
});

describe("user-function inlining", () => {
    const FUNC = `function isThreatened() {\n    return See(Player1) && Range(Player1);\n}\n`;

    it("inlines a user function's return expression as conditions", async () => {
        const out = await t(`${FUNC}if (isThreatened()) {\n    Attack(Player1);\n}\n`);
        expect(out).toContain("IF\n  See(Player1)\n  Range(Player1)\nTHEN");
    });

    it("negating an inlined conjunction produces the De Morgan OR group", async () => {
        const out = await t(`${FUNC}if (!isThreatened()) {\n    Attack(Player1);\n}\n`);
        expect(out).toContain("OR(2)\n    !See(Player1)\n    !Range(Player1)");
    });

    it("rejects a multi-condition function inside an OR group", async () => {
        await expect(
            t(`${FUNC}if (See(Player2) || isThreatened()) {\n    Attack(Player1);\n}\n`),
        ).rejects.toMatchObject({
            name: "TranspileError",
            message: expect.stringMatching(/inside OR group/),
        });
    });
});

describe("switch conditions", () => {
    it("appends the case value to the switch call's arguments", async () => {
        const src = [
            'switch (Global("X","GLOBAL")) {',
            "    case 1:",
            "        Attack(Player1);",
            "        break;",
            "}",
            "",
        ].join("\n");
        const out = await t(src);
        expect(out).toContain('Global("X", "GLOBAL", 1)');
    });
});
