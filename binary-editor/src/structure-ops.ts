import { formatAdapterRegistry, parserRegistry, type ParseResult } from "@bgforge/binary";
import { assertNotLocked, buildModel, type FlatNode } from "./model";
import { invalidateCachedDocument } from "./edit";
import { DEFAULT_WINDOW, getWindow } from "./window";
import { resolveTabCounts } from "./layout";
import { layoutFieldRows, type EditorSession } from "./session";
import type { ChangeSet, NamePath, NodeId, StructureResult } from "./types";

/**
 * Structure ops address their target by stable NodeId, never by display label.
 * `add` targets the section group (sectionId); the other ops target a concrete
 * entry (entryId). The editor resolves each NodeId to the section's structural
 * path plus the entry's 0-based ordinal among its siblings before calling the
 * byte-builders - so a presentation relabel / i18n / override cannot misaddress
 * a byte op.
 */
export type StructureOpRequest =
    | { op: "add"; sectionId: NodeId }
    | { op: "insert"; entryId: NodeId; position: "before" | "after" }
    | { op: "remove"; entryId: NodeId }
    | { op: "reorder"; entryId: NodeId; direction: "up" | "down" }
    | { op: "duplicate"; entryId: NodeId }
    // Owner-scoped child add: add a default entry to the `childSection` collection owned by the entry
    // `entryId` (e.g. add an effect to a specific ITM/SPL ability). Targets the parent entry, not a section.
    | { op: "addChild"; entryId: NodeId; childSection: string }
    // Owner-scoped child remove: drop the entry at `childIndex` from the `childSection` collection owned by
    // `entryId` (e.g. remove a MAP object's inventory entry). childIndex is the 0-based position among the
    // owner's child entries, supplied by the UI that lists them - not a flat-section ordinal.
    | { op: "removeChild"; entryId: NodeId; childSection: string; childIndex: number };

export function reparse(session: EditorSession, bytes: Uint8Array): ParseResult {
    const parser = parserRegistry.getById(session.parserId);
    if (!parser) throw new Error(`Unknown parser ${session.parserId}`);
    return parser.parse(bytes, session.parseOptions);
}

function buildChangeSet(session: EditorSession, dirty: boolean): ChangeSet {
    // A structure op rebuilds the whole model, so any layout/form field whose presentation derives from
    // another record goes stale in the webview's resolved-field snapshot - the CRE item-slot item dropdowns
    // and the selected-weapon dropdown read the Items list, and a reorder/remove/add changes both their
    // options and (via relink) their values. layoutFieldRows re-projects every layout field so the webview
    // patches them by id (form-field node ids are stable across list add/remove/move); the same helper backs
    // editField, so the two refresh paths cannot drift. The tree window covers the list/tree blocks.
    return {
        changed: [
            ...getWindow(session.model, 0, DEFAULT_WINDOW, session.relationshipModel),
            ...layoutFieldRows(session),
        ],
        diagnostics: session.relationshipModel ? session.relationshipModel.constraints(session.model) : [],
        dirty,
        formatValid: true,
        // A structure op can change an entry count; refresh the tab badges so e.g. the Spells known/memorized
        // total stays current (the subtab badges refresh separately via the spellbook re-fetch).
        tabCounts: resolveTabCounts(session.parserId, session.model),
    };
}

// Stores `before` by reference (no clone): safe because structureOp always replaces
// session.model via buildModel(next), and editField always clones before mutating,
// so no undo snapshot is ever mutated in place.
function commit(session: EditorSession, label: string, next: ParseResult): StructureResult {
    return commitModel(session, label, buildModel(next));
}

/**
 * Commit an ALREADY-BUILT model (one undo entry). Used by compound ops that must mutate the rebuilt model's
 * fields before commit - e.g. the spellbook "memorize"/"add known" ops add an entry, preset its fields, then
 * commit the result atomically. Selection is left unset; callers assign the post-op selection.
 */
export function commitModel(session: EditorSession, label: string, model: EditorSession["model"]): StructureResult {
    session.undo.push({ label, before: session.model.parseResult });
    session.redo = [];
    session.model = model;
    invalidateCachedDocument(session.model.parseResult);
    session.dirty = true;
    return { changeSet: buildChangeSet(session, true) };
}

