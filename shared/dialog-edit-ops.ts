/**
 * Pure model-transform operations behind the dialog editor's edit actions.
 *
 * Kept out of the Svelte component so they can be unit-tested in isolation and
 * reused by a host save path. Each operates on a DialogModel (mutating in place -
 * the editor passes its reactive working copy) and returns whatever the caller
 * needs to update selection/layout. None of them touch a state's `sourceRange`
 * except where correctness demands it (see `duplicateState`).
 */

import {
    type DialogBranch,
    type DialogChoice,
    type DialogModel,
    type DialogReaction,
    type DialogRoot,
    type DialogState,
    type DialogTarget,
    renderFamily,
    rewriteSameFileExternRef,
} from "./dialog-model";
import { allChoices, allStates } from "./dialog-edit-common";

/** Every state id across the model - a thin projection over the shared `allStates` flatten. */
function stateIdsOf(model: DialogModel): string[] {
    return allStates(model).map((s) => s.id);
}

function rootOf(model: DialogModel, state: DialogState): DialogModel["roots"][number] | undefined {
    return model.roots.find((r) => r.states.includes(state));
}

/**
 * Copy-on-write a shared message ref: if `text` is ENTIRELY a bare `@N` whose `.msg`/`.tra` string is loaded,
 * return that literal (so a save mints the copy its own id); otherwise return `text` unchanged (a literal, a
 * computed/embedded ref, or an unresolved `@N` with no loaded string to detach). Whole-text only - an embedded
 * `@N` inside a literal is left alone. Used by `duplicateState` so a copy never aliases the source's string.
 */
function detachRef(text: string | undefined, messages: DialogModel["messages"]): string | undefined {
    const t = (text ?? "").trim();
    const m = /^@(\d+)$/.exec(t);
    const resolved = m ? messages?.[m[1]!] : undefined;
    // Preserve `undefined` (a textless "continue" option) rather than coercing it to "".
    return resolved ?? text;
}

function uniqueId(taken: Set<string>, base: string): string {
    if (!taken.has(base)) return base;
    let i = 1;
    while (taken.has(`${base}_${i}`)) i++;
    return `${base}_${i}`;
}

/** Every choice id across the model - a thin projection over the shared `allChoices` flatten. */
function allChoiceIds(model: DialogModel): Set<string> {
    return new Set(allChoices(model).map((c) => c.id));
}

/**
 * How many transitions point at `state` via GOTO. `deleteState` silently redirects all of them to EXIT (a
 * dangling GOTO would fail to compile), so the editor warns before deleting when this is non-zero - the redirect
 * is the surprising side-effect a modder hit. Counts only same-dialogue GOTOs (see `retargetReferences`).
 */
export function countInboundGotos(model: DialogModel, state: DialogState): number {
    const root = rootOf(model, state);
    if (!root) return 0;
    let n = 0;
    retargetReferences(root, state.id, () => n++);
    return n;
}

/**
 * Apply to every transition whose GOTO target is `oldId`, among states in `root` only. A GOTO (`state` target)
 * resolves WITHIN one dialogue (BEGIN block / resref = one root), so a same-named state in another dialogue of the
 * same .d file is NOT a reference to this one - scoping to `root` avoids corrupting that unrelated state's GOTOs.
 * For SSL (a single "dialog" root) this is the whole model. Cross-dialogue EXTERN/COPY_TRANS refs are `external`
 * targets, handled separately in `renameState`.
 */
