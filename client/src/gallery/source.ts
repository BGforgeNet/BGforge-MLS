/**
 * What the gallery draws, and where its pictures come from.
 *
 * Two sources exist - an installed game and the open workspace - and the panel knows only this interface, so
 * the grid, the search box and the thumbnail pump are written once rather than once per corpus.
 *
 * No `vscode` import here or in either implementation: revealing an item is the one thing that needs the
 * editor, so it is injected. That keeps the listing and locating logic directly unit-testable.
 */
import { type ResourceLocation } from "@bgforge/binary";

/** Where a resource's bytes physically are. The same shape the worker reads, so the host never re-derives it. */
export type Locator = ResourceLocation;

export interface GalleryItem {
    /** Unique within its source, and the id echoed through the worker so a reply routes back to a tile. */
    id: string;
    /** What the tile shows. A resref for a game item; a workspace-relative path for a file. */
    label: string;
    /** Lowercased, so the decoder's lookup does not have to care what case the source reported. */
    ext: string;
}

export interface GallerySource {
    readonly kind: "game" | "workspace";
    /** Every drawable item, in the order the grid shows them. */
    list(): GalleryItem[];
    locate(id: string): Locator | undefined;
    /**
     * A token that changes when an item's bytes could have changed, for the thumbnail cache key.
     *
     * Derived from the item's IDENTITY and metadata - never by reading its bytes. A content hash would have
     * to read the file to decide whether the read could be skipped, which is the cost the cache exists to
     * avoid. Undefined for an item the source can no longer find.
     */
    stamp(id: string): string | undefined;
    /**
     * Where an auxiliary resource for `forItem` lives - a PVRZ page a BAM v2's pixels are stored in.
     *
     * Separate from `locate` because a page is not a gallery ITEM: it is never listed and never drawn on its
     * own. `forItem` is what a workspace resolves against, where a mod ships its pages beside the `.bam`.
     */
    locateAux(name: string, forItem: string): Locator | undefined;
    /** Show the item where it lives - the resource tree for a game, the Explorer for the workspace. */
    reveal(id: string): Promise<void>;
}