function buildOpBytes(
    adapter: ReturnType<typeof formatAdapterRegistry.get>,
    pr: ParseResult,
    req: StructureOpRequest,
    target: ResolvedTarget,
): Uint8Array | undefined {
    const { arrayPath, index } = target;
    switch (req.op) {
        case "add":
            return adapter?.buildAddEntryBytes?.(pr, arrayPath);
        case "insert":
            return adapter?.buildInsertEntryBytes?.(pr, arrayPath, index, req.position);
        case "remove":
            return adapter?.buildRemoveEntryBytes?.(pr, arrayPath, index);
        case "reorder":
            return adapter?.buildMoveEntryBytes?.(pr, arrayPath, index, req.direction);
        case "duplicate":
            return adapter?.buildDuplicateEntryBytes?.(pr, arrayPath, index);
        case "addChild":
            return adapter?.buildAddChildEntryBytes?.(pr, arrayPath, index, req.childSection);
        case "removeChild":
            return adapter?.buildRemoveChildEntryBytes?.(pr, arrayPath, index, req.childSection, req.childIndex);
    }
}

// Returns a result reflecting the current session state without any mutation.
// Used when the adapter returns undefined - e.g. a boundary reorder where moving
// up at index 0 is not possible. The UI disables controls at boundaries, so THAT
// caller is defensive rather than user-reachable.
//
// The buildOpBytes catch in structureOp is not: inconsistent on-disk data reaches
// it, and the user sees their edit do nothing with no explanation. Telling them
// needs a message field on StructureResult plus host and webview plumbing, which
// is why it is recorded here rather than silently accepted as fine.
export function noopResult(session: EditorSession): StructureResult {
    return { changeSet: buildChangeSet(session, session.dirty) };
}

/** Find the node whose namePath exactly matches `namePath`, else undefined. */
function findByNamePath(session: EditorSession, namePath: NamePath): FlatNode | undefined {
    return session.model.nodes.find(
        (n) => n.namePath.length === namePath.length && n.namePath.every((s, i) => s === namePath[i]),
    );
}

interface ResolvedTarget {
    /** The section group's display path the byte-builders route on (parent of the entry, or the section itself for "add"). */
    arrayPath: NamePath;
    /** 0-based ordinal of the target entry among its siblings; -1 for "add" (no pre-existing entry). */
    index: number;
}

/**
 * Resolve a structure-op request's NodeId target to the section's display path
 * and the entry's 0-based ordinal among its siblings. The ordinal is read from
 * the model's structural child order (never parsed from a label), so it is the
 * exact index the byte-builders expect regardless of how the entry is displayed.
 */
function resolveTarget(session: EditorSession, req: StructureOpRequest): ResolvedTarget | undefined {
    const model = session.model;
    if (req.op === "add") {
        const idx = model.byId.get(req.sectionId);
        const section = idx === undefined ? undefined : model.nodes[idx];
        if (!section || section.kind !== "group") return undefined;
        return { arrayPath: section.namePath, index: -1 };
    }
    const entryIdx = model.byId.get(req.entryId);
    const entry = entryIdx === undefined ? undefined : model.nodes[entryIdx];
    if (!entry || entry.parentId === undefined) return undefined;
    const parentIdx = model.byId.get(entry.parentId);
    const parent = parentIdx === undefined ? undefined : model.nodes[parentIdx];
    if (!parent) return undefined;
    const kids = model.childrenByParent.get(entry.parentId) ?? [];
    const index = kids.findIndex((ni) => model.nodes[ni] === entry);
    if (index === -1) return undefined;
    return { arrayPath: parent.namePath, index };
}

/**
 * NodeId at `index` within a pre-fetched children index array.
 * Clamps to valid range; returns undefined if the array is empty.
 */
function childIdAt(model: EditorSession["model"], kids: number[], index: number): NodeId | undefined {
    if (!kids.length) return undefined;
    const clamped = Math.max(0, Math.min(index, kids.length - 1));
    return model.nodes[kids[clamped]!]?.id;
}

