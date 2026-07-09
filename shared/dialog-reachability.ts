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
const REACHABILITY_RANK: Record<Reachability, number> = { reachable: 2, "external-entry": 1, orphan: 0 };

export function classifyReachability(model: DialogModel): Map<string, Reachability> {
    // A state label is unique only WITHIN its own dialogue (root): a `.d` file with several BEGIN/APPEND
    // dialogues can define the same label in two roots. So classify each root INDEPENDENTLY - flattening every
    // root into one id-keyed map lets one root's state overwrite the other's, and a walk that reaches the shared
    // label then explores the WRONG root's edges. A label appearing in several roots (or twice in one root, the
    // duplicate-CHAIN-label case) takes its BEST verdict, matching the graph, which collapses duplicate-id states
    // to one card.
    const result = new Map<string, Reachability>();
    const record = (id: string, r: Reachability): void => {
        const prev = result.get(id);
        if (prev === undefined || REACHABILITY_RANK[r] > REACHABILITY_RANK[prev]) result.set(id, r);
    };

    for (const root of model.roots) {
        const byId = new Map<string, DialogState>();
        for (const s of root.states) byId.set(s.id, s);

        // Which states this root's own GOTO/targets point at.
        const hasInbound = new Set<string>();
        for (const state of root.states) {
            for (const choice of state.choices) {
                if (choice.target.kind === "state" && byId.has(choice.target.stateId)) {
                    hasInbound.add(choice.target.stateId);
                }
            }
        }

        // Entry points: the dialog root's first state, plus every no-inbound state (entered from outside the
        // file). Treating no-inbound states as entries is what keeps EXTERN-entered banter states from being
        // mass-flagged as dead. A patch root (kind !== "dialog") has no canonical entry.
        const rootEntry = root.kind === "dialog" ? root.states[0]?.id : undefined;
        const queue: string[] = [];
        if (rootEntry !== undefined) queue.push(rootEntry);
        for (const s of root.states) if (!hasInbound.has(s.id)) queue.push(s.id);

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

        for (const s of root.states) {
            // The root's first state is the canonical entry (reachable); any other no-inbound state is entered
            // from outside the file (external-entry); the rest classify by whether the GOTO walk reached them.
            if (s.id === rootEntry) record(s.id, "reachable");
            else if (!hasInbound.has(s.id)) record(s.id, "external-entry");
            else if (reached.has(s.id)) record(s.id, "reachable");
            else record(s.id, "orphan");
        }
    }
    return result;
}
