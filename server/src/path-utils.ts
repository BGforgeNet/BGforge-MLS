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

/** find files in directory by extension */
export function findFiles(dirName: string, extension: string) {
    const entries = fg.sync(`**/*.${extension}`, { cwd: dirName, caseSensitiveMatch: false });
    return entries;
}
