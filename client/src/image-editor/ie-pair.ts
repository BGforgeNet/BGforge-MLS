import * as path from "path";

/**
 * IE creature animations store their eastern orientations in a `<stem>e.bam` companion next to the
 * base file. Like the Fallout `.fr0`-`.fr5` split (fr-split.ts), opening either member loads the
 * pair combined; saving splits back into the two files. These pure helpers only derive candidate
 * sibling paths - whether two files actually form a pair is decided by the shape validation in
 * `combineIeBamPair` (@bgforge/image), since any stem may happen to end in "e".
 */

/** Whether `fsPath` can be a pair member at all (BAM and BAMC share the .bam extension). */
export function isBamPath(fsPath: string): boolean {
    return path.extname(fsPath).toLowerCase() === ".bam";
}

/** Candidate companion paths when `fsPath` is the base file: stem + "e"/"E" (resource case varies). */
export function eastCompanionCandidates(fsPath: string): string[] {
    const parsed = path.parse(fsPath);
    return ["e", "E"].map((suffix) => path.format({ dir: parsed.dir, name: parsed.name + suffix, ext: parsed.ext }));
}

/** The base-file path when `fsPath` is itself a companion (stem ends in e/E); undefined otherwise. */
export function baseCandidatePath(fsPath: string): string | undefined {
    const parsed = path.parse(fsPath);
    if (parsed.name.length < 2 || !/[eE]$/.test(parsed.name)) return undefined;
    return path.format({ dir: parsed.dir, name: parsed.name.slice(0, -1), ext: parsed.ext });
}
