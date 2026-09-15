/**
 * The shape the resource indexes read an install through.
 *
 * Named structurally rather than imported from the archive library, so an index depends on what it uses -
 * and so a test can serve one from loose values without building a KEY/BIF. It lives here rather than in
 * either index because both read it, and because this module imports nothing: an index that pulled the type
 * from its sibling would pull that sibling's `vscode` dependency with it.
 */

export interface GameHandle {
    /**
     * Which game this is, in the fine flavour WeiDU's `GAME_IS` tests. Read by the animation index to pick
     * the table a classic install needs; declared here as the one field of it anyone reads, so a test handle
     * owes a flavour rather than a whole identity.
     */
    identity: { flavour: string };
    tlk: () => { get: (strref: number) => string | undefined } | undefined;
    canRead: (resref: string, type: string) => boolean;
    read: (resref: string, type: string) => Uint8Array;
    list: () => readonly { resref: string; ext: string | undefined }[];
}

/** An open install, by directory. */
export interface GameSource {
    gameAt: (dir: string) => GameHandle | undefined;
}
