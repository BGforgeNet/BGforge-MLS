import path from "path";
import { type BamV2PageWrite, pvrzResourceName } from "@bgforge/image";

/** A single file write the vscode shell performs; this module only plans them. */
export interface SaveWrite {
    path: string;
    bytes: Uint8Array;
}

/**
 * The main artifact write, then the `.pal` sidecar and any PVRZ pages the caller supplies. The main
 * artifact goes first so a crash never leaves fresh pages beside a stale file still referencing the
 * old ones.
 */
export function planImageSave(input: {
    targetPath: string;
    bytes: Uint8Array;
    sidecar?: { path: string; bytes: Uint8Array };
    pages?: readonly SaveWrite[];
}): SaveWrite[] {
    const writes: SaveWrite[] = [{ path: input.targetPath, bytes: input.bytes }];
    if (input.sidecar) writes.push({ path: input.sidecar.path, bytes: input.sidecar.bytes });
    if (input.pages) writes.push(...input.pages);
    return writes;
}

/**
 * Where a BAM v2's PVRZ pages land: a data block addresses a page by number, and the file that
 * number means is `MOS<nnnn>.PVRZ` beside the `.bam` - which is where the game's own loader looks.
 */
export function pvrzPageWrites(targetPath: string, pages: readonly BamV2PageWrite[]): SaveWrite[] {
    const dir = path.dirname(targetPath);
    return pages.map((page) => ({ path: path.join(dir, pvrzResourceName(page.page)), bytes: page.bytes }));
}
