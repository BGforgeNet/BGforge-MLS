/**
 * The gallery's thumbnail job, as a pure function of its I/O.
 *
 * Split from `worker.ts` so the decision logic - which format needs what, when a v2 must ask for its pages,
 * what a failure looks like - is testable without starting a worker thread.
 *
 * The host resolves a resource to a locator and the worker does every read: the extension host must not block
 * on archive I/O, and a `Game` handle cannot cross a thread boundary. Every field here is JSON-safe, so no
 * bytes and no live handles ever cross either.
 */
import { type ResourceLocation } from "@bgforge/binary";
import { pvrzResourceName, type PvrzResolver } from "@bgforge/image";
import { requiredPvrzPages, thumbnailDataUri } from "../ie-resources/thumbnails";

/** What a tile needs drawn. `item` is the gallery's own id, echoed back so a reply routes without the view
 *  tracking request ids itself. */
interface ThumbnailJob {
    id: number;
    item: string;
    at: ResourceLocation;
    ext: string;
    size: number;
}

export type GalleryRequest =
    | ({ kind: "thumbnail" } & ThumbnailJob)
    /** The second phase of a BAM v2: the same job, plus where each page it named actually lives. `null` for a
     *  page the game does not have, which is a missing picture rather than an error. */
    | ({ kind: "pages"; pages: Record<string, ResourceLocation | null> } & ThumbnailJob);

export type GalleryResponse =
    /** `dataUri` absent means the resource cannot be drawn - a malformed or over-cap file, not a failure. */
    | { id: number; kind: "thumbnail"; item: string; dataUri?: string }
    | { id: number; kind: "needPages"; item: string; pages: string[] }
    | { id: number; kind: "error"; item: string; message: string };

export interface GalleryIo {
    readBytes(at: ResourceLocation): Uint8Array;
    /**
     * PVRZ page bytes, cached by resource name across items. Optional so a test can supply `readBytes` alone;
     * the real worker supplies it, because a handful of pages back thousands of v2 frames.
     */
    readPage?(name: string, at: ResourceLocation): Uint8Array | undefined;
}

/**
 * Run one job. Never throws: a resource that cannot be read or decoded is one blank tile, not a dead worker,
 * and a game archive is exactly where a malformed file turns up.
 */
export function runJob(request: GalleryRequest, io: GalleryIo): GalleryResponse {
    const { id, item } = request;
    try {
        const bytes = io.readBytes(request.at);
        if (request.kind === "thumbnail") {
            // A v2's pixels live in sibling PVRZ pages the worker cannot locate itself, so it names them and
            // the host answers with a `pages` request carrying a locator for each.
            const pages = requiredPvrzPages(bytes);
            if (pages.length > 0) return { id, kind: "needPages", item, pages };
            return { id, kind: "thumbnail", item, dataUri: thumbnailDataUri(bytes, request.ext, request.size) };
        }
        const resolve: PvrzResolver = (page) => {
            const at = request.pages[pvrzResourceName(page)];
            if (at === undefined || at === null) return;
            return io.readPage?.(pvrzResourceName(page), at) ?? io.readBytes(at);
        };
        return { id, kind: "thumbnail", item, dataUri: thumbnailDataUri(bytes, request.ext, request.size, resolve) };
    } catch (error) {
        return { id, kind: "error", item, message: error instanceof Error ? error.message : String(error) };
    }
}

/**
 * Memoize by name, including misses.
 *
 * `has`, not a truthiness check: a page the game does not have must stay missing rather than being re-read
 * once per frame that references it.
 */
export function makePageCache<T>(load: (name: string) => T): { get(name: string): T } {
    const cache = new Map<string, T>();
    return {
        get(name: string): T {
            if (cache.has(name)) return cache.get(name)!;
            const loaded = load(name);
            cache.set(name, loaded);
            return loaded;
        },
    };
}
