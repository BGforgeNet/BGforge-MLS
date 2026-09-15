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

/**
 * Whether the animation surface is on screen - which is NOT the same as something being drawn on it.
 *
 * The sets tab IS that surface, so it mounts empty from the moment the tab opens and the picker above it
 * chooses what goes on the stage; the files tab keeps it only while a selection is still drawn there.
 *
 * One definition because two readers need the same answer and they answer different questions with it: the
 * template decides whether to render it, and the `showing` handler decides whether a first selection needs
 * the ready handshake or will get one from a fresh mount. Read apart, they disagreed - the surface rendered
 * on the empty tab while the handshake still assumed a mount was coming, so the first set chosen there was
 * never asked for and the tab sat idle with the picker showing a name.
 */
export function viewerMounted(tab: GalleryTab, showing: boolean): boolean {
    return showing || tab === "sets";
}
