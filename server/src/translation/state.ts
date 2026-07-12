/**
 * Shared mutable state for the translation subsystem, threaded into the loader / feature /
 * write-back modules instead of being duplicated on each of them. The `Translation` facade
 * (`../translation.ts`) owns one `TranslationState` instance for its lifetime and passes it into
 * every extracted module function that needs it.
 */

import * as fs from "fs";
import type { ProjectTraSettings } from "../settings";
import type { TraData } from "./entries";

export interface TranslationState {
    directory: string;
    data: TraData;
    /** Forward index: traFileKey -> set of absolute consumer file paths */
    consumers: Map<string, Set<string>>;
    /**
     * Inverse of `consumers`: absolute consumer file path -> its current traFileKey.
     *
     * A consumer file references exactly one tra/msg file at a time (resolved by
     * `resolveTraFileKey`), so this is a 1:1 lookup, not 1:many. Maintained in
     * lockstep with `consumers` so `reloadConsumer` can remove the previous
     * mapping for a file in O(1) instead of scanning every traFileKey's consumer
     * set on each debounced document change.
     */
    consumerToTraKey: Map<string, string>;
    settings: ProjectTraSettings;
    workspaceRoot: string | undefined;
    /**
     * `fs.realpathSync(workspaceRoot)` memoised at construction. isSubpath is called
     * on every debounced document change; resolving the workspace root once avoids a
     * syscall per call. `undefined` if no workspace root or realpath failed.
     */
    resolvedWsRoot: string | undefined;
    /** Lazily memoised realpath of the tra directory (see `getResolvedTraDir` in loader.ts). */
    resolvedTraDirCache: string | null | undefined;
    /**
     * Optional callback fired whenever a `.tra`/`.msg` document's entries are re-read and
     * re-indexed (see `reloadFileLines`). Lets the caller push an LSP `inlayHint.refresh()` so
     * open consumer documents drop stale `@N` previews instead of waiting for their own next
     * edit. Undefined in contexts with no live client to notify (unit tests, CLI-style use).
     */
    notifyReload: (() => void) | undefined;
}

/** Resolve a path's realpath, returning undefined on failure or missing input. */
export function resolveRealpath(p: string | undefined): string | undefined {
    if (!p) return undefined;
    try {
        return fs.realpathSync(p);
    } catch {
        return undefined;
    }
}

export function createTranslationState(
    settings: ProjectTraSettings,
    workspaceRoot: string | undefined,
    notifyReload: (() => void) | undefined,
): TranslationState {
    return {
        directory: settings.directory,
        data: new Map(),
        consumers: new Map(),
        consumerToTraKey: new Map(),
        settings,
        workspaceRoot,
        resolvedWsRoot: resolveRealpath(workspaceRoot),
        resolvedTraDirCache: null,
        notifyReload,
    };
}
