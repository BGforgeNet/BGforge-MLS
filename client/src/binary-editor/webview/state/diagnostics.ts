import type { Diagnostic } from "@bgforge/binary-editor";

/** Groups a flat diagnostic list by nodeId for O(1) lookup in Field rows. */
export function diagnosticsByNode(diags: Diagnostic[]): Map<string, Diagnostic[]> {
    const map = new Map<string, Diagnostic[]>();
    for (const d of diags) {
        const existing = map.get(d.nodeId);
        if (existing) {
            existing.push(d);
        } else {
            map.set(d.nodeId, [d]);
        }
    }
    return map;
}

/** Returns a short summary string for the banner, e.g. "3 warnings, 1 error".
 *  Returns "" when the list is empty. */
export function bannerSummary(diags: Diagnostic[]): string {
    if (diags.length === 0) return "";
    const warnings = diags.filter((d) => d.severity === "warning").length;
    const errors = diags.filter((d) => d.severity === "error").length;
    const parts: string[] = [];
    if (warnings > 0) parts.push(warnings === 1 ? "1 warning" : `${warnings} warnings`);
    if (errors > 0) parts.push(errors === 1 ? "1 error" : `${errors} errors`);
    return parts.join(", ");
}
