/**
 * The sizes a thumbnail is encoded at, in CSS pixels before device-pixel scaling.
 *
 * A ladder rather than the exact box size so the cache keys on a handful of values instead of every layout
 * width a panel can take; a caller rounds its box UP to the first step that covers it.
 *
 * Its own module, with no imports: the webview bundle needs the ladder to size its requests, and reaching it
 * through `thumbnails.ts` would pull the whole decoder - and, through the palette sidecar, node's `path` -
 * into a bundle that runs in a browser.
 */
export const TILE_SIZES = [32, 64, 96, 128] as const;
export type TileSize = (typeof TILE_SIZES)[number];
