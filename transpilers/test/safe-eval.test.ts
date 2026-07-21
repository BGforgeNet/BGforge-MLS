/**
 * safeEvaluate tests (common/safe-eval.ts): a recursive-descent parser standing
 * in for `new Function()` on the compile-time-substituted subset of JS it
 * documents (numeric literals, arithmetic, comparisons, booleans, parens).
 *
 * Property tests build an expression string alongside a plain-JS oracle
 * evaluated over the same generated values, restricted to one precedence
 * level per property so the oracle's left-to-right reduce matches the
 * grammar's own associativity without re-implementing precedence.
 */
import * as fc from "fast-check";
import { describe, expect, it } from "vitest";
import { safeEvaluate } from "../common/safe-eval";

describe("arithmetic precedence (examples)", () => {
    it("multiplication binds tighter than addition", () => {
        expect(safeEvaluate("2 + 3 * 4")).toBe(14);
    });

    it("parens override precedence", () => {
        expect(safeEvaluate("(2 + 3) * 4")).toBe(20);
    });

    it("unary minus applies before multiplication", () => {
        expect(safeEvaluate("-2 * 3")).toBe(-6);
    });

    it("modulo follows the multiplicative grammar level", () => {
        expect(safeEvaluate("10 % 3 + 1")).toBe(2);
    });
});

describe("comparisons and booleans (examples)", () => {
    it("evaluates relational and equality operators", () => {
        expect(safeEvaluate("3 < 5")).toBe(true);
        expect(safeEvaluate("5 <= 5")).toBe(true);
        expect(safeEvaluate("5 > 3")).toBe(true);
        expect(safeEvaluate("3 >= 5")).toBe(false);
        expect(safeEvaluate("3 == 3")).toBe(true);
        expect(safeEvaluate("3 === 3")).toBe(true);
        expect(safeEvaluate("3 != 4")).toBe(true);
        expect(safeEvaluate("3 !== 3")).toBe(false);
    });

    it("combines conditions with && and ||, and negates with !", () => {
        expect(safeEvaluate("1 < 2 && 3 < 4")).toBe(true);
        expect(safeEvaluate("1 > 2 || 3 < 4")).toBe(true);
        expect(safeEvaluate("!(1 > 2)")).toBe(true);
    });
});

describe("errors", () => {
    it("rejects a bare assignment '=' (only '==' / '===' are supported)", () => {
        expect(() => safeEvaluate("1 = 2")).toThrow("Unsupported token: assignment '=' at position 2");
    });

    it("rejects a bare '&' (only '&&' is supported)", () => {
        expect(() => safeEvaluate("1 & 2")).toThrow("Unsupported token: '&' at position 2. Use '&&' for logical AND.");
    });

    it("rejects a bare '|' (only '||' is supported)", () => {
        expect(() => safeEvaluate("1 | 2")).toThrow("Unsupported token: '|' at position 2. Use '||' for logical OR.");
    });

    it("rejects an unsupported character (identifiers are not part of the grammar)", () => {
        expect(() => safeEvaluate("count")).toThrow(/Unsupported character 'c'/);
    });

    it("rejects trailing tokens after a complete expression", () => {
        expect(() => safeEvaluate("1 2")).toThrow(/Unexpected token/);
    });

    it("rejects an unclosed parenthesis", () => {
        expect(() => safeEvaluate("(1 + 2")).toThrow(/Expected token type/);
    });
});

describe("property: additive chain matches left-to-right JS arithmetic", () => {
    it("safeEvaluate(a (+|-) b (+|-) c ...) equals the same left-to-right reduction", () => {
        fc.assert(
            fc.property(
                fc.integer({ min: -1000, max: 1000 }),
                fc.array(fc.tuple(fc.constantFrom("+", "-"), fc.integer({ min: -1000, max: 1000 })), {
                    minLength: 0,
                    maxLength: 5,
                }),
                (first, rest) => {
                    const expr = [first.toString(), ...rest.map(([op, n]) => `${op} ${n}`)].join(" ");
                    const expected = rest.reduce((acc, [op, n]) => (op === "+" ? acc + n : acc - n), first);
                    expect(safeEvaluate(expr)).toBe(expected);
                },
            ),
            { numRuns: 100 },
        );
    });
});

describe("property: multiplicative chain matches left-to-right JS arithmetic", () => {
    it("safeEvaluate(a (*|%) b (*|%) c ...) equals the same left-to-right reduction", () => {
        fc.assert(
            fc.property(
                fc.integer({ min: -50, max: 50 }),
                fc.array(fc.tuple(fc.constantFrom("*", "%"), fc.integer({ min: 1, max: 50 })), {
                    minLength: 0,
                    maxLength: 4,
                }),
                (first, rest) => {
                    const expr = [first.toString(), ...rest.map(([op, n]) => `${op} ${n}`)].join(" ");
                    const expected = rest.reduce((acc, [op, n]) => (op === "*" ? acc * n : acc % n), first);
                    expect(safeEvaluate(expr)).toBe(expected);
                },
            ),
            { numRuns: 100 },
        );
    });
});

describe("property: comparison operators match JS numeric comparison", () => {
    it("safeEvaluate(a OP b) equals the JS-native comparison for every supported operator", () => {
        const ops = [
            ["<", (a: number, b: number) => a < b],
            ["<=", (a: number, b: number) => a <= b],
            [">", (a: number, b: number) => a > b],
            [">=", (a: number, b: number) => a >= b],
            ["==", (a: number, b: number) => a === b],
            ["===", (a: number, b: number) => a === b],
            ["!=", (a: number, b: number) => a !== b],
            ["!==", (a: number, b: number) => a !== b],
        ] as const;

        fc.assert(
            fc.property(
                fc.integer({ min: -100, max: 100 }),
                fc.integer({ min: -100, max: 100 }),
                fc.constantFrom(...ops),
                (a, b, [op, fn]) => {
                    expect(safeEvaluate(`${a} ${op} ${b}`)).toBe(fn(a, b));
                },
            ),
            { numRuns: 100 },
        );
    });
});

describe("property: chained && / || over comparison atoms match JS boolean reduction", () => {
    it("safeEvaluate(atom1 OP atom2 OP ...) equals the JS reduction for a uniform && or || chain", () => {
        const atom = fc
            .tuple(fc.integer({ min: -5, max: 5 }), fc.integer({ min: -5, max: 5 }))
            .map(([a, b]) => ({ text: `${a} < ${b}`, value: a < b }));

        fc.assert(
            fc.property(fc.array(atom, { minLength: 2, maxLength: 4 }), fc.constantFrom("&&", "||"), (atoms, op) => {
                const expr = atoms.map((a) => `(${a.text})`).join(` ${op} `);
                const expected = op === "&&" ? atoms.every((a) => a.value) : atoms.some((a) => a.value);
                expect(safeEvaluate(expr)).toBe(expected);
            }),
            { numRuns: 100 },
        );
    });
});
