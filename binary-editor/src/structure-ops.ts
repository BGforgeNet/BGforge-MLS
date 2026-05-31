import { formatAdapterRegistry, parserRegistry, type ParseResult } from "@bgforge/binary";
import { buildModel } from "./model";
import { getWindow } from "./window";
import type { EditorSession } from "./session";
import type { NamePath, StructureResult } from "./types";

export interface StructureOpRequest {
    op: "add"; // insert/remove/reorder/duplicate land in later plans
    namePath: NamePath;
}

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
    session.dirty = true;
    // StructureResult.selection is intentionally left unset in the add slice: the new entry's NodeId
    // is not yet resolved here. Populating it (to select/scroll-to the added entry) lands with the
    // insert/remove/reorder ops in a later plan.
    return {
        changeSet: {
            changed: getWindow(session.model, 0, 200),
            diagnostics: [],
            dirty: true,
            formatValid: true,
        },
    };
}

export function structureOp(session: EditorSession, req: StructureOpRequest): StructureResult {
    const adapter = formatAdapterRegistry.get(session.parserId);
    const bytes = adapter?.buildAddEntryBytes?.(session.model.parseResult, req.namePath);
    if (!bytes) throw new Error(`Not an addable array: ${req.namePath.join(" / ")}`);
    return commit(session, `Add to ${req.namePath.join(" / ")}`, reparse(session, bytes));
}

export function undo(session: EditorSession): void {
    const entry = session.undo.pop();
    if (!entry) return;
    session.redo.push({ label: entry.label, before: session.model.parseResult });
    session.model = buildModel(entry.before);
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
    session.dirty = true;
}
