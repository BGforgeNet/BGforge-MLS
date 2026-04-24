/**
 * CNF (Conjunctive Normal Form) conversion utilities for TBAF.
 *
 * BAF conditions must be in CNF: AND of (atoms or OR-groups).
 * When inverting complex expressions, we may get DNF (OR of ANDs),
 * which needs to be converted to CNF using the distributive law.
 */

import type { BAFCondition, BAFOrGroup, BAFTopCondition } from "./ir";
import { TranspileError } from "../../common/transpile-error";

/** Maximum clauses to generate before erroring (prevents exponential blowup) */
const MAX_CNF_CLAUSES = 128;

/**
 * Convert DNF (disjunction of conjunctions) to CNF.
 *
 * Input: Array of "terms", where each term is a conjunction (BAFTopCondition[]).
 *        The terms are implicitly ORed together.
 *
 * Example:
 *   terms = [[!A, !B], [!C]]
 *   meaning: (!A && !B) || (!C)
 *   result: [(!A || !C), (!B || !C)]
 *   meaning: (!A || !C) && (!B || !C)
 *
 * Uses the distributive law: (A && B) || C = (A || C) && (B || C)
 *
 * @param terms Array of conjunctions to OR together
 * @param maxClauses Maximum allowed clauses in result
 * @returns CNF as BAFTopCondition[]
 */
export function dnfToCnf(terms: BAFTopCondition[][], maxClauses = MAX_CNF_CLAUSES): BAFTopCondition[] {
    if (terms.length === 0) return [];
    const firstTerm = terms[0];
    if (terms.length === 1 && firstTerm) return firstTerm; // Single conjunction is already CNF

    // Filter out empty terms (they represent "false" in the OR, can be ignored)
    const nonEmptyTerms = terms.filter((t) => t.length > 0);
    if (nonEmptyTerms.length === 0) return [];
    const firstNonEmpty = nonEmptyTerms[0];
    if (nonEmptyTerms.length === 1 && firstNonEmpty) return firstNonEmpty;

    // Calculate result size to check limits before computing
    let resultSize = 1;
    for (const term of nonEmptyTerms) {
        resultSize *= term.length;
        if (resultSize > maxClauses) {
            throw new TranspileError(
                `Condition inversion would produce ${resultSize}+ clauses (limit: ${maxClauses}). ` +
                    `Simplify the condition or avoid negating complex AND expressions.`,
            );
        }
    }

    // Cartesian product: pick one element from each term, OR them together
    const result: BAFTopCondition[] = [];

    // Generate all combinations using iterative approach
    const indices = Array.from<number>({ length: nonEmptyTerms.length }).fill(0);

    for (;;) {
        // Create OR group from current combination
        const combination: BAFTopCondition[] = [];
        nonEmptyTerms.forEach((term, i) => {
            const idx = indices[i];
            if (idx !== undefined) {
                const item = term[idx];
                if (item) combination.push(item);
            }
        });
        const atoms = flattenToAtoms(combination);

        // Deduplicate atoms in the OR group
        const uniqueAtoms = deduplicateAtoms(atoms);

        const firstUnique = uniqueAtoms[0];
        if (uniqueAtoms.length === 1 && firstUnique) {
            result.push(firstUnique);
        } else {
            result.push({ conditions: uniqueAtoms });
        }

        // Increment indices (like counting in mixed-radix)
        let j = nonEmptyTerms.length - 1;
        while (j >= 0) {
            const idx = indices[j];
            const term = nonEmptyTerms[j];
            if (idx !== undefined) {
                indices[j] = idx + 1;
                if (term && (indices[j] ?? -1) < term.length) break;
                indices[j] = 0;
            }
            j--;
        }
        if (j < 0) break; // All combinations generated
    }

    return result;
}

/**
 * Flatten an array of BAFTopConditions into atoms (BAFCondition[]).
 * OR groups are expanded into their constituent atoms.
 */
function flattenToAtoms(conditions: BAFTopCondition[]): BAFCondition[] {
    const atoms: BAFCondition[] = [];
    for (const cond of conditions) {
        if (isOrGroup(cond)) {
            atoms.push(...cond.conditions);
        } else {
            atoms.push(cond);
        }
    }
    return atoms;
}

/**
 * Remove duplicate atoms from an array.
 * Two atoms are equal if they have the same name, args, and negation.
 */
function deduplicateAtoms(atoms: BAFCondition[]): BAFCondition[] {
    const seen = new Set<string>();
    const result: BAFCondition[] = [];

    for (const atom of atoms) {
        const key = `${atom.negated ? "!" : ""}${atom.name}(${atom.args.join(",")})`;
        if (!seen.has(key)) {
            seen.add(key);
            result.push(atom);
        }
    }

    return result;
}

/**
 * Type guard for BAFOrGroup.
 */
function isOrGroup(cond: BAFTopCondition): cond is BAFOrGroup {
    return "conditions" in cond;
}
