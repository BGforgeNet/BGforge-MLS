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

/**
 * The five facet controls.
 *
 * The first three re-resolve WHICH animation is selected; the last two pick a file within it - one union
 * because the view sends them through one message and the host answers all five together.
 */
export type FacetFamily = "race" | "gender" | "charClass" | "armour" | "action";

/** One option of a facet control, as the webview draws it. Disabled options keep their reason. */
export interface FacetOption {
    value: string;
    label: string;
    available: boolean;
    reason?: string;
}

/**
 * Everything the facet browser draws, resolved by the host.
 *
 * The host resolves rather than the webview because availability is decided against files in the archive,
 * which only the host can see. The webview holds a selection and renders this answer.
 */
export interface FacetState {
    selection: { race: string; gender: string; charClass: string; armour: number; action: string };
    races: FacetOption[];
    genders: FacetOption[];
    classes: FacetOption[];
    armours: FacetOption[];
    /** Only the actions this set actually ships at this armour level. */
    actions: FacetOption[];
    /** The file the selection resolves to, or undefined with `unavailable` saying why. */
    resref: string | undefined;
    unavailable: string | undefined;
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
          /**
           * The animation the panel was opened ON - a link from a creature's animation field.
           *
           * Opens the sets tab and marks the row. Present even for an id this install names nothing for:
           * the browser saying it has no such animation is the answer to that click, and a link that
           * quietly did nothing would not be.
           */
          focusSet?: number;
      }
    /** `dataUri` absent means the item cannot be drawn - the tile keeps its box and shows its label. */
    | { type: "thumbnail"; id: string; dataUri?: string }
    /** The facet browser's whole state, sent on open and after every selection change. */
    | { type: "facets"; state: FacetState };

export type WebviewToHost =
    | { type: "ready" }
    /** Only what the viewport needs, so opening a game-wide grid does not decode thousands of files. */
    | { type: "requestThumbnails"; ids: string[]; size: number }
    | { type: "open"; id: string }
    /**
     * Open a BAM by resref.
     *
     * One message for both entry points - a set row and the facet browser's resolved file - so the two
     * cannot drift into opening resources by different routes.
     */
    | { type: "openResref"; resref: string }
    /** A facet control changed; the host re-resolves and answers with a whole `FacetState`. */
    | { type: "selectFacet"; family: FacetFamily; value: string }
    /** Posted by `installFatalErrorHandler` (webview-utils.ts) so a throw in the panel is not a blank window. */
    | { type: "runtimeError"; message: string; stack?: string };
