/**
 * Filesystem path helpers: containment checks, realpath resolution, directory
 * test, and glob-based file discovery. Pure-Node, no LSP-coupled types.
 */

import * as fg from "fast-glob";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

export const tmpDir = path.join(os.tmpdir(), "bgforge-mls");

/**
 * Check if 1st dir contains the 2nd. Resolves `outerPath` via realpathSync on
 * every call. Use this only when the outer is short-lived or rarely the same
 * twice - for hot paths where the outer is stable (workspace root, translation
 * directory), use `isSubpathResolved` with a cached resolved value instead.
 * Current callers all run on debounced reload paths, not LSP-request hot paths.
 */
export function isSubpath(outerPath: string | undefined, innerPath: string): boolean {
    if (outerPath === undefined) {
        return false;
    }
    try {
        const outerReal = fs.realpathSync(outerPath);
        return isSubpathResolved(outerReal, innerPath);
    } catch {
        return false;
    }
}

/**
 * Like `isSubpath`, but accepts a pre-resolved outer path (already passed through
 * `fs.realpathSync`). Lets callers on hot paths resolve the outer once and avoid
 * the syscall on every check.
 */
export function isSubpathResolved(resolvedOuter: string, innerPath: string): boolean {
    try {
        const innerReal = fs.realpathSync(innerPath);
        const rel = path.relative(resolvedOuter, innerReal);
        return !rel.startsWith("..") && !path.isAbsolute(rel);
    } catch {
        return false;
    }
}

/**
 * Like `isSubpathResolved`, but assumes BOTH paths have already been resolved
 * via `fs.realpathSync` (or are otherwise canonical). Pure string check - no
 * syscall - suitable for the LSP-request hot path. Callers must resolve the
 * inner once at request entry (via `tryRealpathSync`) before calling.
 */
export function isSubpathFullyResolved(resolvedOuter: string, resolvedInner: string): boolean {
    const rel = path.relative(resolvedOuter, resolvedInner);
    return !rel.startsWith("..") && !path.isAbsolute(rel);
}

/**
 * Resolve a path via `fs.realpathSync` once, returning `undefined` if the
 * path does not exist or is otherwise unreadable. Centralises per-request
 * inner-path resolution so callers can do it at handler entry and pass the
 * resolved value through to sibling helpers.
 */
export function tryRealpathSync(p: string): string | undefined {
    try {
        return fs.realpathSync(p);
    } catch {
        return undefined;
    }
}

export function isDirectory(fsPath: string): boolean {
    if (fs.existsSync(fsPath)) {
        return fs.lstatSync(fsPath).isDirectory();
    }
    return false;
}

/**
 * Shared exclusion set for all workspace file discovery. Fixed minimal excludes
 * matching the pyright/tsserver convention (pyright's documented defaults are
 * node_modules, __pycache__, and dotfile/dot-directory paths). Deliberately NOT
 * gitignore-aware: mod workspaces routinely gitignore generated .d/.tra/header
 * files that must still be indexed, so honoring gitignore would silently drop
 * indexable sources.
 */
export const WORKSPACE_SCAN_IGNORE = ["**/node_modules/**", "**/.*/**"];

/**
 * Concurrency bound for reading discovered workspace files. One definition shared
 * by every read fan-out (startup scan, translation loads) so a single number
 * governs the whole indexing pass instead of each call site minting its own.
 */
export const WORKSPACE_SCAN_CONCURRENCY = 4;

/**
 * Find files by a single extension, returning paths relative to `dirName`
 * (fast-glob semantics). Deliberately distinct from `shared/cli/cli-utils.ts`'s
 * `findFiles`, which takes an extension array and returns absolute paths via
 * manual recursion: server callers want cwd-relative single-extension results,
 * the CLIs want absolute multi-extension results. Different contracts, not
 * unified. Applies `WORKSPACE_SCAN_IGNORE` and `suppressErrors` so a dependency
 * tree or an unreadable subtree cannot bloat or abort discovery.
 */
export async function findFiles(dirName: string, extension: string): Promise<string[]> {
    return fg.async(`**/*.${extension}`, {
        cwd: dirName,
        caseSensitiveMatch: false,
        ignore: WORKSPACE_SCAN_IGNORE,
        suppressErrors: true,
    });
}

/**
 * Like `findFiles`, but matches any of several extensions in ONE walk, so the
 * workspace tree is traversed a single time regardless of how many extensions
 * the providers collectively index. Same cwd-relative, case-insensitive,
 * excluded contract as `findFiles`. Returns `[]` for an empty extension list
 * without walking.
 */
export async function findFilesByExtensions(dirName: string, extensions: string[]): Promise<string[]> {
    if (extensions.length === 0) {
        return [];
    }
    const pattern = extensions.length === 1 ? `**/*.${extensions[0]}` : `**/*.{${extensions.join(",")}}`;
    return fg.async(pattern, {
        cwd: dirName,
        caseSensitiveMatch: false,
        ignore: WORKSPACE_SCAN_IGNORE,
        suppressErrors: true,
    });
}
