/**
 * Pure model-transform operations behind the dialog editor's edit actions.
 *
 * Kept out of the Svelte component so they can be unit-tested in isolation and
 * reused by a host save path. Each operates on a DialogModel (mutating in place -
 * the editor passes its reactive working copy) and returns whatever the caller
 * needs to update selection/layout. None of them touch a state's `sourceRange`
 * except where correctness demands it (see `duplicateState`).
 */

import type {
    DialogBranch,
    DialogChoice,
    DialogModel,
    DialogReaction,
    DialogRoot,
    DialogState,
    DialogTarget,
} from "./dialog-model";

export function stateIdsOf(model: DialogModel): string[] {
    return model.roots.flatMap((r) => r.states.map((s) => s.id));
}

/**
 * Reconcile pending items the host just committed to the source, in place on the webview's working copy.
 *
 * After a structural self-edit the host splices new options/nodes and allocates their `@N` ids, but the
 * webview copy still holds them as PENDING (literal text, no source span) because the echo guard suppresses
 * the re-project that would give them a real span - it must, to keep the user's selection and in-progress
 * text. Left stale, the NEXT save re-splices them: the re-parse cannot match a pending choice (id
 * `Node#reply`) to the option it already became (id `Node#optN`), so it re-adds it and duplicates the option.
 *
 * This stamps each committed item's allocated `@N` text and marks it `committed` (so the splicer treats it as
 * existing, not new) and merges the allocated `.msg` text into `model.messages` (so the field resolves and
 * stays editable instead of showing a raw `@N`). It mutates in place and touches nothing else, so selection,
 * node positions, and any text the user is still typing survive. `allocations` maps an item id (option choice
 * id or new-node state id) to its `@N` text; `messages` is the id->text to merge.
 */
export function applyReconcile(
    model: DialogModel,
    allocations: Record<string, string>,
    messages: Record<string, string> | undefined,
): void {
    if (messages && Object.keys(messages).length > 0) {
        model.messages = { ...model.messages, ...messages };
    }
    if (Object.keys(allocations).length === 0) return;
    for (const root of model.roots) {
        for (const state of root.states) {
            const sAlloc = allocations[state.id];
            if (sAlloc !== undefined) {
                state.text = sAlloc;
                state.committed = true;
            }
            for (const c of state.choices) {
                const cAlloc = allocations[c.id];
                if (cAlloc !== undefined) {
                    c.text = cAlloc;
                    c.committed = true;
                }
            }
        }
    }
}

function rootOf(model: DialogModel, state: DialogState): DialogModel["roots"][number] | undefined {
    return model.roots.find((r) => r.states.includes(state));
}

function uniqueId(taken: Set<string>, base: string): string {
    if (!taken.has(base)) return base;
    let i = 1;
    while (taken.has(`${base}_${i}`)) i++;
    return `${base}_${i}`;
}

export function uniqueStateId(model: DialogModel, base: string): string {
    return uniqueId(new Set(stateIdsOf(model)), base);
}

function allChoiceIds(model: DialogModel): Set<string> {
    const ids = new Set<string>();
    for (const r of model.roots) for (const s of r.states) for (const c of s.choices) ids.add(c.id);
    return ids;
}

/**
 * How many transitions across the model point at `stateId` via GOTO. `deleteState` silently
 * redirects all of them to EXIT (a dangling GOTO would fail to compile), so the editor warns
 * before deleting when this is non-zero - the redirect is the surprising side-effect a modder hit.
 */
export function countInboundGotos(model: DialogModel, stateId: string): number {
    let n = 0;
    retargetReferences(model, stateId, () => n++);
    return n;
}

/** Apply to every transition whose GOTO target is `oldId`, across all states. */
function retargetReferences(model: DialogModel, oldId: string, apply: (c: DialogChoice) => void): void {
    for (const r of model.roots) {
        for (const s of r.states) {
            for (const c of s.choices) {
                if (c.target.kind === "state" && c.target.stateId === oldId) apply(c);
            }
        }
    }
}

