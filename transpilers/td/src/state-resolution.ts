/**
 * TD Post-Parse State Resolution
 *
 * After parsing, this module handles two passes:
 * 1. Transitive collection: follow goTo targets and auto-add reachable states
 * 2. Orphan detection: warn about uncollected state-like functions
 */

import {
    TDConstructType,
    TDTransitionType,
    ORPHAN_WARNING_TEMPLATE,
    type TDConstruct,
    type TDState,
    type TDWarning,
} from "./types";
import type { VarsContext } from "../../common/transpiler-utils";
import { transformFunctionToState, type FuncsContext } from "./state-transitions";

/**
 * Collect all goTo target names from a state's transitions.
 */
function collectGoToTargets(state: TDState): Set<string> {
    const targets = new Set<string>();
    for (const trans of state.transitions) {
        if (trans.next.type === TDTransitionType.Goto) {
            // Only collect non-numeric string targets (local function refs)
            const target = trans.next.target;
            if (!/^\d+$/.test(target)) {
                targets.add(target);
            }
        }
    }
    return targets;
}

/**
 * Build a set of all explicit state labels across all Begin/Append constructs.
 */
export function collectExplicitLabels(constructs: readonly TDConstruct[]): Set<string> {
    const labels = new Set<string>();
    for (const c of constructs) {
        if (c.type === TDConstructType.Begin || c.type === TDConstructType.Append) {
            for (const state of c.states) {
                labels.add(state.label);
            }
        }
    }
    return labels;
}

/**
 * Follow goTo targets from collected states and auto-add any local
 * functions that aren't already explicitly passed to any construct.
 * Prevents having to manually list every reachable state.
 */
export function resolveTransitiveStates(constructs: TDConstruct[], funcs: FuncsContext, vars: VarsContext) {
    const explicitLabels = collectExplicitLabels(constructs);

    for (const construct of constructs) {
        if (construct.type !== TDConstructType.Begin && construct.type !== TDConstructType.Append) {
            continue;
        }

        // BFS from existing states' goTo targets.
        // If two constructs share a goTo target, the first one processed wins.
        // Users must list shared states explicitly in the intended construct.
        const collected = new Set<string>();
        const newStates: TDState[] = [];
        const queue: string[] = [];

        // Seed the queue with goTo targets from all current states
        for (const state of construct.states) {
            for (const target of collectGoToTargets(state)) {
                queue.push(target);
            }
        }

        let qi = 0;
        while (qi < queue.length) {
            const target = queue[qi++]!;

            // Skip if already processed, already explicit, or not a local function
            if (collected.has(target) || explicitLabels.has(target)) continue;

            const funcInfo = funcs.get(target);
            if (!funcInfo) continue;

            // Skip functions with parameters (helpers, not states)
            if (funcInfo.func.getParameters().length > 0) continue;

            // Collect this state
            collected.add(target);
            explicitLabels.add(target);

            const state = transformFunctionToState(funcInfo.func, vars, funcs, funcInfo.trigger);
            if (state) {
                newStates.push(state);

                // Follow this new state's goTo targets
                for (const newTarget of collectGoToTargets(state)) {
                    queue.push(newTarget);
                }
            }
        }

        if (newStates.length > 0) {
            construct.states = [...construct.states, ...newStates];
        }
    }
}

/**
 * Warn about functions that look like state functions but were never
 * collected by any construct (not explicit, not transitive, not called as helper).
 */
export function collectOrphanWarnings(
    constructs: readonly TDConstruct[],
    funcs: FuncsContext,
    calledAsFunction: ReadonlySet<string>,
): TDWarning[] {
    const collectedLabels = collectExplicitLabels(constructs);
    const warnings: TDWarning[] = [];

    for (const [name, funcInfo] of funcs) {
        // Skip if already collected in some construct
        if (collectedLabels.has(name)) continue;

        // Skip if used as a direct callee (helper function)
        if (calledAsFunction.has(name)) continue;

        // Skip if has parameters (helper, not state)
        if (funcInfo.func.getParameters().length > 0) continue;

        // Underline the function name identifier
        const nameNode = funcInfo.func.getNameNode();
        const sf = funcInfo.func.getSourceFile();
        const startCol = nameNode ? sf.getLineAndColumnAtPos(nameNode.getStart()).column - 1 : 0;
        const endCol = nameNode ? sf.getLineAndColumnAtPos(nameNode.getEnd()).column - 1 : 0;

        warnings.push({
            message: ORPHAN_WARNING_TEMPLATE(name),
            line: nameNode ? nameNode.getStartLineNumber() : funcInfo.func.getStartLineNumber(),
            columnStart: startCol,
            columnEnd: endCol,
        });
    }

    return warnings;
}
