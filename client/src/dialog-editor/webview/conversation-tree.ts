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
    type DialogBlock,
    type DialogChoice,
    type DialogReaction,
    type DialogRoot,
    type DialogState,
} from "../../../../shared/dialog-model";
import { isUnsavedDraftChoice, isUnsavedDraftState, textEditability } from "./inspector-edit";
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
        field uses (textEditability): false for a locked SSL @N or a read-only/derived node. */
    textEditable: boolean;
    /** True for an option that exists in the webview's optimistic model but is not yet in the source parse - a
        just-added option before the reparse adopts it, or an empty option deferred until its text commits. The
        tree/card render it as an unsaved draft. Absent (not false) for a committed option. */
    pending?: boolean;
    target: ConvTarget;
    /** Byte offset of this option's statement in the source (SSL `callRange`/`stmtRange`, or the first call
        site for a `call` transition; WeiDU D `sourceRange`), for "go to source". Absent for a pending/synthetic
        option. */
    sourceOffset?: number;
    /** Path key of the branch this option sits in (set for options inside an if/else node - see
        stampBranchKeys). Drives the tree's branch highlight: clicking a branch line highlights every row whose
        branchKey starts with the clicked branch's key. Absent for a flat (unbranched) node's options. */
    branchKey?: string;
}

/**
 * One item in a recursive conversation block (the `structured` tier - see `DialogBlock`). Unlike the flat
 * `replies`/`branches`, a block mirrors the source `if`/`else` nesting: a `line` is an NPC reply line for its
 * scope, a `reply` is a player option/transition row, a `group` is a nested condition shown once at its own
 * level (the reader composes an option's full gate from the groups above it). Opaque side-effect statements
 * are dropped from the tree (surfaced via the node's side-effect badge). Recursive via `group`.
 */
export type ConvBlockItem =
    // `isElse` marks a branch's OPENING line that runs on the negation of its `if` (the else branch), so the
    // tree can label it `[else]` rather than `[if]`; `condition` still carries the full `not (...)` for the tooltip.
    // `branchKey` is the path key of the branch this line/reply belongs to (see stampBranchKeys) - clicking a
    // branch line highlights every row whose branchKey is under (starts with) that key.
    | { kind: "line"; npc: string; npcHasText: boolean; condition?: string; isElse?: boolean; branchKey?: string }
    | { kind: "reply"; reply: ConvReply }
    | { kind: "group"; condition: string; thenBlock: ConvBlock; elseBlock?: ConvBlock };

export type ConvBlock = ConvBlockItem[];

/** One condition-branch of a bundle (if/else) state: its own NPC line and the replies it shows. */
export interface ConvBranch {
    kind: "if" | "else";
    /** Present for an `if` branch; absent for the `else`. */
    condition?: string;
    /** Resolved NPC line shown when this branch is active. */
    npc: string;
    npcHasText: boolean;
    replies: ConvReply[];
    /** Path key identifying this branch, for the tree's branch highlight (see stampBranchKeys). */
    branchKey?: string;
}