/**
 * Rename a state's label and move every GOTO reference with it (the label IS the
 * jump target). Returns false (no change) if the new id is empty, unchanged, or
 * already in use.
 */
export function renameState(model: DialogModel, state: DialogState, newId: string): boolean {
    const trimmed = newId.trim();
    if (!trimmed || trimmed === state.id) return false;
    const taken = new Set(stateIdsOf(model));
    taken.delete(state.id);
    if (taken.has(trimmed)) return false;
    retargetReferences(model, state.id, (c) => {
        c.target = { kind: "state", stateId: trimmed };
    });
    // Tag a source-backed node (has nameRange) with its ORIGINAL id so the SSL splicer can rewrite the
    // procedure name token + references it keys on. The `=== undefined` guard means a second rename keeps
    // the original source id, not an intermediate one.
    if (state.nameRange && state.renamedFrom === undefined) state.renamedFrom = state.id;
    state.id = trimmed;
    return true;
}

/**
 * Remove a state. Inbound GOTO references are redirected to EXIT so the saved .d
 * has no dangling target (a dangling GOTO is a WeiDU compile error).
 */
export function deleteState(model: DialogModel, state: DialogState): void {
    retargetReferences(model, state.id, (c) => {
        c.target = { kind: "exit" };
    });
    const root = rootOf(model, state);
    if (root) root.states = root.states.filter((s) => s !== state);
}

/**
 * Duplicate a state as a brand-new state with a fresh, unique id. Crucially the
 * copy carries NO `sourceRange`: it has no original byte span, and inheriting the
 * source's range would make the surgical save splice the copy over the original's
 * bytes. Returns the copy (a new state, so it is a pending insert for save).
 */
export function duplicateState(model: DialogModel, state: DialogState): DialogState | null {
    const root = rootOf(model, state);
    if (!root) return null;
    // Deep-clone via JSON, not structuredClone: in the webview `state` is a Svelte $state
    // proxy (a nested member of the reactive model), and structuredClone throws
    // DataCloneError on a proxy. $state.snapshot would unwrap it but is a rune unavailable in
    // this plain .ts module (shared by the webview and server-side tests). A JSON round-trip
    // reads cleanly through proxy traps and is faithful for plain DialogState data.
    // oxlint-disable-next-line unicorn/prefer-structured-clone -- structuredClone throws DataCloneError on the $state proxy; that is the bug being fixed.
    const copy = JSON.parse(JSON.stringify(state)) as DialogState;
    const ssl = model.format === "fallout-ssl";
    copy.id = ssl ? nextSslNodeId(model) : uniqueStateId(model, `${state.id}_copy`);
    // Strip every source-span marker so the copy is a PENDING-NEW node, spliced in fresh rather than over
    // the original's bytes. D keys "pending" on the absent sourceRange; SSL on the absent procRange (the
    // other SSL markers would be stale for a node that isn't in the source yet). The @N text refs on the
    // state and its choices are intentionally KEPT - the copy shares the original's .msg/.tra strings, the
    // same way D's duplicate shares them (no new id is allocated at save).
    delete copy.sourceRange;
    delete copy.procRange;
    delete copy.nameRange;
    delete copy.forwardDeclRange;
    delete copy.insertAnchor;
    // A copy is an orphan to wire deliberately, not a silent second conversation entry: don't inherit the
    // source's entry status (which would auto-splice a `call <copy>;` into talk_p_proc on save). The parser
    // keeps unreachable dialog nodes visible, so the un-wired copy still shows in the graph.
    delete copy.isEntry;
    copy.choices = copy.choices.map((c, i) => ({ ...c, id: `${copy.id}#${i}` }));
    root.states.push(copy);
    return copy;
}

/** Node numbers reserved for the SSL dialog sinks: 999 (end-dialog) and 998 (combat/hostile). Never
 * hand these out to a new node, and never count them toward the next-free id. */
