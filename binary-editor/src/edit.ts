import type { ParsedField, ParseResult } from "@bgforge/binary";
import type { EditorSession } from "./session";
import { projectRow } from "./window";
import { serializeSession } from "./serialize";
import type { EditResult, NodeId } from "./types";

/**
 * Clear a stale cached canonical document after a display-tree mutation so the
 * next serialize/snapshot rebuilds from the edited tree.
 *
 * IE formats (ITM, SPL, EFF, CRE) store `document` as a plain own writable
 * property. Setting it to undefined causes the IE serializer to fall through
 * from getDocument (returns undefined) to rebuildFromDisplay (reads the current
 * display tree).
 *
 * MAP stores `document` as a configurable getter+setter. The lazy getter caches
 * after first access; once cached, mutations to the display tree are not visible
 * through the getter. Setting the property to undefined via the setter resets
 * the cache. When the MAP serializer then accesses result.document it gets
 * undefined, falls through to rebuildMapCanonicalDocument, which reads the
 * current (mutated) display tree.
 *
 * No-op for formats that have no own `document` descriptor (e.g. PRO, FRM).
 */
export function invalidateCachedDocument(parseResult: ParseResult): void {
    const desc = Object.getOwnPropertyDescriptor(parseResult, "document");
    if (!desc) return;
    if (desc.writable === true || desc.set !== undefined) {
        parseResult.document = undefined;
    }
}

function cloneParseResult(session: EditorSession) {
    // Snapshots the entire ParseResult via structuredClone, including the optional format-specific
    // `document` field where present. This relies on the parse tree and any format document being
    // structured-serializable (no functions, no class instances with non-enumerable properties).
    // That holds for the MAP slice; a format-aware clone may be needed when richer canonical documents are added.
    return structuredClone(session.model.parseResult);
}

export function editField(session: EditorSession, nodeId: NodeId, value: number | string): EditResult {
    const idx = session.model.byId.get(nodeId);
    if (idx === undefined) throw new Error(`Unknown node ${nodeId}`);
    const node = session.model.nodes[idx];
    if (!node) throw new Error(`Unknown node ${nodeId}`);
    if (node.kind !== "field") throw new Error(`Node ${nodeId} is not a field`);

    session.undo.push({ label: `Edit ${node.name}`, before: cloneParseResult(session) });
    session.redo = [];

    // kind === "field" guarantees the source is a ParsedField.
    const field = node.source as ParsedField;
    field.value = value;
    field.rawValue = value;
    invalidateCachedDocument(session.model.parseResult);
    session.dirty = true;

    // Format-validity for the slice: the structure still serializes.
    let formatValid = true;
    try {
        serializeSession(session);
    } catch {
        formatValid = false;
    }

    const rel = session.relationshipModel;
    const changed = [projectRow(session.model, node, rel)];
    if (rel) {
        for (const depId of rel.dependents(session.model, node)) {
            const depIdx = session.model.byId.get(depId);
            const depNode = depIdx === undefined ? undefined : session.model.nodes[depIdx];
            if (depNode) changed.push(projectRow(session.model, depNode, rel));
        }
    }

    return {
        changeSet: {
            changed,
            diagnostics: rel ? rel.constraints(session.model) : [],
            dirty: session.dirty,
            formatValid,
        },
    };
}
