/**
 * The grid's pure decisions: which items a search matches, how they fall into rows, and which of those rows
 * are worth mounting.
 *
 * Separate from the Svelte components so the windowing and filtering can be tested without a DOM - the
 * components are then thin enough that what they add is layout, not logic.
 */
import { visibleRange } from "../../virtual-window";
import { type GalleryTile } from "./messages";

/** Case-insensitive substring over the label. The only search the gallery has. */
export function filterTiles(tiles: readonly GalleryTile[], query: string): GalleryTile[] {
    const needle = query.trim().toLowerCase();
    if (needle === "") return [...tiles];
    return tiles.filter((tile) => tile.label.toLowerCase().includes(needle));
}

/** How many tiles fit across, given the panel's width. At least one, however narrow the panel gets. */
export function columnsFor(viewportWidth: number, tileWidth: number): number {
    return Math.max(1, Math.floor(viewportWidth / tileWidth));
}

export interface GridWindow {
    /** Rows to mount, as index ranges into the filtered list. */
    firstRow: number;
    lastRow: number;
    /** Filtered-list indices of the tiles in those rows - what to ask the host to draw. */
    start: number;
    end: number;
    /** Total scrollable height, so the scrollbar reflects the whole grid and not just what is mounted. */
    totalHeight: number;
}

/**
 * Which slice of the grid to mount and request.
 *
 * Rows are the unit, not tiles: a grid scrolls by row, and windowing per tile would mount partial rows. The
 * shared `visibleRange` does the row arithmetic, so this and the editor lists cannot drift on overscan.
 */
export function gridWindow(input: {
    total: number;
    columns: number;
    rowHeight: number;
    scrollTop: number;
    viewportHeight: number;
    overscan: number;
}): GridWindow {
    const rows = Math.ceil(input.total / input.columns);
    const { start: firstRow, end: lastRow } = visibleRange({
        scrollTop: input.scrollTop,
        viewportHeight: input.viewportHeight,
        rowHeight: input.rowHeight,
        overscan: input.overscan,
        total: rows,
    });
    return {
        firstRow,
        lastRow,
        start: firstRow * input.columns,
        end: Math.min(input.total, lastRow * input.columns),
        totalHeight: rows * input.rowHeight,
    };
}

/**
 * The ladder step to encode at, for a tile drawn `cssPixels` wide on a display with `dpr` device pixels.
 *
 * Rounded UP to a step so the cache keys on a handful of sizes instead of every layout width a panel can
 * take, and capped at the largest step rather than growing without bound on a very dense display.
 */
export function ladderSize(cssPixels: number, dpr: number, ladder: readonly number[]): number {
    const wanted = cssPixels * Math.min(dpr, 2);
    return ladder.find((step) => step >= wanted) ?? ladder[ladder.length - 1]!;
}
