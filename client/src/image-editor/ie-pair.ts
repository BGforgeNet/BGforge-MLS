import * as path from "path";

/**
 * IE creature animations store their eastern orientations in a `<stem>e.bam` companion next to the
 * base file. Like the Fallout `.fr0`-`.fr5` split (fr-split.ts), opening either member loads the
 * pair combined; saving splits back into the two files. These pure helpers only derive candidate
 * sibling names - whether two files actually form a pair is decided by the shape validation in
 * `combineIeBamPair` (@bgforge/image), since any stem may happen to end in "e".
 *
 * They take and return a URI PATH (`vscode.Uri.path`), which is posix-separated whatever the host,
 * not a filesystem path. The caller rebuilds each sibling with `uri.with({ path })`, so the scheme
 * and query come along and a pair resolves inside whatever served the opened member - a workspace
 * folder, or the archives of the game a `bgforge-ie-resource:` URI names.
 */

/** Whether `uriPath` can be a pair member at all (BAM and BAMC share the .bam extension). */
export function isBamPath(uriPath: string): boolean {
    return path.posix.extname(uriPath).toLowerCase() === ".bam";
}

/** Candidate companion paths when `uriPath` is the base file: stem + "e"/"E" (resource case varies). */
export function eastCompanionCandidates(uriPath: string): string[] {
    const parsed = path.posix.parse(uriPath);
    return ["e", "E"].map((suffix) => sibling(parsed.dir, parsed.name + suffix, parsed.ext));
}

/** The base-file path when `uriPath` is itself a companion (stem ends in e/E); undefined otherwise. */
export function baseCandidatePath(uriPath: string): string | undefined {
    const parsed = path.posix.parse(uriPath);
    if (parsed.name.length < 2 || !/[eE]$/.test(parsed.name)) return undefined;
    return sibling(parsed.dir, parsed.name.slice(0, -1), parsed.ext);
}

// join, not format: a game resource's path has no folder above it, so its dir is "/" and format
// would emit a doubled "//<stem>.bam" that resolves to nothing.
function sibling(dir: string, name: string, ext: string): string {
    return path.posix.join(dir, `${name}${ext}`);
}
