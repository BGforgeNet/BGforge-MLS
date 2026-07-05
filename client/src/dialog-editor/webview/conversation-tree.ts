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
import {
    resolveText,
    sslTerminalKind,
    type DialogChoice,
    type DialogReaction,
    type DialogRoot,
} from "../../../../shared/dialog-model";
import { isPendingChoice, isPendingState, textFieldLocked } from "./inspector-edit";
import type { JumpTarget } from "./jump-resolve";

export type ConvTarget =
    /** First expansion of a same-file state: its sub-tree renders inline. */
    | { kind: "state"; node: ConvState }
    /** A same-file state already expanded elsewhere: a link back to it. */
    | { kind: "ref"; stateId: string }
    /** Terminal exit. `nodeId` is set (SSL) when this is an option reaching the Node999 end node, shown as a tooltip. */
    | { kind: "exit"; nodeId?: string }
    /** Terminal combat (SSL Node998); `nodeId` (always "Node998") is shown as a tooltip. */
    | { kind: "combat"; nodeId: string }
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
    /** SSL option reaction (G/N/B) and low-INT variant, for the same chip the graph card shows. */
    reaction?: DialogReaction;
    lowIq?: boolean;
    /** Whether this option's text can be edited inline in the tree - the same gate the inspector's text
        field uses (textFieldLocked): false for a locked SSL @N or a read-only/derived node. */
    textEditable: boolean;
    target: ConvTarget;
}

/** One condition-branch of a bundle (if/else) state: its own NPC line and the replies it shows. */
export interface ConvBranch {
    kind: "if" | "else";
    /** Present for an `if` branch; absent for the `else`. */
    condition?: string;
    /** Resolved NPC line shown when this branch is active. */
    npc: string;
    npcHasText: boolean;
    replies: ConvReply[];
}

export interface ConvState {
    id: string;
    /** Real speaker name (WeiDU D character). Absent for SSL - the row then shows only the (dimmed) id.
        The tree does NOT use the SSL file-name fallback the card/inspector do: down a single-file tree the
        base name repeats on every row (one SSL script is one NPC), so it is redundant noise there. */
    speaker?: string;
    /** Resolved NPC line. */
    text: string;
    trigger?: string;
    /** Set for a CHAIN/INTERJECT/EXTEND-derived (read-only) state. */
    derivedFrom?: string;
    /** Flat replies; empty when `branches` is set (a bundle node groups its replies per branch). */
    replies: ConvReply[];
    /** Set for an SSL if/else bundle node: each branch carries its own NPC line + replies, so the
        tree reflects the branch structure instead of flattening to the if-branch line + all options. */
    branches?: ConvBranch[];
    /** True for a top-level state (no incoming same-file transition). */
    isEntry: boolean;
    /** Whether this state's NPC line can be edited inline in the tree - the same gate the inspector's NPC
        field uses (textFieldLocked over the state's own text): false for a locked SSL @N or a read-only/
        derived node. Mirrors ConvReply.textEditable for the option text. */
    textEditable: boolean;
}

export interface ConversationTree {
    roots: ConvState[];
}

export type ResolveJump = (label: string) => JumpTarget | undefined;

