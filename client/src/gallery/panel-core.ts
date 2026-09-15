/**
 * The gallery host's routing, with no `vscode` in it.
 *
 * The host's whole job during a scroll is: turn an item id into a locator, hand it to the worker, and pass
 * the reply on. It reads no bytes and decodes nothing - that is the point of the worker - so everything here
 * is bookkeeping, and bookkeeping is exactly what silently does too much work if nobody tests it.
 */
import { type GalleryRequest, type GalleryResponse } from "./worker-core";
import { type GallerySource, type Locator } from "./source";
import { type HostToWebview } from "./webview/messages";

export interface PumpIo {
    source: GallerySource;
    /** To the webview. */
    post(message: HostToWebview): void;
    /** To the worker. */
    send(request: GalleryRequest): void;
}

/**
 * What one answered item carries. Empty means it could not be drawn - the same state a tile shows for a file
 * whose type has no picture.
 */
type Answer = { dataUri?: string; directional?: boolean };

/**
 * Dispatches thumbnail work and routes replies back, at most once per (item, stamp, size).
 *
 * The cache is keyed on the source's stamp rather than the bytes: a stamp costs no read, so a re-scroll over
 * a decoded tile costs nothing at all, and an edited workspace file still redraws because its stamp moved.
 */
export class ThumbnailPump {
    private readonly io: PumpIo;
    private nextId = 1;
    /** Answered items, by cache key. Holds an EMPTY answer for one that could not be drawn, so it is not
     *  retried - hence a key check rather than a truthiness one at every read. */
    private readonly done = new Map<string, Answer>();
    /** Dispatched but unanswered, by cache key - what stops a second scroll re-sending in-flight work. */
    private readonly inFlight = new Map<number, { item: string; key: string; size: number }>();
    private readonly pending = new Set<string>();

    constructor(io: PumpIo) {
        this.io = io;
    }

    private keyFor(item: string, size: number): string | undefined {
        const stamp = this.io.source.stamp(item);
        return stamp === undefined ? undefined : `${item}|${stamp}|${size}`;
    }

    /** Ask for these items at this size. Already-answered and already-in-flight items cost nothing. */
    request(items: readonly string[], size: number): void {
        for (const item of items) {
            const key = this.keyFor(item, size);
            if (key === undefined) {
                // The source cannot find it any more - answer once so the tile stops asking on every scroll.
                this.io.post({ type: "thumbnail", id: item });
                continue;
            }
            if (this.done.has(key)) {
                this.io.post({ type: "thumbnail", id: item, ...this.done.get(key) });
                continue;
            }
            if (this.pending.has(key)) continue;
            const at = this.io.source.locate(item);
            if (at === undefined) {
                this.done.set(key, {});
                this.io.post({ type: "thumbnail", id: item });
                continue;
            }
            const id = this.nextId++;
            this.pending.add(key);
            this.inFlight.set(id, { item, key, size });
            this.io.send({ id, kind: "thumbnail", item, at, ext: extOf(item), size });
        }
    }

    /** Route one worker reply. Unknown ids are ignored - a reply from a cleared panel is not an error. */
    handle(response: GalleryResponse): void {
        const job = this.inFlight.get(response.id);
        if (job === undefined) return;

        if (response.kind === "needPages") {
            // Second phase: the worker named the pages, the host resolves each and sends them back. Still no
            // bytes here - a locator per page, and the worker does the reading.
            this.inFlight.delete(response.id);
            const at = this.io.source.locate(job.item);
            if (at === undefined) {
                this.settle(job.key, job.item, {});
                return;
            }
            const pages: Record<string, Locator | null> = {};
            for (const name of response.pages) pages[name] = this.io.source.locateAux(name, job.item) ?? null;
            const id = this.nextId++;
            this.inFlight.set(id, job);
            this.io.send({ id, kind: "pages", item: job.item, at, ext: extOf(job.item), size: job.size, pages });
            return;
        }

        this.inFlight.delete(response.id);
        // An error and an undrawable file reach the tile the same way - as no picture. The difference matters
        // to a log, not to the grid, which has one way to show "nothing here".
        this.settle(
            job.key,
            job.item,
            response.kind === "thumbnail"
                ? { dataUri: response.dataUri, ...(response.directional === true ? { directional: true } : {}) }
                : {},
        );
    }

    private settle(key: string, item: string, answer: Answer): void {
        this.pending.delete(key);
        this.done.set(key, answer);
        this.io.post({ type: "thumbnail", id: item, ...answer });
    }
}

/** An item id is `<name>.<ext>` for a game resource and a path for a workspace file; both end in the ext. */
function extOf(item: string): string {
    const dot = item.lastIndexOf(".");
    return dot === -1 ? "" : item.slice(dot + 1).toLowerCase();
}
