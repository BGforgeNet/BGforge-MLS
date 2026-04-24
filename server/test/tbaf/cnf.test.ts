/**
 * Unit tests for tbaf/cnf.ts - CNF (Conjunctive Normal Form) conversion.
 * Tests distributive law application, De Morgan's, and blowup limits.
 */

import { describe, expect, it } from "vitest";
import { dnfToCnf } from "../../../transpilers/tbaf/src/cnf";
import type { BAFCondition, BAFTopCondition, BAFOrGroup } from "../../../transpilers/tbaf/src/ir";

/** Helper to create a simple BAFCondition */
function cond(name: string, negated = false): BAFCondition {
    return { negated, name, args: [] };
}

/** Helper to create an OR group */
function or(...conditions: BAFCondition[]): BAFOrGroup {
    return { conditions };
}

/** Helper to check if a top condition is an OR group */
function isOrGroup(c: BAFTopCondition): c is BAFOrGroup {
    return "conditions" in c;
}

describe("dnfToCnf", () => {
    describe("trivial cases", () => {
        it("returns empty array for empty input", () => {
            expect(dnfToCnf([])).toEqual([]);
        });

        it("returns single conjunction as-is", () => {
            const term = [cond("A"), cond("B")];
            const result = dnfToCnf([term]);

            expect(result).toEqual(term);
        });

        it("filters out empty terms", () => {
            const term = [cond("A")];
            const result = dnfToCnf([[], term, []]);

            expect(result).toEqual(term);
        });

        it("returns empty for all-empty terms", () => {
            expect(dnfToCnf([[], []])).toEqual([]);
        });
    });

    describe("simple AND/OR conversion", () => {
        it("converts (A) || (B) to [(A || B)]", () => {
            // DNF: A || B (two single-element terms)
            // CNF: (A || B) (single OR group)
            const result = dnfToCnf([[cond("A")], [cond("B")]]);

            expect(result).toHaveLength(1);
            const first = result[0]!;
            expect(isOrGroup(first)).toBe(true);
            if (isOrGroup(first)) {
                expect(first.conditions).toHaveLength(2);
                expect(first.conditions[0]!.name).toBe("A");
                expect(first.conditions[1]!.name).toBe("B");
            }
        });
    });

    describe("distributive law", () => {
        it("converts (A && B) || (C) to (A || C) && (B || C)", () => {
            // DNF: (A && B) || C
            // CNF: (A || C) && (B || C)
            const result = dnfToCnf([[cond("A"), cond("B")], [cond("C")]]);

            expect(result).toHaveLength(2);

            // Each result clause should be an OR group
            for (const clause of result) {
                expect(isOrGroup(clause)).toBe(true);
                if (isOrGroup(clause)) {
                    expect(clause.conditions).toHaveLength(2);
                    // Each clause should contain C
                    expect(clause.conditions.some((c) => c.name === "C")).toBe(true);
                }
            }
        });

        it("converts (A && B) || (C && D) to 4 clauses", () => {
            // DNF: (A && B) || (C && D)
            // CNF: (A || C) && (A || D) && (B || C) && (B || D)
            const result = dnfToCnf([
                [cond("A"), cond("B")],
                [cond("C"), cond("D")],
            ]);

            expect(result).toHaveLength(4);

            // All should be OR groups
            for (const clause of result) {
                expect(isOrGroup(clause)).toBe(true);
                if (isOrGroup(clause)) {
                    expect(clause.conditions).toHaveLength(2);
                }
            }
        });
    });

    describe("De Morgan's law (negated conditions)", () => {
        it("preserves negation on individual conditions", () => {
            // DNF: (!A) || (!B)
            // CNF: (!A || !B)
            const result = dnfToCnf([[cond("A", true)], [cond("B", true)]]);

            expect(result).toHaveLength(1);
            const first = result[0]!;
            expect(isOrGroup(first)).toBe(true);
            if (isOrGroup(first)) {
                expect(first.conditions[0]!.negated).toBe(true);
                expect(first.conditions[1]!.negated).toBe(true);
            }
        });

        it("converts (!A && !B) || (!C) to (!A || !C) && (!B || !C)", () => {
            const result = dnfToCnf([[cond("A", true), cond("B", true)], [cond("C", true)]]);

            expect(result).toHaveLength(2);
            for (const clause of result) {
                expect(isOrGroup(clause)).toBe(true);
                if (isOrGroup(clause)) {
                    // All atoms should be negated
                    for (const c of clause.conditions) {
                        expect(c.negated).toBe(true);
                    }
                }
            }
        });
    });

    describe("deduplication", () => {
        it("deduplicates identical atoms in OR groups", () => {
            // DNF: (A) || (A) => should produce just A (not A || A)
            const result = dnfToCnf([[cond("A")], [cond("A")]]);

            expect(result).toHaveLength(1);
            const first = result[0]!;
            // Deduplication should reduce (A || A) to just A
            expect(isOrGroup(first)).toBe(false);
            expect((first as BAFCondition).name).toBe("A");
        });

        it("distinguishes negated from non-negated atoms", () => {
            // A and !A are different conditions
            const result = dnfToCnf([[cond("A")], [cond("A", true)]]);

            expect(result).toHaveLength(1);
            const first = result[0]!;
            expect(isOrGroup(first)).toBe(true);
            if (isOrGroup(first)) {
                expect(first.conditions).toHaveLength(2);
            }
        });
    });

    describe("MAX_CNF_CLAUSES boundary", () => {
        it("allows up to 128 clauses (default limit)", () => {
            // 128 single-element terms => Cartesian product of 1^128 = 128 clauses
            // But the product is 1*1*...*1 = 1 combination with 128-element OR group
            // To actually get 128 clauses: need terms like [A,B] x 7 = 2^7 = 128
            const terms: BAFTopCondition[][] = [];
            for (let i = 0; i < 7; i++) {
                terms.push([cond(`A${i}`), cond(`B${i}`)]);
            }
            // 2^7 = 128 clauses, exactly at the limit
            const result = dnfToCnf(terms);
            expect(result).toHaveLength(128);
        });

        it("throws when exceeding 128 clauses", () => {
            // 2^8 = 256 > 128
            const terms: BAFTopCondition[][] = [];
            for (let i = 0; i < 8; i++) {
                terms.push([cond(`A${i}`), cond(`B${i}`)]);
            }

            expect(() => dnfToCnf(terms)).toThrow(/limit: 128/);
        });

        it("respects custom maxClauses parameter", () => {
            const terms: BAFTopCondition[][] = [
                [cond("A"), cond("B")],
                [cond("C"), cond("D")],
            ];

            // 2*2 = 4 clauses, below limit of 4
            expect(() => dnfToCnf(terms, 4)).not.toThrow();

            // 2*2 = 4 clauses, exceeds limit of 3
            expect(() => dnfToCnf(terms, 3)).toThrow();
        });
    });

    describe("deeply nested conditions", () => {
        it("handles three-way OR correctly", () => {
            // (A) || (B) || (C) => (A || B || C)
            const result = dnfToCnf([[cond("A")], [cond("B")], [cond("C")]]);

            expect(result).toHaveLength(1);
            const first = result[0]!;
            expect(isOrGroup(first)).toBe(true);
            if (isOrGroup(first)) {
                expect(first.conditions).toHaveLength(3);
            }
        });

        it("handles mixed single and multi-element terms", () => {
            // (A && B) || (C) || (D && E)
            // = (A||C||D) && (A||C||E) && (B||C||D) && (B||C||E)
            const result = dnfToCnf([[cond("A"), cond("B")], [cond("C")], [cond("D"), cond("E")]]);

            // 2 * 1 * 2 = 4 clauses
            expect(result).toHaveLength(4);
        });
    });

    describe("OR groups in input", () => {
        it("flattens OR groups from input terms", () => {
            // Input has an OR group already in one of the terms
            const orGroup = or(cond("X"), cond("Y"));
            const result = dnfToCnf([[orGroup], [cond("Z")]]);

            // Should produce (X || Y || Z) as one clause
            expect(result).toHaveLength(1);
            const first = result[0]!;
            expect(isOrGroup(first)).toBe(true);
            if (isOrGroup(first)) {
                expect(first.conditions).toHaveLength(3);
            }
        });
    });
});
