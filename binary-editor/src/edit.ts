import { formatAdapterRegistry, type ParsedField, type ParseResult } from "@bgforge/binary";
import { assertNotLocked } from "./model";
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
    // Reject a locked target here at the host, not just in the webview that disables its controls -
    // a crafted or raced message must not be able to mutate a partially-undecoded subtree.
    assertNotLocked(session.model, nodeId);

    session.undo.push({ label: `Edit ${node.name}`, before: cloneParseResult(session) });
    session.redo = [];

    // kind === "field" guarantees the source is a ParsedField.
    const field = node.source as ParsedField;
    field.value = value;
    field.rawValue = value;

    // Cascading edits implied by this one (e.g. clearing a sibling inventory slot that held the just-reassigned
    // item, keeping a `uniqueRef` reference unique). `node` now carries its new value, so the relationship model
    // reads the duplicates straight off the model. Applied in the same undo step (the snapshot above already
    // captured the pre-edit state of every field, so one undo restores them all).
    const rel = session.relationshipModel;
    const cascadeNodes: (typeof node)[] = [];
    if (rel) {
        for (const { nodeId: cid, value: cval } of rel.cascade(session.model, node)) {
            const ci = session.model.byId.get(cid);
            const cnode = ci === undefined ? undefined : session.model.nodes[ci];
            if (cnode?.kind === "field") {
                (cnode.source as ParsedField).value = cval;
                (cnode.source as ParsedField).rawValue = cval;
                cascadeNodes.push(cnode);
            }
        }
    }

    invalidateCachedDocument(session.model.parseResult);
    session.dirty = true;

    // Format-validity for the slice: the structure still serializes.
    let formatValid = true;
    try {
        serializeSession(session);
    } catch {
        formatValid = false;
    }

    const changed = [projectRow(session.model, node, rel)];
    // Re-project the cascaded siblings (the cleared slots) so the UI reflects them precisely - the blanket
    // resend below also carries them, but this keeps the changeset explicit about what the cascade touched.
    for (const cnode of cascadeNodes) changed.push(projectRow(session.model, cnode, rel));
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
