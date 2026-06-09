import { formatAdapterRegistry, parserRegistry, type ParseResult } from "@bgforge/binary";
import { buildModel, type FlatNode } from "./model";
import { invalidateCachedDocument } from "./edit";
import { DEFAULT_WINDOW, getWindow } from "./window";
import { layoutFieldRows, type EditorSession } from "./session";
import type { ChangeSet, NamePath, NodeId, StructureResult } from "./types";

/**
 * Structure ops address their target by stable NodeId, never by display label.
 * `add` targets the section group (sectionId); the other ops target a concrete
 * entry (entryId). The editor resolves each NodeId to the section's structural
 * path plus the entry's 0-based ordinal among its siblings before calling the
 * byte-builders - so a presentation relabel / i18n / override cannot misaddress
 * a byte op (review finding #1).
 */
export type StructureOpRequest =
    | { op: "add"; sectionId: NodeId }
    | { op: "insert"; entryId: NodeId; position: "before" | "after" }
    | { op: "remove"; entryId: NodeId }
    | { op: "reorder"; entryId: NodeId; direction: "up" | "down" }
    | { op: "duplicate"; entryId: NodeId };

function reparse(session: EditorSession, bytes: Uint8Array): ParseResult {
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
    };
}

// Stores `before` by reference (no clone): safe because structureOp always replaces
// session.model via buildModel(next), and editField always clones before mutating,
// so no undo snapshot is ever mutated in place.
function commit(session: EditorSession, label: string, next: ParseResult): StructureResult {
    session.undo.push({ label, before: session.model.parseResult });
    session.redo = [];
    session.model = buildModel(next);
    invalidateCachedDocument(session.model.parseResult);
    session.dirty = true;
    // Selection is left unset here; structureOp computes the post-op selection
    // once the new entry's NodeId is resolved and assigned in a dedicated change.
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
    }
}

// Returns a result reflecting the current session state without any mutation.
// Used when the adapter returns undefined - e.g. a boundary reorder where moving
// up at index 0 is not possible. The UI disables controls at boundaries, so this
// path is defensive rather than user-reachable.
function noopResult(session: EditorSession): StructureResult {
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
    const adapter = formatAdapterRegistry.get(session.parserId);
    // Resolve the NodeId target to the section path + the entry's structural ordinal from the OLD
    // model, before commit replaces session.model.
    const target = resolveTarget(session, req);
    if (!target) return noopResult(session);
    const bytes = buildOpBytes(adapter, session.model.parseResult, req, target);
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
            selIndex = Math.min(index, newKidsCount - 1);
            break;
    }
    result.selection = childIdAt(session.model, newKids, selIndex);
    return result;
}

export function undo(session: EditorSession): void {
    const entry = session.undo.pop();
    if (!entry) return;
    session.redo.push({ label: entry.label, before: session.model.parseResult });
    session.model = buildModel(entry.before);
    invalidateCachedDocument(session.model.parseResult);
    // Assumes an empty undo stack means the model is back at the saved state. Holds because the only
    // dirtying paths (editField, commit) each push an undo entry. A future dirtying path that does not
    // must revisit this.
    session.dirty = session.undo.length > 0;
}

export function redo(session: EditorSession): void {
    const entry = session.redo.pop();
    if (!entry) return;
    session.undo.push({ label: entry.label, before: session.model.parseResult });
    session.model = buildModel(entry.before);
    invalidateCachedDocument(session.model.parseResult);
    session.dirty = true;
}