export function structureOp(session: EditorSession, req: StructureOpRequest): StructureResult {
    // Reject a locked target here at the host, not just in the webview that disables its controls -
    // a crafted or raced message must not be able to restructure a partially-undecoded subtree.
    // "add" targets the section group itself; every other op targets a concrete entry.
    assertNotLocked(session.model, req.op === "add" ? req.sectionId : req.entryId);

    const adapter = formatAdapterRegistry.get(session.parserId);
    // Resolve the NodeId target to the section path + the entry's structural ordinal from the OLD
    // model, before commit replaces session.model.
    const target = resolveTarget(session, req);
    if (!target) return noopResult(session);
    // A structure op on already-inconsistent on-disk data can trip the partition validator (e.g. removing one
    // flagged memorization row while another row remains inconsistent). Fail safe to a no-op rather than crash
    // the editor; the user resolves the remaining inconsistency (clamp) and retries.
    let bytes: Uint8Array | undefined;
    try {
        bytes = buildOpBytes(adapter, session.model.parseResult, req, target);
    } catch {
        return noopResult(session);
    }
    if (!bytes) return noopResult(session);

    const { arrayPath, index } = target;
    const arrayLabel = arrayPath.join(" / ");
    let label: string;
    switch (req.op) {
        case "add":
            label = `Add to ${arrayLabel}`;
            break;
        case "insert":
            label = `Insert ${req.position} ${arrayLabel} #${index + 1}`;
            break;
        case "remove":
            label = `Remove ${arrayLabel} #${index + 1}`;
            break;
        case "reorder":
            label = `Move ${arrayLabel} #${index + 1} ${req.direction}`;
            break;
        case "duplicate":
            label = `Duplicate ${arrayLabel} #${index + 1}`;
            break;
        case "addChild":
            label = `Add ${req.childSection} to ${arrayLabel} #${index + 1}`;
            break;
        case "removeChild":
            label = `Remove ${req.childSection} #${req.childIndex + 1} from ${arrayLabel} #${index + 1}`;
            break;
    }

    const result = commit(session, label, reparse(session, bytes));

    // Resolve the post-op selection in the NEW (rebuilt) model: locate the section by its
    // (stable) display path, then pick the slot the op leaves selected.
    const postGroup = findByNamePath(session, arrayPath);
    const newKids = postGroup ? (session.model.childrenByParent.get(postGroup.id) ?? []) : [];
    const newKidsCount = newKids.length;
    let selIndex: number;
    switch (req.op) {
        case "add":
            selIndex = newKidsCount - 1;
            break;
        case "insert":
            selIndex = req.position === "before" ? index : index + 1;
            break;
        case "duplicate":
            selIndex = index + 1;
            break;
        case "reorder":
            // Boundary reorders (up at index 0, down at last) return undefined bytes and exit via
            // the no-op path above, so index - 1 and index + 1 are both in range here.
            selIndex = req.direction === "up" ? index - 1 : index + 1;
            break;
        case "remove":
            // Select the entry BEFORE the removed one so focus lands on a stable, still-present neighbor
            // rather than the entry that shifted up into the freed slot. childIdAt clamps -1 -> 0, so removing
            // the first entry falls back to the new first; an emptied list yields no selection.
            selIndex = index - 1;
            break;
        case "addChild":
        case "removeChild":
            // The child lives in another section / nested under the parent; the parent list is unchanged,
            // so keep the same parent entry selected.
            selIndex = index;
            break;
    }
    result.selection = childIdAt(session.model, newKids, selIndex);
    return result;
}

// Undo/redo return a full changeSet (same shape as a structure op) so the webview refreshes EVERYTHING the
// restored model touched - form fields, tab count badges, cross-record dropdowns, diagnostics, and the tree -
// not just the list/tree. Refreshing via a narrower "invalidated" left field values and tab counts stale.
export function undo(session: EditorSession): StructureResult {
    const entry = session.undo.pop();
    if (!entry) return { changeSet: buildChangeSet(session, session.dirty) };
    session.redo.push({ label: entry.label, before: session.model.parseResult });
    session.model = buildModel(entry.before);
    invalidateCachedDocument(session.model.parseResult);
    // Assumes an empty undo stack means the model is back at the saved state. Holds because the only
    // dirtying paths (editField, commit) each push an undo entry. A future dirtying path that does not
    // must revisit this.
    session.dirty = session.undo.length > 0;
    return { changeSet: buildChangeSet(session, session.dirty) };
}

export function redo(session: EditorSession): StructureResult {
    const entry = session.redo.pop();
    if (!entry) return { changeSet: buildChangeSet(session, session.dirty) };
    session.undo.push({ label: entry.label, before: session.model.parseResult });
    session.model = buildModel(entry.before);
    invalidateCachedDocument(session.model.parseResult);
    session.dirty = true;
    return { changeSet: buildChangeSet(session, session.dirty) };
}
