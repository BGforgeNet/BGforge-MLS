/**
 * Format-general entry-mutation pipeline for variable-length array sections.
 *
 * The shape every format shares: read the canonical document, mutate the
 * target array, run an optional per-format relink hook (maintain cross-
 * references the writer does not derive), reserialize via the format's
 * canonical writer, and shift opaque ranges past the resized region so the
 * caller can reparse. Capabilities and the default element come from the
 * caller (MAP reads them from its arraySpec; ITM declares them in a per-format
 * collection descriptor because abilities/effects are document-level arrays
 * with no single arraySpec to read from).
 */

export type EntryOpKind = "add" | "insert" | "remove" | "reorder" | "duplicate";

export interface EntryMutation<Entry> {
    /** Resulting array after the structural change. */
    readonly next: readonly Entry[];
    /** Op that produced it, plus the affected index and signed length delta, for the relink hook. */
    readonly op: EntryOpKind;
    readonly index: number;
    readonly delta: number;
}

export interface EntryCollection<Doc, Entry> {
    readonly read: (doc: Doc) => readonly Entry[];
    readonly write: (doc: Doc, next: readonly Entry[]) => Doc;
    readonly defaultElement: () => Entry;
    /**
     * Capability gates the CALLER checks before dispatching to applyEntryMutation; the
     * mutation function itself does not enforce them. ITM uses these to gate UI/dispatch.
     */
    readonly addable: boolean;
    readonly removable: boolean;
    /**
     * Maintain cross-references the canonical writer does not derive (e.g. ITM
     * per-ability featureBlockIndex/Count). MAP supplies undefined (a bare
     * int32 has no identity to relink). Runs after the array mutation, before
     * serialize. Receives the working doc (already array-updated) and the
     * mutation descriptor; returns the relinked doc.
     */
    readonly relink?: (doc: Doc, mutation: EntryMutation<Entry>) => Doc;
}

/**
 * Apply one structural mutation to an array and return the descriptor, or undefined for a
 * boundary no-op. `index` is unused for the "add" op (it always appends).
 */
export function applyEntryMutation<Entry>(
    current: readonly Entry[],
    op: EntryOpKind,
    index: number,
    defaultElement: () => Entry,
    position?: "before" | "after",
    direction?: "up" | "down",
): EntryMutation<Entry> | undefined {
    // Guard every index-consuming op the way reorder already does, so an out-of-range index is a
    // uniform no-op rather than silent corruption (duplicate would otherwise clone undefined,
    // remove would silently drop nothing). "add" ignores index, so it is excluded.
    if (op !== "add" && (index < 0 || index >= current.length)) return undefined;
    switch (op) {
        case "add": {
            const next = [...current, defaultElement()];
            return { next, op, index: current.length, delta: 1 };
        }
        case "insert": {
            // `position` defaults to "after" when omitted.
            const at = position === "before" ? index : index + 1;
            return {
                next: [...current.slice(0, at), defaultElement(), ...current.slice(at)],
                op,
                index: at,
                delta: 1,
            };
        }
        case "remove":
            return { next: [...current.slice(0, index), ...current.slice(index + 1)], op, index, delta: -1 };
        case "duplicate":
            return {
                next: [...current.slice(0, index + 1), current[index]!, ...current.slice(index + 1)],
                op,
                index: index + 1,
                delta: 1,
            };
        case "reorder": {
            const target = direction === "up" ? index - 1 : index + 1;
            if (target < 0 || target >= current.length) return undefined;
            const next = [...current];
            [next[index], next[target]] = [next[target]!, next[index]!];
            return { next, op, index: target, delta: 0 };
        }
    }
}
