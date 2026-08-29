/**
 * When the in-memory diagnostic pass runs for a document edit.
 *
 * The pass is deliberately not debounced for an ordinary script: the parse is a few ms, and instant
 * squiggles ahead of the disk-bound external compiler are the point. That premise holds by size, not
 * everywhere - a real WeiDU installer runs to hundreds of kilobytes, where the same parse is tens of ms
 * of the server's event loop on EVERY keystroke, delaying every other request queued behind it. Measured
 * on `external/infinity-engine/BGT-WeiDU/bgt/bgt.tp2` (443 KB, 12250 lines): 58 ms mean per parse
 * (`server/test/perf/tp2-parse.bench.ts`), against the server's own 50 ms per-request budget.
 *
 * So the remedy is scoped to the documents where the premise fails, rather than slowing feedback for
 * every file.
 */

import type { NormalizedUri } from "../core/normalized-uri";
import type { UriDebouncer } from "../core/uri-debouncer";

/**
 * Document size, in characters, past which the pass is coalesced instead of run per keystroke.
 *
 * At the measured ~7.6 KB/ms parse rate this is around 13 ms of parsing - an ordinary script stays well
 * under it (the largest committed grammar sample is 23 KB), so in practice only real installers debounce.
 */
export const LARGE_DOCUMENT_BYTES = 100_000;

/**
 * Run `pass` now for an ordinary document, or coalesce it per URI for a large one. The debouncer is the
 * caller's, so a save can cancel a pending pass the same way it cancels a pending compile.
 */
export function runOrDebounceParse(
    uri: NormalizedUri,
    text: string,
    debouncer: UriDebouncer<NormalizedUri>,
    pass: () => void,
): void {
    if (text.length < LARGE_DOCUMENT_BYTES) {
        pass();
        return;
    }
    debouncer.schedule(uri, pass);
}
