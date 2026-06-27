/**
 * Pure model-transform operations behind the dialog editor's edit actions.
 *
 * Kept out of the Svelte component so they can be unit-tested in isolation and
 * reused by a host save path. Each operates on a DialogModel (mutating in place -
 * the editor passes its reactive working copy) and returns whatever the caller
 * needs to update selection/layout. None of them touch a state's `sourceRange`
 * except where correctness demands it (see `duplicateState`).
 */

import type { DialogChoice, DialogModel, DialogRoot, DialogState, DialogTarget } from "./dialog-model";

export function stateIdsOf(model: DialogModel): string[] {
    return model.roots.flatMap((r) => r.states.map((s) => s.id));
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
    copy.id = uniqueStateId(model, `${state.id}_copy`);
    delete copy.sourceRange;
    copy.choices = copy.choices.map((c, i) => ({ ...c, id: `${copy.id}#${i}` }));
    root.states.push(copy);
    return copy;
}

/** Next free `NodeNNN` id for an SSL model: max existing Node<number> + 1, zero-padded to 3 digits. */
function nextSslNodeId(model: DialogModel): string {
    const nums = stateIdsOf(model)
        .map((id) => /^Node(\d+)$/.exec(id)?.[1])
        .filter((m): m is string => m !== undefined && m !== null)
        .map((m) => Number.parseInt(m, 10));
    const next = (nums.length > 0 ? Math.max(...nums) : 0) + 1;
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
