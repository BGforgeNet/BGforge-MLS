import { formatAdapterRegistry, parserRegistry, type ParseResult } from "@bgforge/binary";
import { buildModel } from "./model";
import { invalidateCachedDocument } from "./edit";
import { getWindow } from "./window";
import type { EditorSession } from "./session";
import type { NamePath, StructureResult } from "./types";

export type StructureOpRequest =
    | { op: "add"; namePath: NamePath }
    | { op: "insert"; entryPath: NamePath; position: "before" | "after" }
    | { op: "remove"; entryPath: NamePath }
    | { op: "reorder"; entryPath: NamePath; direction: "up" | "down" }
    | { op: "duplicate"; entryPath: NamePath };

function reparse(session: EditorSession, bytes: Uint8Array): ParseResult {
    const parser = parserRegistry.getById(session.parserId);
    if (!parser) throw new Error(`Unknown parser ${session.parserId}`);
    return parser.parse(bytes, session.parseOptions);
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
    // StructureResult.selection is intentionally left unset in the add slice: the new entry's NodeId
    // is not yet resolved here. Populating it (to select/scroll-to the added entry) lands with the
    // insert/remove/reorder ops in a later plan.
    return {
        changeSet: {
            changed: getWindow(session.model, 0, 200, session.relationshipModel),
            diagnostics: session.relationshipModel ? session.relationshipModel.constraints(session.model) : [],
            dirty: true,
            formatValid: true,
        },
    };
}

function buildOpBytes(
    adapter: ReturnType<typeof formatAdapterRegistry.get>,
    pr: ParseResult,
    req: StructureOpRequest,
): Uint8Array | undefined {
    switch (req.op) {
        case "add":
            return adapter?.buildAddEntryBytes?.(pr, req.namePath);
        case "insert":
            return adapter?.buildInsertEntryBytes?.(pr, req.entryPath, req.position);
        case "remove":
            return adapter?.buildRemoveEntryBytes?.(pr, req.entryPath);
        case "reorder":
            return adapter?.buildMoveEntryBytes?.(pr, req.entryPath, req.direction);
        case "duplicate":
            return adapter?.buildDuplicateEntryBytes?.(pr, req.entryPath);
    }
}

// Returns a result reflecting the current session state without any mutation.
// Used when the adapter returns undefined - e.g. a boundary reorder where moving
// up at index 0 is not possible. The UI disables controls at boundaries, so this
// path is defensive rather than user-reachable.
function noopResult(session: EditorSession): StructureResult {
    return {
        changeSet: {
            changed: getWindow(session.model, 0, 200, session.relationshipModel),
            diagnostics: session.relationshipModel ? session.relationshipModel.constraints(session.model) : [],
            dirty: session.dirty,
            formatValid: true,
        },
    };
}

export function structureOp(session: EditorSession, req: StructureOpRequest): StructureResult {
    const adapter = formatAdapterRegistry.get(session.parserId);
    const bytes = buildOpBytes(adapter, session.model.parseResult, req);
    if (!bytes) return noopResult(session);
    const label = req.op === "add" ? `Add to ${req.namePath.join(" / ")}` : `${req.op} ${req.entryPath.join(" / ")}`;
    return commit(session, label, reparse(session, bytes));
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
