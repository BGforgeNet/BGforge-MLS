/**
 * The gallery panel's host <-> webview contract.
 *
 * Everything here crosses `postMessage`, so every field is structured-clone safe: plain objects, strings and
 * numbers only. Thumbnails arrive as `data:` URIs rather than bytes for the same reason the binary editor's
 * do - an `<img src>` is what the view needs, and a transferred buffer would have to be re-encoded there.
 */

export interface GalleryTile {
    id: string;
    label: string;
    ext: string;
}

export type HostToWebview =
    /**
     * `note` explains an EMPTY list when the reason is not "this corpus has no pictures" - no game open, no
     * folder open. Without it both states read as "there is nothing here", which sends the reader looking for
     * missing art instead of opening the thing they have not opened.
     */
    | { type: "init"; source: "game" | "workspace"; title: string; items: GalleryTile[]; note?: string }
    /** `dataUri` absent means the item cannot be drawn - the tile keeps its box and shows its label. */
    | { type: "thumbnail"; id: string; dataUri?: string };

export type WebviewToHost =
    | { type: "ready" }
    /** Only what the viewport needs, so opening a game-wide grid does not decode thousands of files. */
    | { type: "requestThumbnails"; ids: string[]; size: number }
    | { type: "open"; id: string }
    /** Posted by `installFatalErrorHandler` (webview-utils.ts) so a throw in the panel is not a blank window. */
    | { type: "runtimeError"; message: string; stack?: string };