function retargetReferences(root: DialogRoot, oldId: string, apply: (c: DialogChoice) => void): void {
    for (const s of root.states) {
        for (const c of s.choices) {
            if (c.target.kind === "state" && c.target.stateId === oldId) apply(c);
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
    const root = rootOf(model, state);
    // Uniqueness is per-dialogue (per root): one .d file may define a state label once in each of several
    // dialogues, so only a collision WITHIN this state's own dialogue is a real conflict. SSL has a single
    // "dialog" root, so this stays file-wide there. (A state not in any root has no siblings to collide with.)
    const siblings = new Set((root?.states ?? []).map((s) => s.id));
    siblings.delete(state.id);
    if (siblings.has(trimmed)) return false;
    // Move GOTO references within the SAME dialogue only (a GOTO resolves per-dialogue); if the state is somehow
    // not in any root, there are no in-model references to move.
    if (root) {
        retargetReferences(root, state.id, (c) => {
            c.target = { kind: "state", stateId: trimmed };
        });
    }
    // WeiDU D only: a state can also be reached from ANOTHER dialogue in the SAME .d file via
    // `EXTERN ~thisResref~ <id>`, stored as an opaque `external` target (retargetReferences only moves GOTO
    // "state" targets, and only within this state's own dialogue). Rewrite its state part too, or the
    // cross-dialogue reference dangles at the old id on save. This scan spans ALL roots (the reference lives in a
    // different dialogue) but matches on the referenced file, so only same-file refs are touched. The "file:state"
    // encoding is D-specific (targetFromD), so this is gated to weidu-d; a genuinely cross-FILE EXTERN is
    // inherently unresolvable by a single-file editor and is left untouched.
    if (renderFamily(model.sourceLang) === "weidu-d" && root !== undefined) {
        const file = root.label;
        for (const r of model.roots)
            for (const s of r.states)
                for (const c of s.choices) {
                    if (c.target.kind !== "external") continue;
                    const rewritten = rewriteSameFileExternRef(c.target.label, file, state.id, trimmed);
                    if (rewritten !== null) c.target = { ...c.target, label: rewritten };
                }
    }
    // Keep the denormalized entry arrays (keyed by state id) in sync with the rename, so the id-keyed UI
    // predicates that read them - eligibleToDelete, findCallers - resolve the RENAMED node correctly (a stale
    // entryIds would let a still-referenced external-entry node report as safe to delete). The writer rewrites
    // references on the ORIGINAL model via renamedFrom, so only the edited model's copies move; outOfBandCalls
    // is writer/original-only (no UI consumer reads it) and its targetRange is original-source-relative, so it
    // is intentionally left untouched here.
    const oldId = state.id;
    if (model.entryIds) model.entryIds = model.entryIds.map((id) => (id === oldId ? trimmed : id));
    if (model.entryCalls)
        model.entryCalls = model.entryCalls.map((ec) => (ec.name === oldId ? { ...ec, name: trimmed } : ec));
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
    const root = rootOf(model, state);
    if (!root) return; // not in the model - nothing to delete or redirect
    // Redirect inbound GOTOs within the SAME dialogue only (a GOTO resolves per-dialogue); a same-named state in
    // another dialogue keeps its own inbound GOTOs.
    retargetReferences(root, state.id, (c) => {
        c.target = { kind: "exit" };
    });
    root.states = root.states.filter((s) => s !== state);
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
    const ssl = renderFamily(model.sourceLang) === "fallout-ssl";
    copy.id = ssl ? nextSslNodeId(model) : nextDStateId(model);
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
    // Strip the bundle/structured tier: a pending-new node always serializes FLAT (serializeSSLProcedure /
    // serializeTSSLProcedure ignore branches), so a retained `branches`/`block` would (a) keep `choiceIds`
    // pointing at the ORIGINAL choice ids the renumber below invalidates - an empty branch view - and (b) show
    // an if/else structure that the saved file drops. The copy is a flat node carrying every option instead.
    delete copy.branches;
    delete copy.block;
    delete copy.bundleFaithful;
    // Copy-on-write the shared `.msg`/`.tra` strings: a source-backed line is stored as a bare `@N` ref, and a
    // naive clone leaves the copy pointing at the SAME entry - so editing the copy's line (writeText -> the
    // shared id) silently rewrites the ORIGINAL's line too. Detaching each resolvable ref to its literal makes
    // the copy a new-node literal that the save allocator (allocateNodeIds / allocateDFamilyIds) mints a FRESH
    // id for, so the copy owns an independent string. An UNRESOLVED ref (its .msg never loaded) has nothing to
    // detach and stays a ref - harmless, since editing an unresolved line is already locked. Skips computed/
    // random text (no plain `@N` to detach). Applies to both families (SSL and D both store shared refs as @N).
    if (!copy.textKind) copy.text = detachRef(copy.text, model.messages) ?? copy.text;
    copy.choices = copy.choices.map((c, i) => ({
        ...c,
        id: `${copy.id}#${i}`,
        ...(c.textKind ? {} : { text: detachRef(c.text, model.messages) }),
    }));
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
    // Union the projected node ids with EVERY existing procedure name (existingProcNames): an empty or
    // side-effect-only `NodeNNN` proc is a real name to dodge even though the model does not carry it as a node,
    // or a new node would collide and the splice/scaffold would emit a duplicate `procedure`.
    const nums = [...stateIdsOf(model), ...(model.existingProcNames ?? [])]
        .map((id) => /^Node(\d+)$/.exec(id)?.[1])
        .filter((m): m is string => m !== undefined && m !== null)
        .map((m) => Number.parseInt(m, 10))
        .filter((n) => !RESERVED_SSL_NODE_NUMS.has(n));
    let next = (nums.length > 0 ? Math.max(...nums) : 0) + 1;
    while (RESERVED_SSL_NODE_NUMS.has(next)) next++;
    return `Node${String(next).padStart(3, "0")}`;
}

/**
 * Next free `StateNNN` id for a D model: the smallest number above every existing `StateNNN` state, zero-padded
 * to 3 digits. The D analog of the SSL `nextSslNodeId` scheme - D state labels are a single namespace with no
 * reserved sinks and no separate procedure names, so both of those exclusions drop out here.
 */
function nextDStateId(model: DialogModel): string {
    const nums = stateIdsOf(model)
        .map((id) => /^State(\d+)$/.exec(id)?.[1])
        .filter((m): m is string => m !== undefined && m !== null)
        .map((m) => Number.parseInt(m, 10));
    const next = (nums.length > 0 ? Math.max(...nums) : 0) + 1;
    return `State${String(next).padStart(3, "0")}`;
}

/** Resolve the root a new state would be added to: the caller's chosen root (active tab), else the first
 *  dialog root, else the first root. Undefined on a blank file (bootstrap - no roots yet). */
function resolveTargetRoot(model: DialogModel, targetRoot?: DialogRoot): DialogRoot | undefined {
    return targetRoot ?? model.roots.find((r) => r.kind === "dialog") ?? model.roots[0];
}

/**
 * The id `addState` would auto-assign for a new node. Offered as the pre-filled suggestion when the editor
 * prompts for a manual node name (the "Auto node names" toggle is off). Pure: does not mutate the model.
 */
export function suggestStateId(model: DialogModel): string {
    return renderFamily(model.sourceLang) === "fallout-ssl" ? nextSslNodeId(model) : nextDStateId(model);
}

/**
 * Validate a user-entered name for a NEW node, returning a human-readable reason it is rejected, or null when
 * acceptable. Backs the manual-name prompt. Rules: non-empty; unique within the target dialogue (and, for SSL,
 * not colliding with an existing procedure name or a reserved sink); for SSL also a valid procedure identifier
 * (letters/digits/underscore, not starting with a digit) since the name becomes a `procedure <name>` token on
 * save. Uniqueness is per-dialogue for the same reason `renameState` scopes it there (see that function).
 */
export function newStateIdError(model: DialogModel, id: string, targetRoot?: DialogRoot): string | null {
    const trimmed = id.trim();
    if (!trimmed) return "Enter a node name.";
    const ssl = renderFamily(model.sourceLang) === "fallout-ssl";
    if (ssl) {
        if (!/^[A-Za-z_]\w*$/.test(trimmed))
            return "SSL node names must be a procedure identifier: letters, digits, and underscores, not starting with a digit.";
        const num = /^Node(\d+)$/.exec(trimmed)?.[1];
        if (num !== undefined && RESERVED_SSL_NODE_NUMS.has(Number.parseInt(num, 10)))
            return `Node${num} is reserved (998 = combat, 999 = end dialog).`;
    }
    const root = resolveTargetRoot(model, targetRoot);
    const taken = new Set<string>([
        ...(root?.states ?? []).map((s) => s.id),
        ...(ssl ? (model.existingProcNames ?? []) : []),
    ]);
    if (taken.has(trimmed)) return `"${trimmed}" is already used in this dialogue.`;
    return null;
}

/**
 * Add an empty new state to the first dialog root (no sourceRange: a pending insert). `id`, when given, is the
 * caller's chosen (already-validated via `newStateIdError`) node name - the "Auto node names" toggle off path;
 * omitted, the id is auto-assigned via `suggestStateId`.
 *
 * Bootstrap: a dialog started from scratch (an SSL file with no `talk_p_proc`, a D file with no dialog
 * block) parses to zero roots, so there is no root to add the first node to. Rather than refuse - the old
 * `return null` left the `+ State` button a silent no-op on a blank file - mint the dialog root here and let
 * the write-back paths scaffold the source skeleton on save (SSL: a `talk_p_proc` router plus Node998/Node999
 * support nodes via applySSLDialogEdits; D: a `BEGIN` block via applyDDialogEdits). The root label seeds the D
 * `BEGIN` resref; "dialog" mirrors the SSL adapter's own single-root label (dialog-model.ts).
 */
export function addState(model: DialogModel, targetRoot?: DialogRoot, id?: string): DialogState {
    // Add to the caller's chosen root (the active tab) when given; else the first dialog.
    const root = resolveTargetRoot(model, targetRoot);
    const bootstrap = !root;
    const stateId = id ?? suggestStateId(model);
    const state: DialogState = { id: stateId, text: "", choices: [] };
    // On SSL bootstrap the first node IS the conversation entry: the scaffolded talk_p_proc must `call` it or
    // the dialog is unreachable. Flag it so applySSLDialogEdits wires the router; the parser re-derives isEntry
    // from that written call on the next reparse, after which this transient flag no longer matters.
    if (bootstrap && renderFamily(model.sourceLang) === "fallout-ssl") state.isEntry = true;
    if (root) {
        root.states.push(state);
    } else {
        // Bootstrap: mint the root already containing the state and push it in ONE mutation. Pushing an empty
        // root and then pushing the state into it separately fails on a reactive host (Svelte $state): the first
        // push recomputes the view with zero states, and the second push - into the pre-proxy `root` reference -
        // bypasses the proxy, so the view never re-renders with the node. A single fully-formed push is observed.
        model.roots.push({ id: "dialog", label: model.sourceName ?? "dialog", kind: "dialog", states: [state] });
    }
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
