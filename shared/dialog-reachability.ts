/**
 * Reachability / dead-state analysis for the dialog editor (1C).
 *
 * Net-new: no orphan detection existed before. The honest signal in a single-file,
 * mod world is a THREE-way split, not a boolean - because most states in a banter /
 * APPEND dialog are entered from OUTSIDE the file (a cross-file EXTERN), so a naive
 * "unreachable from the first state" pass mass-flags them as dead (measured: 43/50 on
 * a real `%CORAN_JOINED%` banter file). The fix: a state with no in-file inbound
 * reference is an EXTERNAL ENTRY (entered from elsewhere), not an orphan.
 *
 *  - `reachable`       reached via in-file GOTO from an entry point.
 *  - `external-entry`  no in-file inbound reference -> entered from outside this file
 *                      (EXTERN / engine / a patch in another mod). Informational, never
 *                      a problem.
 *  - `orphan`          has an in-file inbound reference yet is unreachable from any
 *                      entry - a genuinely disconnected island (e.g. a copy-pasted block
 *                      whose only links are to itself). This is the real bug signal.
 *
 * Still approximate at the edges: a `%var%`-gated EXTERN whose target IS in this file
 * cannot be resolved, so a state reachable only through one could in principle be
 * mislabelled. That `unknown` refinement is deferred; the three classes above are the
 * honest, surfaceable core.
 */

import type { DialogModel, DialogState } from "./dialog-model";

export type Reachability = "reachable" | "external-entry" | "orphan";

/**
 * Classify every state in the file. Entry points are each dialog root's first state
 * plus every state with no in-file inbound GOTO (those must be entered externally).
 * Reachability is the transitive closure from that entry set over in-file GOTO edges.
 */
export function classifyReachability(model: DialogModel): Map<string, Reachability> {
    const byId = new Map<string, DialogState>();
    for (const root of model.roots) {
        for (const s of root.states) byId.set(s.id, s);
    }

    // Which states are pointed at by an in-file GOTO/target.
    const hasInbound = new Set<string>();
    for (const state of byId.values()) {
        for (const choice of state.choices) {
            if (choice.target.kind === "state" && byId.has(choice.target.stateId)) {
                hasInbound.add(choice.target.stateId);
            }
        }
    }

    // Entry points: each dialog root's first state, plus every no-inbound state (entered
    // from outside the file). Treating no-inbound states as entries is what keeps
    // EXTERN-entered banter states from being mass-flagged as dead.
    const rootEntries = new Set<string>();
    for (const root of model.roots) {
        if (root.kind === "dialog" && root.states[0]) rootEntries.add(root.states[0].id);
    }
    const queue: string[] = [...rootEntries];
    for (const id of byId.keys()) {
        if (!hasInbound.has(id)) queue.push(id);
    }

    const reached = new Set<string>();
    while (queue.length > 0) {
        const id = queue.shift();
        if (id === undefined || reached.has(id)) continue;
        reached.add(id);
        const state = byId.get(id);
        if (!state) continue;
        for (const choice of state.choices) {
            if (choice.target.kind === "state" && byId.has(choice.target.stateId)) {
                queue.push(choice.target.stateId);
            }
        }
    }

    const result = new Map<string, Reachability>();
    for (const id of byId.keys()) {
        // A root's first state is the canonical entry (reachable); any other no-inbound
        // state is entered from outside the file (external-entry); the rest classify by
        // whether the GOTO walk reached them.
        if (rootEntries.has(id)) result.set(id, "reachable");
        else if (!hasInbound.has(id)) result.set(id, "external-entry");
        else if (reached.has(id)) result.set(id, "reachable");
        else result.set(id, "orphan");
    }
    return result;
}
