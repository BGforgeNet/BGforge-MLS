/**
 * Convert a format-neutral DialogModel into Svelte Flow nodes + edges.
 *
 * Pure and position-free: layout (elkjs) assigns coordinates afterwards. Each
 * dialog state becomes a card node; each choice becomes an edge from a per-choice
 * source handle. External anchors and the EXIT terminal are deduplicated synthetic
 * nodes so no edge dangles.
 */

import {
    isFlaggedNode,
    renderFamily,
    resolveText,
    sslTerminalKind,
    type DialogModel,
    type DialogState,
} from "../../../../shared/dialog-model";
import { classifyReachability } from "../../../../shared/dialog-reachability";
import { msgRef } from "./inspector-edit";

/** The distinct `@N` message refs a state uses across its own line and its options. */
function stateRefs(s: DialogState): string[] {
    const refs = new Set<string>();
    const line = msgRef(s.text);
    if (line) refs.add(line);
    for (const c of s.choices) {
        const r = msgRef(c.text);
        if (r) refs.add(r);
    }
    return [...refs];
}

/**
 * States that share a `@N` ref with at least one OTHER state - editing such text (line or reply) here
 * rewrites the one shared `.msg`/`.tra` entry and changes every state that uses it. Duplicating a node
 * keeps the original's refs, so both the copy and the original land in this set; an authored shared ref
 * does too. Pure projection over the model; the renderer marks these nodes so the coupling is not silent.
 */
function sharedTextStates(model: DialogModel): (s: DialogState) => boolean {
    const refUsers = new Map<string, number>();
    for (const root of model.roots)
        for (const s of root.states) for (const r of stateRefs(s)) refUsers.set(r, (refUsers.get(r) ?? 0) + 1);
    return (s: DialogState) => stateRefs(s).some((r) => (refUsers.get(r) ?? 0) > 1);
}

export interface FlowNode {
    id: string;
    type: "card" | "external" | "exit" | "combat";
    position: { x: number; y: number };
    width: number;
    height: number;
    data: Record<string, unknown>;
}

export type EdgeCategory = "player" | "continue" | "exit" | "combat" | "external";

export interface FlowEdge {
    id: string;
    source: string;
    target: string;
    sourceHandle?: string;
    /** "back" marks an edge the layout routes as a returning/cyclic edge. */
    kind: "forward" | "back";
    /** Transition type, used to color the edge. */
    category: EdgeCategory;
    dashed: boolean;
    label?: string;
}

const NODE_WIDTH = 200;
const HEADER_H = 26;
const ROW_H = 20;
const BODY_LINE_H = 16;
// Conservative chars-per-line for the ~184px text column at the card font size: the NPC
// line wraps, so the card height grows with it. Under-counting chars (over-reserving
// height) is deliberate - it keeps the layout from overlapping when text wraps long.
const BODY_CHARS_PER_LINE = 24;

export function stateNodeSize(state: DialogState, displayTextLen = 0): { width: number; height: number } {
    const bodyLines = Math.max(1, Math.ceil(displayTextLen / BODY_CHARS_PER_LINE));
    const bodyH = bodyLines * BODY_LINE_H + 8;
    return { width: NODE_WIDTH, height: HEADER_H + bodyH + Math.max(state.choices.length, 0) * ROW_H + 8 };
}

export interface FlowGraph {
    nodes: FlowNode[];
    edges: FlowEdge[];
}

