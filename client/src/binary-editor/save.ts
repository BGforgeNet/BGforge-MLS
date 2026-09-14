import { getSnapshotPath } from "@bgforge/binary";
import type { Response } from "@bgforge/binary-editor";

/** The snapshot JSON out of a worker reply. Throws on anything else, so a failed snapshot never reaches disk as an
 *  empty sidecar. */
export function snapshotJsonFrom(response: Response): string {
    if (response.type !== "snapshot") {
        throw new Error(response.type === "error" ? response.message : "Failed to create JSON snapshot");
    }
    return response.json;
}

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
