/**
 * Reverse-references ("who reaches this state?"), computed from the model.
 *
 * A modder editing a node needs to know what points at it before touching it - the single highest-value
 * cross-reference the raw-text workflow does with a project grep. This enumerates the inbound references the
 * model already records: option targets (an `NOption`/`GOption`/... whose target is this state), bare `call`
 * transitions (a choice carrying `callSites` rather than a `callRange`), the `talk_p_proc` entry call, and an
 * external entry (a node reached by `force_dialog_start`/`start_dialog_at_node`, which the model flags in
 * `entryIds` without a reachable call site).
 *
 * Scope: the whole parsed model (all roots) - for Fallout SSL that is the entire file. Cross-FILE callers
 * (another `.ssl`/`.d`) are not represented in a single-file model and are out of scope here.
 */
import type { DialogModel } from "../../../../shared/dialog-model";

export interface Caller {
    /** option: a player option targeting the node; call: a bare `call` transition; entry: talk_p_proc;
        external-entry: force_dialog_start / start_dialog_at_node (no reachable call site). */
    kind: "option" | "call" | "entry" | "external-entry";
    /** The state the reference lives in (option/call only). */
    fromStateId?: string;
    /** The referencing choice id (option/call only) - lets the UI highlight the exact option. */
    choiceId?: string;
}

/** A caller resolved to a ready-to-display row (the display text is built where the model is in scope). */
export interface CallerRow {
    kind: Caller["kind"];
    /** The referencing state (option/call only); undefined for entries. Used to navigate on click. */
    fromStateId?: string;
    /** Ready-to-display label. */
    label: string;
}

export function findCallers(model: DialogModel, stateId: string): Caller[] {
    const callers: Caller[] = [];

    // Entry first: a talk_p_proc `call <node>` is a reachable entry; a node in entryIds with no such call is
    // reached only by force_dialog_start/start_dialog_at_node from a non-dialog procedure (an external entry).
    if ((model.entryCalls ?? []).some((ec) => ec.name === stateId)) {
        callers.push({ kind: "entry" });
    } else if ((model.entryIds ?? []).includes(stateId)) {
        callers.push({ kind: "external-entry" });
    }

    for (const root of model.roots) {
        for (const s of root.states) {
            for (const c of s.choices) {
                if (c.target.kind !== "state" || c.target.stateId !== stateId) continue;
                // A `call` transition carries callSites and no callRange; everything else is a player option.
                const kind = !c.callRange && c.callSites && c.callSites.length > 0 ? "call" : "option";
                callers.push({ kind, fromStateId: s.id, choiceId: c.id });
            }
        }
    }

    return callers;
}
