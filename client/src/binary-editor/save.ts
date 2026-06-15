import { getSnapshotPath } from "@bgforge/binary";

export interface SaveWrite {
    path: string;
    bytes: Uint8Array;
}

export interface SavePlanInput {
    targetPath: string;
    bytes: Uint8Array;
    snapshotJson: string;
    autoDumpJson: boolean;
}

/** Files a save writes: the main artifact always, plus the JSON snapshot sidecar at
 *  `<file>.json` when the autoDumpJson setting is on (matches the historical editor). */
export function planSave(input: SavePlanInput): SaveWrite[] {
    const writes: SaveWrite[] = [{ path: input.targetPath, bytes: input.bytes }];
    if (input.autoDumpJson) {
        writes.push({ path: getSnapshotPath(input.targetPath), bytes: new TextEncoder().encode(input.snapshotJson) });
    }
    return writes;
}