export interface ConvState {
    id: string;
    /** Real speaker name (WeiDU D character). Absent for SSL - the row then shows only the (dimmed) id.
        The tree does NOT use the SSL file-name fallback the card/inspector do: down a single-file tree the
        base name repeats on every row (one SSL script is one NPC), so it is redundant noise there. */
    speaker?: string;
    /** Resolved NPC line (the first SAY line of a multisay state). */
    text: string;
    /** The CONTINUATION SAY lines of a WeiDU D multisay state (`SAY @a = @b = @c`), resolved, in source order -
        lines 2..N, since line 1 is `text`. Absent for a single-say state. The tree renders them as a sequence
        after `text` so a monologue is not truncated to its first line (the pre-existing display gap). */
    sayLines?: string[];
    trigger?: string;
    /** Set for a CHAIN/INTERJECT/EXTEND-derived (read-only) state. */
    derivedFrom?: string;
    /** Set for an SSL `approximate` node: its flat render is a lossy simplification (control flow the block
        model can't represent), so the row carries an "approx" warning badge. */
    approximate?: boolean;
    /** Flat replies; empty when `branches` is set (a bundle node groups its replies per branch). */
    replies: ConvReply[];
    /** Set for an SSL if/else bundle node: each branch carries its own NPC line + replies, so the
        tree reflects the branch structure instead of flattening to the if-branch line + all options. */
    branches?: ConvBranch[];
    /** Set for an SSL `structured` node (arbitrarily nested if/else): the recursive block the tree renders
        instead of the flat replies, so each condition shows once at its own nesting level. Read-only. */
    block?: ConvBlock;
    /** True for a state that exists in the webview's optimistic model but is not yet in the source parse (a
        just-added node before the reparse adopts it). The tree/card render it as an unsaved draft. Absent (not
        false) for a committed state. */
    pending?: boolean;
    /** True for a top-level state (no incoming same-file transition). */
    isEntry: boolean;
    /** Whether this state's NPC line can be edited inline in the tree - the same gate the inspector's NPC
        field uses (textEditability over the state's own text): false for a locked SSL @N or a read-only/
        derived node. Mirrors ConvReply.textEditable for the option text. */
    textEditable: boolean;
    /** Byte offset of this state's source (SSL `procRange`, or D `sourceRange`), for "go to source".
        Absent for a synthetic/derived state or a pending new node with no source span. */
    sourceOffset?: number;
}

export interface ConversationTree {
    roots: ConvState[];
}

export type ResolveJump = (label: string) => JumpTarget | undefined;

/**
 * Stamp a branch path key onto every line/reply of a structured node's block, so the tree can highlight a
 * whole branch on click. Rows at the node's top level (not inside any if/else) stay unkeyed. Each group's
 * then/else block gets a distinct key (`<base>#Nif` / `<base>#Nelse`, nested as `...if.Melse`), and rows inherit
 * the key of the innermost branch they sit in. Because a nested branch's key STARTS WITH its parent's, a
 * prefix-match on the clicked key highlights the branch AND everything nested under it. Ids never contain
 * `#`/`.`, so the prefix test cannot cross between sibling branches.
 */
function stampBranchKeys(block: ConvBlock, base: string, branch?: string): void {
    let gi = 0;
    for (const it of block) {
        if (branch) {
            if (it.kind === "line") it.branchKey = branch;
            else if (it.kind === "reply") it.reply.branchKey = branch;
        }
        if (it.kind === "group") {
            const thenKey = branch ? `${branch}.${gi}if` : `${base}#${gi}if`;
            const elseKey = branch ? `${branch}.${gi}else` : `${base}#${gi}else`;
            stampBranchKeys(it.thenBlock, base, thenKey);
            if (it.elseBlock) stampBranchKeys(it.elseBlock, base, elseKey);
            gi++;
        }
    }
}

