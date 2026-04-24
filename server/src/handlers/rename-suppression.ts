/**
 * Rename-affected URI tracker.
 *
 * VS Code's cross-file undo group is fragile: when rename writes multiple files
 * and the compile-on-change path then writes .tmp.ssl, VS Code treats the tmp
 * write as an external edit and invalidates the undo group. This module lets
 * the rename handler flag URIs that must not compile until the rename's follow-up
 * change/save events have passed through. A safety timeout clears the set in
 * case some files never trigger change/save (e.g. user undoes before save).
 */

import type { NormalizedUri } from "../core/normalized-uri";

const RENAME_SUPPRESS_MS = 3000;

export interface RenameSuppression {
    /**
     * Replace the tracked set with the URIs touched by this rename. Resets the safety timer.
     *
     * Intentional replacement (not union): VS Code sends renames sequentially, so concurrent
     * renames are not a supported flow. The prior batch would have been consumed by the
     * follow-up change/save events before the next rename fires.
     */
    markAffected(uris: Iterable<NormalizedUri>): void;
    /**
     * Returns true if the URI is tracked and removes it from the set.
     * Called by onDidSave — after save, subsequent edits should compile normally.
     */
    consumeAffected(uri: NormalizedUri): boolean;
    /** Non-consuming check used by onDidChangeContent — keep the URI tracked for the later save. */
    isAffected(uri: NormalizedUri): boolean;
    /** Clear timer. Called once at shutdown; the instance is unusable after dispose. */
    dispose(): void;
}

export function createRenameSuppression(): RenameSuppression {
    const affected = new Set<NormalizedUri>();
    let timer: NodeJS.Timeout | undefined;

    return {
        markAffected(uris) {
            affected.clear();
            for (const u of uris) {
                affected.add(u);
            }
            if (timer) clearTimeout(timer);
            timer = setTimeout(() => {
                affected.clear();
            }, RENAME_SUPPRESS_MS);
        },
        consumeAffected(uri) {
            return affected.delete(uri);
        },
        isAffected(uri) {
            return affected.has(uri);
        },
        dispose() {
            if (timer) clearTimeout(timer);
            timer = undefined;
            affected.clear();
        },
    };
}