export function buildConversationTree(
    root: DialogRoot,
    messages: Record<string, string> | undefined,
    resolveJump: ResolveJump,
    // Edit-gating context for each reply's `textEditable`, mirroring the inspector's textFieldLocked inputs.
    // Optional (defaults to an editable D file) so the pure-projection tests can stay 3-arg; the editor
    // always passes real values. Destructured with per-key defaults rather than an object-literal default
    // param (which oxlint's no-object-as-default-parameter rightly flags - a shared mutable default).
    opts?: { ssl: boolean; editable: boolean },
): ConversationTree {
    const { ssl = false, editable = true } = opts ?? {};
    // SSL convention: Node998/Node999 are terminal Combat/Exit targets, not drawn conversation nodes
    // (SSL_TERMINAL_NODES). Exclude them from the states the tree draws; buildTarget maps an option targeting
    // them to a terminal chip instead. Non-SSL formats keep every state.
    const drawn = ssl ? root.states.filter((s) => !sslTerminalKind(s.id)) : root.states;
    const byId = new Map(drawn.map((s) => [s.id, s]));

    // A state is an entry if no same-file transition targets it.
    const targeted = new Set<string>();
    for (const s of drawn) {
        for (const c of s.choices) {
            if (c.target.kind === "state" && byId.has(c.target.stateId)) targeted.add(c.target.stateId);
        }
    }

    const shown = new Set<string>();

    const buildTarget = (c: DialogChoice): ConvTarget => {
        if (c.target.kind === "state" && ssl) {
            // Map a target to a reserved support node to its terminal chip (Node999 -> Exit, Node998 -> Combat),
            // carrying the underlying id as a tooltip. Checked before the byId lookup below (the support node is
            // not in `byId`, so it would otherwise fall through to the cross-file "external" branch).
            const terminal = sslTerminalKind(c.target.stateId);
            if (terminal === "exit") return { kind: "exit", nodeId: c.target.stateId };
            if (terminal === "combat") return { kind: "combat", nodeId: c.target.stateId };
        }
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

    const buildReply = (c: DialogChoice, textRO: boolean): ConvReply => ({
        id: c.id,
        text: resolveText(c.text, messages),
        hasText: Boolean(c.text),
        condition: c.condition,
        action: c.action,
        reaction: c.reaction,
        lowIq: c.lowIq,
        textEditable: !textFieldLocked({ text: c.text, messages, ssl, textRO, isNew: isPendingChoice(c) }),
        target: buildTarget(c),
    });

    function expand(id: string): ConvState {
        const s = byId.get(id)!;
        shown.add(id);
        // Whether this state's text fields are read-only (mirrors the inspector's `textRO`): a derived
        // state is fully read-only; a non-editable non-SSL file (view-only D) is too. SSL text persists to
        // the .msg, so it stays editable subject to the per-@N resolvability gate inside textFieldLocked.
        const textRO = Boolean(s.derivedFrom) || (!editable && !ssl);
        // A bundle (if/else) node groups its replies per branch, each with its own NPC line. Build the
        // branch structure instead of the flat choice list so the tree mirrors the graph/inspector
        // (otherwise the else branch's NPC line and the per-branch grouping are lost). Each choice is
        // expanded exactly once - through the branch path here, never also as a flat reply - so a
        // target is not double-marked "shown".
        let replies: ConvReply[] = [];
        let branches: ConvBranch[] | undefined;
        if (s.branches && s.branches.length > 0) {
            const choiceById = new Map(s.choices.map((c) => [c.id, c]));
            branches = s.branches.map((b) => ({
                kind: b.kind,
                condition: b.condition,
                npc: resolveText(b.replies[0]?.text, messages),
                npcHasText: Boolean(b.replies[0]?.text),
                replies: b.choiceIds
                    .map((cid) => choiceById.get(cid))
                    .filter((c): c is DialogChoice => c !== undefined)
                    .map((c) => buildReply(c, textRO)),
            }));
        } else {
            replies = s.choices.map((c) => buildReply(c, textRO));
        }
        return {
            id: s.id,
            speaker: s.speaker,
            text: resolveText(s.text, messages),
            trigger: s.trigger,
            derivedFrom: s.derivedFrom,
            replies,
            ...(branches ? { branches } : {}),
            isEntry: !targeted.has(s.id),
            textEditable: !textFieldLocked({ text: s.text, messages, ssl, textRO, isNew: isPendingState(s) }),
        };
    }

    const roots: ConvState[] = [];
    // Entries first, in source order, then any state not yet reached (states only
    // inside a cycle, or otherwise unreachable from an entry) so every state of the
    // file appears exactly once - parity with the graph, which shows them all.
    for (const s of drawn) if (!targeted.has(s.id) && !shown.has(s.id)) roots.push(expand(s.id));
    for (const s of drawn) if (!shown.has(s.id)) roots.push(expand(s.id));
    return { roots };
}
