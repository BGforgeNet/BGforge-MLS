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
 * Jobs the worker holds at once. Enough that it never idles while a reply crosses back, and few enough that
 * the queue stays here, where newer requests can go ahead of older ones.
 */
const MAX_IN_FLIGHT = 4;

/**
 * Answers the webview may hold unconfirmed, counting the jobs at the worker that will become answers. Its
 * channel delivers in order and drains slower than a fast scroll fills it, so the excess waits here instead,
 * where the tiles the scroll stopped on can go first; twice the worker's slots keeps it busy meanwhile.
 */
const MAX_UNSEEN = 8;

interface Job {
    item: string;
    key: string;
    size: number;
    at: Locator;
}

/**
 * Dispatches thumbnail work and routes replies back, at most once per (item, stamp, size).
 *
 * The cache is keyed on the source's stamp rather than the bytes: a stamp costs no read, so a re-scroll over
 * a decoded tile costs nothing at all, and an edited workspace file still redraws because its stamp moved.
 *
 * The newest request is served first. The grid asks for each row as it scrolls into view, so a fast scroll
 * leaves a backlog of rows already scrolled past; served in arrival order, the tiles where the reader stopped
 * would wait behind all of them. The backlog is still drawn afterwards, because the grid never asks twice.
 */
export class ThumbnailPump {
    private readonly io: PumpIo;
    private nextId = 1;
    /** Answered items, by cache key. Holds an EMPTY answer for one that could not be drawn, so it is not
     *  retried - hence a key check rather than a truthiness one at every read. */
    private readonly done = new Map<string, Answer>();
    /** At the worker and unanswered, by request id. */
    private readonly inFlight = new Map<number, Job>();
    /** Waiting for a worker slot, one batch per request, oldest first; served from the newest. */
    private readonly queued: Job[][] = [];
    /** Queued or in flight, by cache key - what stops a second scroll asking again for unanswered work. */
    private readonly pending = new Set<string>();
    /** Answers posted and not yet confirmed by the webview. */
    private unseen = 0;

    constructor(io: PumpIo) {
        this.io = io;
    }

    private keyFor(item: string, size: number): string | undefined {
        const stamp = this.io.source.stamp(item);
        return stamp === undefined ? undefined : `${item}|${stamp}|${size}`;
    }

    /** Ask for these items at this size. Already-answered and already-pending items cost nothing. */
    request(items: readonly string[], size: number): void {
        const batch: Job[] = [];
        for (const item of items) {
            const key = this.keyFor(item, size);
            if (key === undefined) {
                // The source cannot find it any more - answer once so the tile stops asking on every scroll.
                this.answer(item, {});
                continue;
            }
            const cached = this.done.get(key);
            if (cached !== undefined) {
                this.answer(item, cached);
                continue;
            }
            if (this.pending.has(key)) continue;
            const at = this.io.source.locate(item);
            if (at === undefined) {
                this.done.set(key, {});
                this.answer(item, {});
                continue;
            }
            this.pending.add(key);
            batch.push({ item, key, size, at });
        }
        if (batch.length > 0) this.queued.push(batch);
        this.dispatch();
    }

    /** Fill the worker's free slots while the webview keeps up, newest batch first and in order within it. */
    private dispatch(): void {
        while (this.inFlight.size < MAX_IN_FLIGHT && this.inFlight.size + this.unseen < MAX_UNSEEN) {
            const batch = this.queued.at(-1);
            if (batch === undefined) return;
            const job = batch.shift()!;
            if (batch.length === 0) this.queued.pop();
            const id = this.nextId++;
            this.inFlight.set(id, job);
            this.io.send({ id, kind: "thumbnail", item: job.item, at: job.at, ext: extOf(job.item), size: job.size });
        }
    }

    /**
     * Route one worker reply. A reply whose id this pump does not hold for that item is ignored: it is from a
     * cleared panel or a pump this one replaced, whose ids started from 1 as well.
     */
    handle(response: GalleryResponse): void {
        const job = this.inFlight.get(response.id);
        if (job?.item !== response.item) return;

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
        this.answer(item, answer);
        // Every settle frees the slot its job held.
        this.dispatch();
    }

    private answer(item: string, answer: Answer): void {
        this.unseen++;
        this.io.post({ type: "thumbnail", id: item, ...answer });
    }

    /** The webview has taken one answer off the channel. */
    seen(): void {
        // Floored: a pump that replaced another on a game change also hears about its predecessor's answers.
        this.unseen = Math.max(0, this.unseen - 1);
        this.dispatch();
    }

    /** The webview (re)loaded, so nothing posted to the one before it will be confirmed. */
    webviewReady(): void {
        this.unseen = 0;
        this.dispatch();
    }
}

/** An item id is `<name>.<ext>` for a game resource and a path for a workspace file; both end in the ext. */
function extOf(item: string): string {
    const dot = item.lastIndexOf(".");
    return dot === -1 ? "" : item.slice(dot + 1).toLowerCase();
}
