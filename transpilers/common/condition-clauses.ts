/**
 * Folded conditions in the form BAF and D triggers take: clauses that must all hold, each holding when any of its
 * atoms does. A one-atom clause is a plain trigger line, a longer one an OR(n) group, which groups trigger calls
 * only - so an && inside an || is distributed out first.
 */

import type { Condition } from "./compile-time-eval";
import { TranspileError } from "./transpile-error";

export type Atom = Extract<Condition, { kind: "atom" }>;

/** Most clauses one condition may distribute into; past it the source is better rewritten than emitted. */
const MAX_CLAUSES = 128;

/**
 * `condition` as clauses of atoms, each atom built by `atom` and told apart by `key`. A true condition has no
 * clauses; a false one has none either, so its caller drops what it guards before asking.
 */
export function toClauses<A>(condition: Condition, atom: (a: Atom) => A, key: (a: A) => string): A[][] {
    switch (condition.kind) {
        case "constant":
            if (condition.value) return [];
            throw new Error("a false condition has no clauses; its caller drops what it guards");
        case "atom":
            return [[atom(condition)]];
        case "and":
            return condition.items.flatMap((item) => toClauses(item, atom, key));
        case "or":
            return distribute(
                condition.items.map((item) => toClauses(item, atom, key)),
                key,
            );
    }
}

/**
 * The clauses of a disjunction whose terms are each a conjunction of clauses, by the distributive law:
 * `(A && B) || C` is `(A || C) && (B || C)`. An atom repeated within a clause is kept once.
 */
export function distribute<A>(
    terms: readonly (readonly (readonly A[])[])[],
    key: (a: A) => string,
    maxClauses = MAX_CLAUSES,
): A[][] {
    if (terms.length === 0) throw new Error("an empty disjunction is false; its caller drops what it guards");
    // An empty term is the empty conjunction, which is true, and so is any disjunction holding it.
    if (terms.some((term) => term.length === 0)) return [];

    let size = 1;
    for (const term of terms) {
        size *= term.length;
        if (size > maxClauses) {
            throw new TranspileError(
                `the condition distributes into ${size}+ trigger groups (limit: ${maxClauses}); simplify it`,
            );
        }
    }

    let clauses: A[][] = [[]];
    for (const term of terms) {
        const next: A[][] = [];
        for (const partial of clauses) {
            for (const clause of term) next.push(union(partial, clause, key));
        }
        clauses = next;
    }
    return clauses;
}

function union<A>(left: readonly A[], right: readonly A[], key: (a: A) => string): A[] {
    const seen = new Set(left.map((atom) => key(atom)));
    const result = [...left];
    for (const atom of right) {
        const k = key(atom);
        if (seen.has(k)) continue;
        seen.add(k);
        result.push(atom);
    }
    return result;
}