const RESERVED_SSL_NODE_NUMS = new Set([998, 999]);

/**
 * Next free `NodeNNN` id for an SSL model: the smallest number above every real (non-reserved) node,
 * zero-padded to 3 digits. The reserved sink range is excluded both from the max AND as an allocation
 * target, so a dialog that defines `Node999` no longer pushes new ids straight to `Node1000`.
 */
function nextSslNodeId(model: DialogModel): string {
    const nums = stateIdsOf(model)
        .map((id) => /^Node(\d+)$/.exec(id)?.[1])
        .filter((m): m is string => m !== undefined && m !== null)
        .map((m) => Number.parseInt(m, 10))
        .filter((n) => !RESERVED_SSL_NODE_NUMS.has(n));
    let next = (nums.length > 0 ? Math.max(...nums) : 0) + 1;
    while (RESERVED_SSL_NODE_NUMS.has(next)) next++;
    return `Node${String(next).padStart(3, "0")}`;
}

/** Add an empty new state to the first dialog root (no sourceRange: a pending insert). */
export function addState(model: DialogModel, targetRoot?: DialogRoot): DialogState | null {
    // Add to the caller's chosen root (the active tab) when given; else the first dialog.
    const root = targetRoot ?? model.roots.find((r) => r.kind === "dialog") ?? model.roots[0];
    if (!root) return null;
    const id = model.format === "fallout-ssl" ? nextSslNodeId(model) : uniqueStateId(model, "new_state");
    const state: DialogState = { id, text: "", choices: [] };
    root.states.push(state);
    return state;
}

/** Append an empty transition to a state (defaults to EXIT). */
export function addReply(model: DialogModel, state: DialogState): DialogChoice {
    const choice: DialogChoice = {
        id: uniqueId(allChoiceIds(model), `${state.id}#reply`),
        text: "",
        target: { kind: "exit" },
    };
    state.choices.push(choice);
    return choice;
}

export function removeReply(state: DialogState, choiceId: string): void {
    state.choices = state.choices.filter((c) => c.id !== choiceId);
}

/** Move a transition up (-1) or down (+1) within its state; transition order is significant in WeiDU. */
export function moveReply(state: DialogState, choiceId: string, dir: -1 | 1): void {
    const i = state.choices.findIndex((c) => c.id === choiceId);
    const j = i + dir;
    if (i === -1 || j < 0 || j >= state.choices.length) return;
    const cs = state.choices;
    [cs[i], cs[j]] = [cs[j]!, cs[i]!];
}

export function setChoiceTarget(state: DialogState, choiceId: string, target: DialogTarget): void {
    const c = state.choices.find((ch) => ch.id === choiceId);
    if (c) c.target = target;
}

/** SSL only: change an option's reaction (N/G/B) in place. The SSL splicer (dialog-ssl-edit.ts) picks
 * this up as a macro-name rewrite on save. */
export function setChoiceReaction(state: DialogState, choiceId: string, reaction: DialogReaction): void {
    const c = state.choices.find((ch) => ch.id === choiceId);
    if (c) c.reaction = reaction;
}

/** SSL only: toggle an option's low-INT variant (`*LowOption`) in place. Stored as `true`/`undefined`
 * (never a literal `false`), matching the SSL adapter's own convention for this field (see
 * `stateFromSSL` in dialog-model.ts) so an unset/off option looks identical either way. */
export function setChoiceLowIq(state: DialogState, choiceId: string, lowIq: boolean): void {
    const c = state.choices.find((ch) => ch.id === choiceId);
    if (c) c.lowIq = lowIq || undefined;
}

/**
 * Add a new empty reply inside a specific branch of a bundle node. The new choice
 * is appended to `state.choices` and its id is appended to `branch.choiceIds`. When
 * the branch carries a condition the choice inherits it (matching how parsed bundle
 * options carry their enclosing `if` condition), so the save path can associate the
 * choice with the right branch without needing to inspect choiceIds at that point.
 */
