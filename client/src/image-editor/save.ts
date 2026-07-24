/** A single file write the vscode shell performs; this module only plans them. */
export interface SaveWrite {
    path: string;
    bytes: Uint8Array;
}

/** The main artifact write, plus the `.pal` sidecar write when the caller supplies one. */
export function planImageSave(input: {
    targetPath: string;
    bytes: Uint8Array;
    sidecar?: { path: string; bytes: Uint8Array };
}): SaveWrite[] {
    const writes: SaveWrite[] = [{ path: input.targetPath, bytes: input.bytes }];
    if (input.sidecar) writes.push({ path: input.sidecar.path, bytes: input.sidecar.bytes });
    return writes;
}
