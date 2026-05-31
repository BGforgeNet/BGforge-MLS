import type { ParsedField } from "@bgforge/binary";
import type { EditorSession } from "./session";
import { projectRow } from "./window";
import { serializeSession } from "./serialize";
import type { EditResult, NodeId } from "./types";

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
    session.dirty = true;

    // Deferred: discriminator-driven sibling re-shaping. When the edited field is a discriminator
    // (e.g. an IE effect opcode that changes a sibling parameter's type), dependent sibling rows must
    // be re-evaluated and added to changeSet.changed. The relationship model that drives this lands in
    // a later plan; for now only the edited row is re-projected.

    // Format-validity for the slice: the structure still serializes.
    let formatValid = true;
    try {
        serializeSession(session);
    } catch {
        formatValid = false;
    }

    return {
        changeSet: {
            changed: [projectRow(session.model, node)],
            diagnostics: [],
            dirty: session.dirty,
            formatValid,
        },
    };
}
