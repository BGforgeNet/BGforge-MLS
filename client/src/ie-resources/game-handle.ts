/**
 * The shape the resource indexes read an install through.
 *
 * Named structurally rather than imported from the archive library, so an index depends on what it uses -
 * and so a test can serve one from loose values without building a KEY/BIF. It lives here rather than in
 * either index because both read it, and because this module imports nothing: an index that pulled the type
 * from its sibling would pull that sibling's `vscode` dependency with it.
 */

export interface GameHandle {
    tlk: () => { get: (strref: number) => string | undefined } | undefined;
    canRead: (resref: string, type: string) => boolean;
    read: (resref: string, type: string) => Uint8Array;
    list: () => readonly { resref: string; ext: string | undefined }[];
}

/** An open install, by directory. */
export interface GameSource {
    gameAt: (dir: string) => GameHandle | undefined;
}