export function modelToFlow(model: DialogModel): FlowGraph {
    const nodes: FlowNode[] = [];
    const edges: FlowEdge[] = [];
    const stateIds = new Set<string>();
    const synthetic = new Map<string, FlowNode>(); // dedup external/exit/combat nodes by id

    // SSL convention: Node998/Node999 are terminal Combat/Exit targets, not drawn cards (SSL_TERMINAL_NODES).
    // Skip their cards and route an option targeting them to the matching terminal instead (mirrors the tree).
    const isSSL = renderFamily(model.sourceLang) === "fallout-ssl";
    const terminalKindOf = (id: string): "exit" | "combat" | undefined => (isSSL ? sslTerminalKind(id) : undefined);

    for (const root of model.roots) {
        for (const s of root.states) if (!terminalKindOf(s.id)) stateIds.add(s.id);
    }

    const ensureSynthetic = (id: string, type: "external" | "exit" | "combat", label: string, title?: string): void => {
        if (synthetic.has(id)) return;
        const n: FlowNode = {
            id,
            type,
            position: { x: 0, y: 0 },
            width: type === "external" ? 150 : type === "combat" ? 90 : 70,
            height: 36,
            data: { label, ...(title ? { title } : {}) },
        };
        synthetic.set(id, n);
    };

    const messages = model.messages;
    // Reachability is a pure projection over the whole model; compute once and tag each
    // card so the renderer can flag dead states (orphan) and EXTERN entries.
    const reach = classifyReachability(model);
    const isShared = sharedTextStates(model);
    // A root can carry the same state label twice - two CHAIN blocks whose terminal state shares a label
    // (VISK1 in x#viconia.d). Svelte Flow keys nodes (and edges) by id, so a second card/edge with a
    // repeated id throws each_key_duplicate and crashes the whole graph render. Emit one card per DISTINCT
    // id (and skip the duplicate's edges), matching the tree, which already merges these states. Deeper
    // faithful representation of a doubly-defined label is a separate concern (routing-layer work).
    const emittedCardIds = new Set<string>();
    for (const root of model.roots) {
        for (const s of root.states) {
            // A reserved terminal node (SSL Node998/Node999) is never drawn as a card - it renders only as the
            // Combat/Exit terminal that options route to (below).
            if (terminalKindOf(s.id)) continue;
            if (emittedCardIds.has(s.id)) continue;
            emittedCardIds.add(s.id);
            const { width, height } = stateNodeSize(s, resolveText(s.text, messages).length);
            // messages travels in node data so the card can resolve @N at render time
            // while the raw refs stay on the state (needed for .tra write-back).
            nodes.push({
                id: s.id,
                type: "card",
                position: { x: 0, y: 0 },
                width,
                height,
                // `flagged` drives the spotlight overlay: true iff the node carries any
                // badge (state- or choice-level). Computed here so a toggle just flips a
                // CSS class - no model-to-flow rebuild on toggle.
                data: {
                    state: s,
                    // File base name -> speaker fallback for the card header (see stateHeadLabel).
                    sourceName: model.sourceName,
                    messages,
                    reachability: reach.get(s.id),
                    flagged: isFlaggedNode(s),
                    // True when this node's line or a reply shares a .msg/.tra ref with another node
                    // (e.g. a duplicated node) - editing the text here also changes the other node.
                    sharedText: isShared(s),
                    // Per-node structural editability (drives handle connectability + the inspector's
                    // Tier 1 controls): a D state is editable with the model; an SSL node is editable
                    // only when faithfully representable (see DialogState.faithful / bundleFaithful).
                    // Editability, NOT render family: only real SSL (sourceLang "ssl") is structurally
                    // editable via the tier system this phase. TSSL renders as SSL (renderFamily) but is
                    // view-only until its write-back lands (Phase 2), so it must not gate on renderFamily here.
                    structuralEditable:
                        model.editable ||
                        (model.sourceLang === "ssl" && (s.faithful === true || s.bundleFaithful === true)),
                    // Field editability (drives output-handle connectability for RETARGET): the ssl-family
                    // superset - real SSL plus faithful/bundle TSSL, whose target token round-trips to source.
                    fieldEditable:
                        model.editable ||
                        ((model.sourceLang === "ssl" || model.sourceLang === "tssl") &&
                            (s.faithful === true || s.bundleFaithful === true)),
                },
            });

            s.choices.forEach((c) => {
                // SSL Node998/Node999 targets route to the Combat/Exit terminal, not a card. The exit terminal
                // is shared with plain `{kind:"exit"}` options, so it carries no id tooltip; combat is only ever
                // Node998, so it does (mirrors the tree's per-chip tooltip where it can be precise).
                const terminal = c.target.kind === "state" ? terminalKindOf(c.target.stateId) : undefined;
                let targetId: string;
                if (terminal === "exit") {
                    targetId = "exit";
                    ensureSynthetic("exit", "exit", "EXIT");
                } else if (terminal === "combat") {
                    targetId = "combat";
                    ensureSynthetic("combat", "combat", "COMBAT", "Node998");
                } else if (c.target.kind === "state") {
                    targetId = c.target.stateId;
                    // A goto/call to a state not present in this file - keep the edge from dangling.
                    if (!stateIds.has(targetId)) {
                        targetId = `ext:${c.target.stateId}`;
                        ensureSynthetic(targetId, "external", c.target.stateId);
                    }
                } else if (c.target.kind === "external") {
                    targetId = `ext:${c.target.label}`;
                    ensureSynthetic(targetId, "external", c.target.label);
                } else {
                    targetId = "exit";
                    ensureSynthetic("exit", "exit", "EXIT");
                }
                const category: EdgeCategory =
                    terminal === "combat"
                        ? "combat"
                        : terminal === "exit" || c.target.kind === "exit"
                          ? "exit"
                          : c.target.kind === "external"
                            ? "external"
                            : c.text
                              ? "player"
                              : "continue";
                edges.push({
                    id: c.id,
                    source: s.id,
                    target: targetId,
                    sourceHandle: c.id,
                    kind: "forward",
                    category,
                    dashed: c.target.kind === "external" || Boolean(c.condition),
                    // No edge label: the reply text lives on the source card's choice row
                    // and in the inspector. A resolved sentence here renders as a large
                    // white pill over the edge (the old `@N` token was incidentally tiny).
                });
            });
        }
    }

    nodes.push(...synthetic.values());
    markBackEdges(nodes, edges);
    return { nodes, edges };
}

/**
 * Mark edges whose target was already seen on the path from a root as "back"
 * edges (cycles), so the renderer can style them distinctly. Simple DFS over the
 * card subgraph; synthetic terminals never start cycles.
 */
function markBackEdges(nodes: FlowNode[], edges: FlowEdge[]): void {
    const out = new Map<string, FlowEdge[]>();
    for (const e of edges) (out.get(e.source) ?? out.set(e.source, []).get(e.source)!).push(e);
    const cardIds = new Set(nodes.filter((n) => n.type === "card").map((n) => n.id));
    const onStack = new Set<string>();
    const done = new Set<string>();

    const dfs = (id: string): void => {
        onStack.add(id);
        for (const e of out.get(id) ?? []) {
            if (onStack.has(e.target)) {
                e.kind = "back";
                e.dashed = true;
            } else if (!done.has(e.target) && cardIds.has(e.target)) {
                dfs(e.target);
            }
        }
        onStack.delete(id);
        done.add(id);
    };

    for (const id of cardIds) if (!done.has(id)) dfs(id);
}
