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

/**
 * One animation set, as a tile.
 *
 * `unsupported` carries the reason the set cannot be drawn yet, so the tile says which scheme is missing
 * rather than going blank - the gallery stays honest about what it does not cover.
 */
export interface SetTile {
    id: number;
    /** `ANIMATE.IDS`'s name where it has one, else the `ANISND.IDS` code, else the id in hex. */
    label: string;
    /** The prefix the set draws under at its lowest armour level, for the tile's thumbnail. */
    resref: string | undefined;
    unsupported: string | undefined;
}

export type HostToWebview =
    /**
     * `note` explains an EMPTY list when the reason is not "this corpus has no pictures" - no game open, no
     * folder open. Without it both states read as "there is nothing here", which sends the reader looking for
     * missing art instead of opening the thing they have not opened.
     */
    | {
          type: "init";
          source: "game" | "workspace";
          title: string;
          items: GalleryTile[];
          note?: string;
          /** Empty when the panel has no game behind it, which is what hides the tab strip. */
          sets: SetTile[];
      }
    /** `dataUri` absent means the item cannot be drawn - the tile keeps its box and shows its label. */
    | { type: "thumbnail"; id: string; dataUri?: string };

export type WebviewToHost =
    | { type: "ready" }
    /** Only what the viewport needs, so opening a game-wide grid does not decode thousands of files. */
    | { type: "requestThumbnails"; ids: string[]; size: number }
    | { type: "open"; id: string }
    /** Open the BAM a set draws at its lowest armour level - the same effect as opening a file tile. */
    | { type: "openSet"; id: number }
    /** Posted by `installFatalErrorHandler` (webview-utils.ts) so a throw in the panel is not a blank window. */
    | { type: "runtimeError"; message: string; stack?: string };
