import { getContext, setContext } from "svelte";

/**
 * Fetches the picture behind a resref field, as a `data:` URI. Provided by LayoutRenderer and consumed deep in
 * the field tree via Svelte context - the same arrangement as `resource-list-context`, and for the same reason:
 * the control sits several components below whatever holds the host bridge.
 *
 * Resolves to undefined when the game no longer has the resource or it cannot be drawn; the row keeps its
 * reserved slot either way, so nothing moves.
 */
export type ThumbnailFn = (resref: string, ext: string) => Promise<string | undefined>;

const THUMBNAIL_KEY = Symbol("bin-thumbnail");

export function provideThumbnail(fn: ThumbnailFn): void {
    setContext(THUMBNAIL_KEY, fn);
}

export function useThumbnail(): ThumbnailFn | undefined {
    return getContext<ThumbnailFn | undefined>(THUMBNAIL_KEY);
}
