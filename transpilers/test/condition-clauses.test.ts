/**
 * The distributive step BAF and D triggers share (common/condition-clauses.ts): a disjunction of conjunctions of
 * clauses, as the clauses BAF and D can hold. Atoms here are their own keys, `"!A"` standing for a negated `A`.
 */
import { describe, expect, it } from "vitest";
import { distribute } from "../common/condition-clauses";

const key = (atom: string) => atom;

describe("distribute", () => {
    describe("trivial cases", () => {
        it("keeps a single conjunction as it is", () => {
            expect(distribute([[["A"], ["B"]]], key)).toEqual([["A"], ["B"]]);
        });

        it("reads an empty term as true, which makes the whole disjunction true", () => {
            expect(distribute([[], [["A"]], []], key)).toEqual([]);
        });

        it("refuses an empty disjunction, which is false and has no clauses", () => {
            expect(() => distribute([], key)).toThrow(/an empty disjunction is false/);
        });
    });

    describe("the distributive law", () => {
        it("joins single atoms into one OR group", () => {
            expect(distribute([[["A"]], [["B"]]], key)).toEqual([["A", "B"]]);
        });

        it("converts (A && B) || C to (A || C) && (B || C)", () => {
            expect(distribute([[["A"], ["B"]], [["C"]]], key)).toEqual([
                ["A", "C"],
                ["B", "C"],
            ]);
        });

        it("converts (A && B) || (C && D) to four clauses", () => {
            expect(
                distribute(
                    [
                        [["A"], ["B"]],
                        [["C"], ["D"]],
                    ],
                    key,
                ),
            ).toEqual([
                ["A", "C"],
                ["A", "D"],
                ["B", "C"],
                ["B", "D"],
            ]);
        });

        it("keeps negations on their atoms", () => {
            expect(distribute([[["!A"], ["!B"]], [["!C"]]], key)).toEqual([
                ["!A", "!C"],
                ["!B", "!C"],
            ]);
        });

        it("handles a three-way OR and mixed term sizes", () => {
            expect(distribute([[["A"]], [["B"]], [["C"]]], key)).toEqual([["A", "B", "C"]]);
            expect(distribute([[["A"], ["B"]], [["C"]], [["D"], ["E"]]], key)).toHaveLength(4);
        });

        it("flattens a clause that is already an OR group into the one it joins", () => {
            expect(distribute([[["X", "Y"]], [["Z"]]], key)).toEqual([["X", "Y", "Z"]]);
        });
    });

    describe("deduplication", () => {
        it("keeps an atom repeated within a clause once", () => {
            expect(distribute([[["A"]], [["A"]]], key)).toEqual([["A"]]);
        });

        it("tells a negated atom from its plain one", () => {
            expect(distribute([[["A"]], [["!A"]]], key)).toEqual([["A", "!A"]]);
        });
    });

    describe("the clause limit", () => {
        const pairs = (n: number) => Array.from({ length: n }, (_, i) => [[`A${i}`], [`B${i}`]]);

        it("allows up to 128 clauses", () => {
            expect(distribute(pairs(7), key)).toHaveLength(128);
        });

        it("refuses past 128 clauses", () => {
            expect(() => distribute(pairs(8), key)).toThrow(/limit: 128/);
        });

        it("respects a custom limit", () => {
            expect(distribute(pairs(2), key, 4)).toHaveLength(4);
            expect(() => distribute(pairs(2), key, 3)).toThrow(
                "the condition distributes into 4+ trigger groups (limit: 3); simplify it",
            );
        });
    });
});
