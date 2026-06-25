/**
 * Build a conversation-flow tree for one dialog file (root).
 *
 * The graph view shows the FSM as a node graph; the tree view shows it the way
 * the dialog actually plays: rooted at the entry state(s), an NPC line expands
 * into its player replies, each reply into the next NPC state, recursively.
 *
 * Cycles and shared sub-trees are collapsed by "first expansion wins": a state
 * is fully expanded the first time it is reached; every later reference to it
 * becomes a `ref` leaf (a clickable link to the expanded copy). That keeps the
 * tree finite (no infinite loop on a cycle) and compact (no exponential
 * re-expansion of a hub reached from many places).
 *
 * Pure and presentation-free: text is resolved for display, but the cross-file
 * jump resolution is injected so this module stays decoupled from the editor's
 * root maps (and stays trivially testable).
 */
import { resolveText, type DialogChoice, type DialogRoot } from "../../../../shared/dialog-model";
import type { JumpTarget } from "./jump-resolve";

export type ConvTarget =
    /** First expansion of a same-file state: its sub-tree renders inline. */
    | { kind: "state"; node: ConvState }
    /** A same-file state already expanded elsewhere: a link back to it. */
    | { kind: "ref"; stateId: string }
    | { kind: "exit" }
    /** Cross-file target; `jump` is set when it resolves to another tab. */
    | { kind: "external"; label: string; jump?: JumpTarget };

export interface ConvReply {
    /** Choice id (stable key). */
    id: string;
    /** Resolved player reply text; empty for a direct continue/call. */
    text: string;
    /** Whether this is a player reply (has text) vs. a silent continue. */
    hasText: boolean;
    condition?: string;
    action?: string;
    target: ConvTarget;
}

export interface ConvState {
    id: string;
    speaker: string;
    /** Resolved NPC line. */
    text: string;
    trigger?: string;
    /** Set for a CHAIN/INTERJECT/EXTEND-derived (read-only) state. */
    derivedFrom?: string;
    replies: ConvReply[];
    /** True for a top-level state (no incoming same-file transition). */
    isEntry: boolean;
}

export interface ConversationTree {
    roots: ConvState[];
}

export type ResolveJump = (label: string) => JumpTarget | undefined;

export function buildConversationTree(
    root: DialogRoot,
    messages: Record<string, string> | undefined,
    resolveJump: ResolveJump,
): ConversationTree {
    const byId = new Map(root.states.map((s) => [s.id, s]));

    // A state is an entry if no same-file transition targets it.
    const targeted = new Set<string>();
    for (const s of root.states) {
        for (const c of s.choices) {
            if (c.target.kind === "state" && byId.has(c.target.stateId)) targeted.add(c.target.stateId);
        }
    }

    const shown = new Set<string>();

    const buildTarget = (c: DialogChoice): ConvTarget => {
        if (c.target.kind === "exit") return { kind: "exit" };
        if (c.target.kind === "external")
            return { kind: "external", label: c.target.label, jump: resolveJump(c.target.label) };
        // kind === "state"
        const stateId = c.target.stateId;
        if (!byId.has(stateId)) {
            // A goto whose target is not in this file - a cross-file link, like EXTERN.
            return { kind: "external", label: stateId, jump: resolveJump(stateId) };
        }
        if (shown.has(stateId)) return { kind: "ref", stateId };
        return { kind: "state", node: expand(byId.get(stateId)!.id) };
    };

    function expand(id: string): ConvState {
        const s = byId.get(id)!;
        shown.add(id);
        const replies: ConvReply[] = s.choices.map((c) => ({
            id: c.id,
            text: resolveText(c.text, messages),
            hasText: Boolean(c.text),
            condition: c.condition,
            action: c.action,
            target: buildTarget(c),
        }));
        return {
            id: s.id,
            speaker: s.speaker ?? "NPC",
            text: resolveText(s.text, messages),
            trigger: s.trigger,
            derivedFrom: s.derivedFrom,
            replies,
            isEntry: !targeted.has(s.id),
        };
    }

    const roots: ConvState[] = [];
    // Entries first, in source order, then any state not yet reached (states only
    // inside a cycle, or otherwise unreachable from an entry) so every state of the
    // file appears exactly once - parity with the graph, which shows them all.
    for (const s of root.states) if (!targeted.has(s.id) && !shown.has(s.id)) roots.push(expand(s.id));
    for (const s of root.states) if (!shown.has(s.id)) roots.push(expand(s.id));
    return { roots };
}
