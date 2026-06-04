import { formatAdapterRegistry } from "@bgforge/binary";
import type { FlatNode, Model } from "./model";
import type { EditorSession } from "./session";
import type { Diagnostic, NodeId } from "./types";

/** Best-effort: given an error path array from a schema violation, attempt to
 *  locate the corresponding FlatNode by matching the last string segment of
 *  the path against node names in the model. Returns "" (file-level) when no
 *  match is found. This is deliberately shallow: the canonical document path
 *  structure does not map 1:1 to the display namePath, so false misses are
 *  expected. The file-level fallback ensures behavior is never worse than the
 *  prior single-warning implementation. */
function resolveNodeId(model: Model, errorPath: readonly unknown[]): NodeId {
    // Find the last string segment in the path to use as a field-name hint.
    let hint: string | undefined;
    for (let i = errorPath.length - 1; i >= 0; i--) {
        if (typeof errorPath[i] === "string") {
            hint = errorPath[i] as string;
            break;
        }
    }
    if (!hint) return "";
    // Walk all nodes looking for a field whose name matches the hint.
    const lower = hint.toLowerCase();
    const match = model.nodes.find((n: FlatNode) => n.kind === "field" && n.name.toLowerCase() === lower);
    return match ? match.id : "";
}

/** Advisory strict-validation pass. Returns the union of:
 *  (a) per-field diagnostics from the relationship model's constraints, and
 *  (b) a snapshot-level diagnostic if the canonical snapshot builder throws.
 *  Constraint diagnostics carry real NodeIds. Snapshot violations use a
 *  best-effort NodeId mapping with a file-level fallback ("") so the result
 *  is never worse than the prior single file-level warning. A clean document
 *  with no constraint violations yields []. */
export function validate(session: EditorSession): Diagnostic[] {
    const diags: Diagnostic[] = session.relationshipModel
        ? [...session.relationshipModel.constraints(session.model)]
        : [];

    const adapter = formatAdapterRegistry.get(session.parserId);
    if (!adapter) return diags;
    try {
        adapter.createJsonSnapshot(session.model.parseResult);
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        // Best-effort NodeId from the first issue's path if the error carries issues[].
        let nodeId: NodeId = "";
        if (
            error !== null &&
            typeof error === "object" &&
            "issues" in error &&
            Array.isArray((error as { issues: unknown }).issues) &&
            (error as { issues: unknown[] }).issues.length > 0
        ) {
            const firstIssue = (error as { issues: { path?: unknown[] }[] }).issues[0];
            if (firstIssue?.path) {
                nodeId = resolveNodeId(session.model, firstIssue.path);
            }
        }
        diags.push({ nodeId, severity: "warning", message });
    }
    return diags;
}
