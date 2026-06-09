import { formatAdapterRegistry, type ParsedField, type ParseResult } from "@bgforge/binary";
import { layoutFieldRows, type EditorSession } from "./session";
import { projectRow } from "./window";
import { serializeSession } from "./serialize";
import type { EditResult, NodeId } from "./types";

/**
 * Clear a stale cached canonical document after a display-tree mutation so the
 * next serialize/snapshot rebuilds from the edited tree.
 *
 * The per-format choice is declared explicitly on the adapter as
 * `documentCacheStrategy` (review finding #6a) rather than inferred from the
 * shape of the `document` property: a "clear" format has a rebuildable cached
 * document (IE/PRO own writable property, MAP lazy getter+setter) and the
 * assignment to undefined either nulls the property or invokes the setter that
 * resets the lazy cache; the serializer then falls through to rebuild-from-display.
 * A "none" format keeps no editor-invalidatable cache, so it is left untouched.
 * The adapter is resolved by `parseResult.format`, which carries the formatId.
 */
export function invalidateCachedDocument(parseResult: ParseResult): void {
    const adapter = formatAdapterRegistry.get(parseResult.format);
    if (adapter?.documentCacheStrategy === "clear") {
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
    // Blanket-resend every layout field so a document-derived form field (CRE item-slot / selected-weapon
    // dropdown) refreshes after this edit even when nothing registered it as a dependent above. The big
    // list/tree blocks are not here - they refresh via the windowed getWindow/getChildren path. Same set
    // buildChangeSet sends after a structure op, so the two refresh paths cannot drift.
    changed.push(...layoutFieldRows(session));

    return {
        changeSet: {
            changed,
            diagnostics: rel ? rel.constraints(session.model) : [],
            dirty: session.dirty,
            formatValid,
        },
    };
}
