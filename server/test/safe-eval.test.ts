/**
 * Unit tests for safe-eval.ts - recursive descent expression evaluator.
 * Tests arithmetic, comparisons, boolean operators, and edge cases.
 */

import { describe, expect, it } from "vitest";
import { safeEvaluate } from "../../transpilers/common/safe-eval";

describe("safeEvaluate", () => {
    describe("numeric literals", () => {
        it("evaluates integer", () => {
            expect(safeEvaluate("42")).toBe(42);
        });

        it("evaluates decimal", () => {
            expect(safeEvaluate("3.14")).toBe(3.14);
        });

        it("evaluates zero", () => {
            expect(safeEvaluate("0")).toBe(0);
        });

        it("evaluates leading decimal (.5) as NaN-producing", () => {
            // Tokenizer starts number parsing from '0'-'9', so '.' is not a valid start
            expect(() => safeEvaluate(".5")).toThrow("Unsupported character '.' at position 0");
        });

        it("evaluates trailing decimal (5.) as 5", () => {
            // Number("5.") === 5 in JavaScript
            expect(safeEvaluate("5.")).toBe(5);
        });

        it("returns NaN for multiple decimal points (5.5.5)", () => {
            // The tokenizer greedily reads all digit/dot chars as one number token.
            // Number("5.5.5") is NaN in JavaScript. The parser doesn't validate this.
            const result = safeEvaluate("5.5.5");
            expect(result).toBeNaN();
        });
    });

    describe("arithmetic operators", () => {
        it("adds", () => {
            expect(safeEvaluate("2 + 3")).toBe(5);
        });

        it("subtracts", () => {
            expect(safeEvaluate("10 - 4")).toBe(6);
        });

        it("multiplies", () => {
            expect(safeEvaluate("3 * 7")).toBe(21);
        });

        it("divides", () => {
            expect(safeEvaluate("20 / 4")).toBe(5);
        });

        it("modulos", () => {
            expect(safeEvaluate("17 % 5")).toBe(2);
        });
    });

    describe("operator precedence", () => {
        it("multiplication before addition: 2 + 3 * 4 = 14", () => {
            expect(safeEvaluate("2 + 3 * 4")).toBe(14);
        });

        it("parentheses override: (2 + 3) * 4 = 20", () => {
            expect(safeEvaluate("(2 + 3) * 4")).toBe(20);
        });

        it("division before subtraction: 10 - 6 / 2 = 7", () => {
            expect(safeEvaluate("10 - 6 / 2")).toBe(7);
        });

        it("left associativity: 10 - 3 - 2 = 5", () => {
            expect(safeEvaluate("10 - 3 - 2")).toBe(5);
        });

        it("mixed: 2 * 3 + 4 * 5 = 26", () => {
            expect(safeEvaluate("2 * 3 + 4 * 5")).toBe(26);
        });
    });

    describe("unary operators", () => {
        it("unary minus on literal", () => {
            expect(safeEvaluate("-5")).toBe(-5);
        });

        it("unary minus on expression: -(3 + 2) = -5", () => {
            expect(safeEvaluate("-(3 + 2)")).toBe(-5);
        });

        it("double unary minus: --5 = 5", () => {
            expect(safeEvaluate("--5")).toBe(5);
        });

        it("logical not: !0 = true", () => {
            expect(safeEvaluate("!0")).toBe(true);
        });

        it("logical not: !1 = false", () => {
            expect(safeEvaluate("!1")).toBe(false);
        });

        it("double logical not: !!1 = true", () => {
            expect(safeEvaluate("!!1")).toBe(true);
        });
    });

    describe("comparison operators", () => {
        it("less than", () => {
            expect(safeEvaluate("3 < 5")).toBe(true);
            expect(safeEvaluate("5 < 3")).toBe(false);
        });

        it("less than or equal", () => {
            expect(safeEvaluate("3 <= 3")).toBe(true);
            expect(safeEvaluate("4 <= 3")).toBe(false);
        });

        it("greater than", () => {
            expect(safeEvaluate("5 > 3")).toBe(true);
            expect(safeEvaluate("3 > 5")).toBe(false);
        });

        it("greater than or equal", () => {
            expect(safeEvaluate("3 >= 3")).toBe(true);
            expect(safeEvaluate("2 >= 3")).toBe(false);
        });
    });

    describe("equality operators", () => {
        it("loose equality (==)", () => {
            expect(safeEvaluate("5 == 5")).toBe(true);
            expect(safeEvaluate("5 == 6")).toBe(false);
        });

        it("strict equality (===)", () => {
            expect(safeEvaluate("5 === 5")).toBe(true);
            expect(safeEvaluate("5 === 6")).toBe(false);
        });

        it("loose inequality (!=)", () => {
            expect(safeEvaluate("5 != 6")).toBe(true);
            expect(safeEvaluate("5 != 5")).toBe(false);
        });

        it("strict inequality (!==)", () => {
            expect(safeEvaluate("5 !== 6")).toBe(true);
            expect(safeEvaluate("5 !== 5")).toBe(false);
        });
    });

    describe("boolean operators", () => {
        it("logical AND", () => {
            expect(safeEvaluate("1 && 1")).toBe(true);
            expect(safeEvaluate("1 && 0")).toBe(false);
        });

        it("logical OR", () => {
            expect(safeEvaluate("0 || 1")).toBe(true);
            expect(safeEvaluate("0 || 0")).toBe(false);
        });

        it("AND has higher precedence than OR", () => {
            // 1 || 0 && 0 => 1 || (0 && 0) => 1 || false => true
            expect(safeEvaluate("1 || 0 && 0")).toBe(true);
        });
    });

    describe("boolean in arithmetic context", () => {
        it("comparison result used in addition: (1 > 0) + 5", () => {
            // (1 > 0) returns boolean true, cast to number in addition => NaN or 6?
            // In the parser: addition() casts left = multiply() as number
            // Boolean true as number = 1 in JS (Number(true) === 1)
            // But: the parser does `left + (this.multiply() as number)`
            // true + 5 = 6 in JS. So this works via JS coercion.
            const result = safeEvaluate("(1 > 0) + 5");
            expect(result).toBe(6);
        });

        it("comparison result used in multiplication", () => {
            // (1 > 0) * 10 = true * 10 = 10
            const result = safeEvaluate("(1 > 0) * 10");
            expect(result).toBe(10);
        });
    });

    describe("comparison chains", () => {
        it("chains left-to-right: 1 < 2 < 3", () => {
            // Parsed as (1 < 2) < 3 => true < 3 => 1 < 3 => true
            // This is JS behavior, not mathematical behavior
            expect(safeEvaluate("1 < 2 < 3")).toBe(true);
        });

        it("chains left-to-right: 3 < 2 < 1", () => {
            // (3 < 2) < 1 => false < 1 => 0 < 1 => true
            // Misleading: 3 < 2 < 1 evaluates to true!
            expect(safeEvaluate("3 < 2 < 1")).toBe(true);
        });
    });

    describe("division by zero", () => {
        it("returns Infinity for n / 0", () => {
            // JavaScript returns Infinity for n / 0 (not an error)
            expect(safeEvaluate("5 / 0")).toBe(Infinity);
        });

        it("returns NaN for 0 / 0", () => {
            expect(safeEvaluate("0 / 0")).toBeNaN();
        });
    });

    describe("parentheses", () => {
        it("nested parentheses", () => {
            expect(safeEvaluate("((2 + 3))")).toBe(5);
        });

        it("deeply nested parentheses", () => {
            expect(safeEvaluate("((((((1 + 2))))))")).toBe(3);
        });

        it("throws on mismatched parentheses (missing closing)", () => {
            expect(() => safeEvaluate("(1 + 2")).toThrow(/Expected token type \d+, got \d+ at position 4/);
        });

        it("throws on mismatched parentheses (extra closing)", () => {
            expect(() => safeEvaluate("1 + 2)")).toThrow("Unexpected token at position 3");
        });
    });

    describe("complex expressions", () => {
        it("combined arithmetic and comparisons", () => {
            expect(safeEvaluate("(2 + 3) * 4 > 15 && 10 % 3 == 1")).toBe(true);
        });

        it("negated complex expression", () => {
            expect(safeEvaluate("!(5 > 10)")).toBe(true);
        });
    });

    describe("error cases", () => {
        it("rejects identifiers", () => {
            expect(() => safeEvaluate("x + 1")).toThrow("Unsupported character 'x' at position 0");
        });

        it("rejects assignment", () => {
            // The identifier is rejected before the tokenizer reaches the '='.
            expect(() => safeEvaluate("x = 5")).toThrow("Unsupported character 'x' at position 0");
            expect(() => safeEvaluate("1 = 5")).toThrow("Unsupported token: assignment '=' at position 2");
        });

        it("rejects single &", () => {
            expect(() => safeEvaluate("1 & 2")).toThrow(
                "Unsupported token: '&' at position 2. Use '&&' for logical AND.",
            );
        });

        it("rejects single |", () => {
            expect(() => safeEvaluate("1 | 2")).toThrow(
                "Unsupported token: '|' at position 2. Use '||' for logical OR.",
            );
        });

        it("rejects empty expression", () => {
            expect(() => safeEvaluate("")).toThrow("Unexpected token at position 0 in expression");
        });

        it("rejects whitespace-only expression", () => {
            expect(() => safeEvaluate("   ")).toThrow("Unexpected token at position 0 in expression");
        });
    });
});