export function buildConversationTree(
    root: DialogRoot,
    messages: Record<string, string> | undefined,
    resolveJump: ResolveJump,
    // Edit-gating context for each reply's `textEditable`, feeding the same `textEditability` gate the inspector uses.
    // `fieldEditable` is the SAME per-state predicate the inspector and graph use - a `.td` state can be
    // field-editable even though the model's blanket `editable` is false, so consuming it here makes the tree's
    // text lock match the inspector instead of diverging on the model-level flag (the old `editable` boolean).
    // Optional (defaults to an editable file) so the pure-projection tests can stay 3-arg; the editor always
    // passes real values. Destructured with per-key defaults rather than an object-literal default param (which
    // oxlint's no-object-as-default-parameter rightly flags - a shared mutable default).
    // `sourceless` says the FORMAT carries no source spans at all (a compiled DLG). Absence of a span means
    // "the user just added this" only where spans otherwise exist; without this every DLG node reads as an
    // unsaved draft, which is what a live drive showed.
    opts?: { ssl: boolean; fieldEditable: (s: DialogState) => boolean; sourceless?: boolean },
): ConversationTree {
    const { ssl = false, fieldEditable = () => true, sourceless = false } = opts ?? {};
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

    const buildReply = (c: DialogChoice, textRO: boolean, owner: DialogState): ConvReply => ({
        id: c.id,
        text: resolveText(c.text, messages),
        hasText: Boolean(c.text),
        condition: c.condition,
        action: c.action,
        reaction: c.reaction,
        lowIq: c.lowIq,
        textEditable: textEditability({ state: owner, choice: c, messages, ssl, textRO, dlg: sourceless }).editable,
        ...(!sourceless && isUnsavedDraftChoice(c, owner) ? { pending: true } : {}),
        target: buildTarget(c),
        // SSL spans first (callRange/stmtRange/callSite); WeiDU D carries its whole-transition span in
        // `sourceRange` (the SSL fields are absent for D), so F4 resolves on a D option too - parity with the
        // state case below, which already falls back to `sourceRange`.
        sourceOffset:
            c.callRange?.start ?? c.stmtRange?.start ?? c.callSites?.[0]?.stmtRange.start ?? c.sourceRange?.start,
    });

    function expand(id: string): ConvState {
        const s = byId.get(id)!;
        shown.add(id);
        // This state's text-read-only flag, fed to the shared `textEditability` gate. A derived state is fully
        // read-only; the tree ALSO locks a non-field-editable D-family state (view-only D, or an unfaithful TD
        // node). NOTE: the inspector's textRO is only `Boolean(derivedFrom)` - it leaves that unfaithful-TD text
        // editable (a .tra edit is structure-independent). That divergence is intentional-until-decided: whether
        // the D/TD writer actually persists a .tra edit on an unfaithful state is the open question that would
        // settle which view is right (see textEditability's doc). SSL text persists to the .msg, so it stays
        // editable subject to the per-@N resolvability gate inside the shared decision.
        const textRO = Boolean(s.derivedFrom) || (!fieldEditable(s) && !ssl);
        // A bundle (if/else) node groups its replies per branch, each with its own NPC line. Build the
        // branch structure instead of the flat choice list so the tree mirrors the graph/inspector
        // (otherwise the else branch's NPC line and the per-branch grouping are lost). Each choice is
        // expanded exactly once - through the branch path here, never also as a flat reply - so a
        // target is not double-marked "shown".
        // A `structured` node (arbitrarily nested if/else) renders as a recursive block instead: build it from
        // the model's block, resolving each choice reference to a ConvReply. Like the branch path, every choice
        // is expanded exactly once here (source order, depth-first, then before else), never also as a flat
        // reply, so a target is not double-marked "shown".
        let replies: ConvReply[] = [];
        let branches: ConvBranch[] | undefined;
        let block: ConvBlock | undefined;
        if (s.block && s.block.length > 0) {
            const choiceById = new Map(s.choices.map((c) => [c.id, c]));
            const buildBlk = (blk: DialogBlock): ConvBlock =>
                blk.flatMap((it): ConvBlockItem[] => {
                    if (it.kind === "line")
                        return [{ kind: "line", npc: resolveText(it.text, messages), npcHasText: Boolean(it.text) }];
                    if (it.kind === "choice") {
                        const c = choiceById.get(it.choiceId);
                        return c ? [{ kind: "reply", reply: buildReply(c, textRO, s) }] : [];
                    }
                    if (it.kind === "group") {
                        const thenBlock = buildBlk(it.thenBlock);
                        const elseBlock = it.elseBlock ? buildBlk(it.elseBlock) : undefined;
                        // Mark each branch's OPENING NPC line with its gate: the if-branch line reads `[if]`, the
                        // else-branch line reads `[else]` (isElse), both carrying the full condition in the tooltip.
                        if (thenBlock[0]?.kind === "line") thenBlock[0] = { ...thenBlock[0], condition: it.condition };
                        if (elseBlock?.[0]?.kind === "line")
                            elseBlock[0] = { ...elseBlock[0], condition: `not ${it.condition}`, isElse: true };
                        return [
                            { kind: "group", condition: it.condition, thenBlock, ...(elseBlock ? { elseBlock } : {}) },
                        ];
                    }
                    return []; // opaque - not rendered in the tree (surfaced via the side-effect badge)
                });
            block = buildBlk(s.block);
            stampBranchKeys(block, s.id);
        } else if (s.branches && s.branches.length > 0) {
            const choiceById = new Map(s.choices.map((c) => [c.id, c]));
            // An `else` branch runs on the negation of its matching `if` (the immediately preceding branch, per
            // the parser's if-then-else emission order). Carry that inverted condition so the tree renders it as
            // a normal `[if] not(...)` gate instead of a bare, context-free `[else]`. SSL negation is `not (...)`
            // (these branches are SSL-only). The `if` condition is already parenthesized, so `not (X)` is valid.
            branches = s.branches.map((b, i) => {
                const ifCond = b.kind === "else" ? s.branches![i - 1]?.condition : b.condition;
                const branchKey = `${s.id}#branch${i}`;
                return {
                    kind: b.kind,
                    condition: b.kind === "else" && ifCond ? `not ${ifCond}` : b.condition,
                    npc: resolveText(b.replies[0]?.text, messages),
                    npcHasText: Boolean(b.replies[0]?.text),
                    branchKey,
                    replies: b.choiceIds
                        .map((cid) => choiceById.get(cid))
                        .filter((c): c is DialogChoice => c !== undefined)
                        .map((c) => ({ ...buildReply(c, textRO, s), branchKey })),
                };
            });
        } else {
            replies = s.choices.map((c) => buildReply(c, textRO, s));
        }
        return {
            id: s.id,
            speaker: s.speaker,
            text: resolveText(s.text, messages),
            // A multisay state carries every SAY alternate in `sayTexts` (line 0 == `text`); surface lines 2..N
            // as resolved continuation lines so the tree shows the whole monologue, not just the first line.
            ...(s.sayTexts && s.sayTexts.length > 1
                ? { sayLines: s.sayTexts.slice(1).map((t) => resolveText(t, messages)) }
                : {}),
            trigger: s.trigger,
            derivedFrom: s.derivedFrom,
            ...(s.approximate ? { approximate: true } : {}),
            replies,
            ...(branches ? { branches } : {}),
            ...(block ? { block } : {}),
            isEntry: !targeted.has(s.id),
            ...(!sourceless && isUnsavedDraftState(s) ? { pending: true } : {}),
            textEditable: textEditability({ state: s, choice: null, messages, ssl, textRO, dlg: sourceless }).editable,
            sourceOffset: s.procRange?.start ?? s.sourceRange?.start,
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

/**
 * The child ConvStates a node expands into - its replies' first-expansion `state` targets - across ALL reply
 * shapes: flat replies, per-branch replies, and structured-block replies. A node populates exactly one of
 * `replies`/`branches`/`block`, so this yields that one source's targets in render order (branch/flat, then
 * block). The single traversal every tree walk shares (reveal-ancestors, collapse-all, find-in-tree) so none of
 * them silently omits a branch or block node's children - the divergence that let those walks miss structured
 * SSL nodes when each hand-rolled its own child collection.
 */
export function childStates(s: ConvState): ConvState[] {
    const kids: ConvState[] = [];
    if (s.branches)
        for (const b of s.branches) for (const r of b.replies) if (r.target.kind === "state") kids.push(r.target.node);
    for (const r of s.replies) if (r.target.kind === "state") kids.push(r.target.node);
    if (s.block) collectBlockTargets(s.block, kids);
    return kids;
}

/** Child states reached by a structured node's block replies, in block order (a helper for `childStates`). */
function collectBlockTargets(block: ConvBlock, out: ConvState[]): void {
    for (const item of block) {
        if (item.kind === "reply") {
            if (item.reply.target.kind === "state") out.push(item.reply.target.node);
        } else if (item.kind === "group") {
            collectBlockTargets(item.thenBlock, out);
            if (item.elseBlock) collectBlockTargets(item.elseBlock, out);
        }
    }
}