export function addReplyToBranch(model: DialogModel, state: DialogState, branch: DialogBranch): DialogChoice {
    const choice: DialogChoice = {
        id: uniqueId(allChoiceIds(model), `${state.id}#reply`),
        text: "",
        target: { kind: "exit" },
    };
    if (branch.condition !== undefined) choice.condition = branch.condition;
    state.choices.push(choice);
    branch.choiceIds.push(choice.id);
    return choice;
}

/** Remove a reply from both `state.choices` and `branch.choiceIds`. */
export function removeReplyFromBranch(state: DialogState, branch: DialogBranch, choiceId: string): void {
    state.choices = state.choices.filter((c) => c.id !== choiceId);
    branch.choiceIds = branch.choiceIds.filter((id) => id !== choiceId);
}

/**
 * Append a pending-new `kind:"if"` branch to a bundle state. No span fields are set
 * (stmtRange/elseClauseRange/thenBlockEnd/insertAnchor/conditionRange all absent),
 * which signals to the save path that this branch is new and must be emitted from
 * scratch rather than spliced over an existing byte range.
 */
export function addBranch(state: DialogState, condition: string): DialogBranch {
    if (!state.branches) state.branches = [];
    const branch: DialogBranch = {
        kind: "if",
        condition,
        replies: [],
        choiceIds: [],
        opaque: [],
    };
    state.branches.push(branch);
    return branch;
}

/**
 * Append a pending-new `kind:"else"` branch only when the state has exactly one
 * `kind:"if"` branch and no existing `else`. Returns the new branch, or null if the
 * precondition is not met (already has an else, multiple branches, or no branches).
 */
export function addElse(state: DialogState): DialogBranch | null {
    if (!state.branches || state.branches.length !== 1 || state.branches[0]!.kind !== "if") return null;
    const branch: DialogBranch = {
        kind: "else",
        replies: [],
        choiceIds: [],
        opaque: [],
    };
    state.branches.push(branch);
    return branch;
}

/**
 * Remove `state.branches[branchIndex]` and purge that branch's options from
 * `state.choices` (by matching ids in `branch.choiceIds`).
 */
export function removeBranch(state: DialogState, branchIndex: number): void {
    if (!state.branches) return;
    const branch = state.branches[branchIndex];
    if (!branch) return;
    const removed = new Set(branch.choiceIds);
    state.branches.splice(branchIndex, 1);
    state.choices = state.choices.filter((c) => !removed.has(c.id));
}

/**
 * Move a reply up (-1) or down (+1) within its branch. The bound is branch-relative:
 * a no-op at the branch's first or last position, so the move cannot cross into an
 * adjacent branch. After swapping in `branch.choiceIds` the same relative order is
 * mirrored into `state.choices` for this branch's members so the flat list stays
 * consistent with the branch-level ordering.
 */
export function moveReplyInBranch(state: DialogState, branch: DialogBranch, choiceId: string, dir: -1 | 1): void {
    const bi = branch.choiceIds.indexOf(choiceId);
    const bj = bi + dir;
    if (bi === -1 || bj < 0 || bj >= branch.choiceIds.length) return;
    // Swap within the branch's own id list.
    [branch.choiceIds[bi], branch.choiceIds[bj]] = [branch.choiceIds[bj]!, branch.choiceIds[bi]!];
    // Mirror the new branch order into the flat choices array. The branch members occupy
    // certain flat slots in state.choices; collect those slots, then fill them in the
    // branch's new order. Capture the mapping before any mutation.
    const byId = new Map(state.choices.map((c) => [c.id, c]));
    const branchSet = new Set(branch.choiceIds);
    const flatSlots: number[] = [];
    for (let i = 0; i < state.choices.length; i++) {
        if (branchSet.has(state.choices[i]!.id)) flatSlots.push(i);
    }
    for (let k = 0; k < flatSlots.length; k++) {
        state.choices[flatSlots[k]!] = byId.get(branch.choiceIds[k]!)!;
    }
}
