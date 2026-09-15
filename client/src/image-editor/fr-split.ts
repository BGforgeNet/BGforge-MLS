import * as path from "path";

/**
 * Fallout critters can be stored split across six single-direction files, `<base>.fr0` .. `<base>.fr5`
 * (one per facing), instead of a single combined `<base>.frm`. The editor loads a whole set together
 * and saves it back over those same six files, so a save never changes which shape the set is stored
 * in. These pure helpers map between a split member's path and the set; the fs reads, the byte-combine
 * and the split back out live in the document layer.
 */

const FR_SPLIT_EXT = /^\.fr[0-5]$/;

/** Files in a split set - one per FRM facing, which is what makes the extension run `.fr0` to `.fr5`. */
export const FR_SPLIT_MEMBERS = 6;

/** Whether `fsPath` is one of the six split-direction files (`.fr0` .. `.fr5`). */
export function isFrSplitPath(fsPath: string): boolean {
    return FR_SPLIT_EXT.test(path.extname(fsPath).toLowerCase());
}

/** The six `.fr0` .. `.fr5` sibling paths for the set, indexed by facing (0..5), derived from any member. */
export function frSplitSiblingPaths(fsPath: string): string[] {
    const parsed = path.parse(fsPath);
    return Array.from({ length: FR_SPLIT_MEMBERS }, (_, d) =>
        path.format({ dir: parsed.dir, name: parsed.name, ext: `.fr${d}` }),
    );
}

/** The combined `<base>.frm` path: the set's document identity, and where a Save As defaults to. */
export function frSplitCombinedPath(fsPath: string): string {
    const parsed = path.parse(fsPath);
    return path.format({ dir: parsed.dir, name: parsed.name, ext: ".frm" });
}
