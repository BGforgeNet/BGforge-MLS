import { formatAdapterRegistry } from "@bgforge/binary";
import type { EditorSession } from "./session";
import type { Diagnostic } from "./types";

/** Advisory strict-validation pass. Runs the canonical snapshot builder (which
 *  throws on a closed-enum/domain violation) and reports any failure as a
 *  warning instead of blocking. A clean document yields no diagnostics. The
 *  per-field mapping of a violation to its NodeId is refined in a later plan;
 *  for now a single file-level warning is emitted. */
export function validate(session: EditorSession): Diagnostic[] {
    const adapter = formatAdapterRegistry.get(session.parserId);
    if (!adapter) return [];
    try {
        adapter.createJsonSnapshot(session.model.parseResult);
        return [];
    } catch (error) {
        return [{ nodeId: "", severity: "warning", message: error instanceof Error ? error.message : String(error) }];
    }
}
