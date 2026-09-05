/**
 * The gallery panel's host <-> webview contract.
 *
 * Everything here crosses `postMessage`, so every field is structured-clone safe: plain objects, strings and
 * numbers only. Thumbnails arrive as `data:` URIs rather than bytes for the same reason the binary editor's
 * do - an `<img src>` is what the view needs, and a transferred buffer would have to be re-encoded there.
 */

import type { AnimationView } from "../../image-editor/webview/messages";
import type { Facing } from "@bgforge/image";
import type { SetTile } from "@bgforge/animation";

export interface GalleryTile {
    id: string;
    label: string;
    ext: string;
}

/**
 * One animation set, as a tile.
 *
 * Declared beside the code that builds it (`@bgforge/animation`'s `setTile`) rather than here, so the
 * shape has one home; it crosses this channel unchanged, being plain fields only.
 */
export type { SetTile } from "@bgforge/animation";

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

/**
 * One row of the viewer's stance list.
 *
 * `slots` is the band's cycles, which the rose lays out at their compass angles. It crosses as plain
 * objects, like everything else here.
 */
export interface StanceRow {
    label: string;
    resref: string;
    /** Every file the stance draws - four for an oversized creature whose quarters compose into one. */
    parts: string[];
    band: number;
    slots: { seqIndex: number; facing: Facing }[];
}

/** Everything the viewer page draws for one set, resolved by the host against the archive. */
export interface SetDetail {
    id: number;
    title: string;
    /** Armour levels this set declares; one level alone is not a choice and the view hides the control. */
    armours: number[];
    armour: number;
    stances: StanceRow[];
    /** Why the list is empty, when it is - so the page says which rather than looking broken. */
    note?: string;
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
    /** `dataUri` absent means the item cannot be drawn - the tile keeps its box and shows its label.
     *  `directional` says the source is a creature animation, so the picture is ONE frame by design and the
     *  view marks it as such rather than leaving it looking like a still. */
    | { type: "thumbnail"; id: string; dataUri?: string; directional?: boolean }
    /** The facet browser's whole state, sent on open and after every selection change. */
    | { type: "facets"; state: FacetState }
    /** The viewer page's contents, sent when a set is opened and after an armour change. */
    | { type: "setDetail"; detail: SetDetail }
    /**
     * One stance's animation, as the image editor's own view of a file.
     *
     * The whole reading arrives in one message rather than field by field: the page would otherwise paint
     * the new stance's cycles against the previous one's frames. `stance` echoes which row asked, so a
     * slow answer for a row the reader has already moved off is dropped rather than drawn.
     */
    | { type: "stanceAnimation"; stance: number; view: AnimationView };

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
    /** Open the viewer page on one set, at an armour level when the reader has chosen one. */
    | { type: "openSet"; id: number; armour?: number }
    /** Draw one stance of the open set - the host answers with `stanceAnimation`. */
    | { type: "selectStance"; stance: number }
    /** Open the whole set in the animation editor, where it can be played, inspected and saved. */
    | { type: "openSetEditor"; id: number }
    /** Posted by `installFatalErrorHandler` (webview-utils.ts) so a throw in the panel is not a blank window. */
    | { type: "runtimeError"; message: string; stack?: string };
