/**
 * Which tab the gallery shows, and what each one can show.
 *
 * A tab is a view mode WITHIN a source, not a third source: the files tab draws whatever the panel's
 * `GallerySource` lists, and the sets tab draws the open game's animations. So the source union is
 * untouched, and the one thing this has to decide is what happens when a tab has nothing behind it.
 */

export type GalleryTab = "files" | "sets";

export const GALLERY_TABS: readonly GalleryTab[] = ["files", "sets"];

export function tabLabel(tab: GalleryTab): string {
    return tab === "files" ? "Files" : "Animation sets";
}

/**
 * The tab to show, given the one asked for and whether animations are available.
 *
 * Falls back rather than showing an empty sets grid: only a game has animations, so a workspace gallery -
 * and a panel VS Code restored without its state - can be asked for a tab that cannot exist. The files tab
 * always has a source behind it, which is what makes it the fallback.
 */
export function resolveTab(requested: GalleryTab | undefined, hasSets: boolean): GalleryTab {
    return requested === "sets" && hasSets ? "sets" : "files";
}

/** Whether to draw the tab strip at all: one tab is not a choice, and a lone tab reads as a broken control. */
export function showTabStrip(hasSets: boolean): boolean {
    return hasSets;
}
