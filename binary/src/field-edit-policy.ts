/**
 * Edit-policy gate for parsed-tree mutations.
 *
 * `editingLocked` on a ParsedGroup is the parser's statement that the
 * surrounding record's wire layout couldn't be fully decoded — typically
 * because it depends on metadata external to the file (e.g. MAP object
 * subtype payloads described in `.pro` files). Field edits inside such a
 * subtree are width-preserving but not interpretation-preserving: changing
 * the upper byte of `pid` or an `inventoryLength` count would re-bind the
 * opaque-trailer bytes to a different structure on reparse, silently
 * corrupting the file.
 *
 * `findEditableField` is the canonical lookup any editor surface uses to
 * obtain a field reference for the purpose of mutation. Returns `undefined`
 * when the path doesn't resolve OR when any group on the path carries
 * `editingLocked: true`. The host's `applyEdit` runs every edit through
 * this gate; display surfaces consult the same `editingLocked` flag during
 * their own one-shot tree walks (a reflection of the same fact, not a
 * separate enforcement layer).
 */

import type { ParsedField, ParsedGroup } from "./types";

export function findEditableField(root: ParsedGroup, fieldId: string): ParsedField | undefined {
    const segments = decodeFieldIdSegments(fieldId);
    if (!segments || segments.length === 0) return undefined;
    return walk(root, segments, 0, false);
}

function decodeFieldIdSegments(fieldId: string): readonly string[] | undefined {
    let parsed: unknown;
    try {
        parsed = JSON.parse(fieldId);
    } catch {
        return undefined;
    }
    if (!Array.isArray(parsed)) return undefined;
    if (!parsed.every((part): part is string => typeof part === "string")) return undefined;
    return parsed;
}

function walk(
    group: ParsedGroup,
    segments: readonly string[],
    depth: number,
    locked: boolean,
): ParsedField | undefined {
    if (depth >= segments.length) return undefined;
    const childLocked = locked || group.editingLocked === true;
    for (const entry of group.fields) {
        if ("fields" in entry) {
            if (entry.name !== segments[depth]) continue;
            const found = walk(entry, segments, depth + 1, childLocked);
            if (found) return found;
            continue;
        }
        if (depth === segments.length - 1 && entry.name === segments[depth]) {
            return childLocked ? undefined : entry;
        }
    }
    return undefined;
}
