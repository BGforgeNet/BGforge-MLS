/**
 * The in-memory diagnostic pass runs on every keystroke. That is right for an ordinary script, where the
 * parse is a few ms - but a real installer runs to hundreds of kilobytes, where it is tens of ms of the
 * server's event loop per keystroke, ahead of every other request waiting on it. Large documents coalesce.
 */

import { describe, expect, it, vi } from "vitest";
import { UriDebouncer } from "../../src/core/uri-debouncer";
import { LARGE_DOCUMENT_BYTES, runOrDebounceParse } from "../../src/shared/parse-scheduling";
import type { NormalizedUri } from "../../src/core/normalized-uri";

const URI = "file:///mod/setup.tp2" as NormalizedUri;
const small = "x".repeat(LARGE_DOCUMENT_BYTES - 1);
const large = "x".repeat(LARGE_DOCUMENT_BYTES);

describe("runOrDebounceParse", () => {
    it("runs an ordinary document's pass on the spot, so feedback stays immediate", () => {
        const debouncer = new UriDebouncer<NormalizedUri>(100);
        const run = vi.fn();
        runOrDebounceParse(URI, small, debouncer, run);
        expect(run).toHaveBeenCalledTimes(1);
        expect(debouncer.has(URI)).toBe(false);
        debouncer.dispose();
    });

    it("coalesces a large document's burst of edits into one pass", () => {
        vi.useFakeTimers();
        try {
            const debouncer = new UriDebouncer<NormalizedUri>(100);
            const run = vi.fn();
            for (let i = 0; i < 5; i++) runOrDebounceParse(URI, large, debouncer, run);
            expect(run).not.toHaveBeenCalled(); // nothing runs mid-burst
            vi.advanceTimersByTime(100);
            expect(run).toHaveBeenCalledTimes(1);
            debouncer.dispose();
        } finally {
            vi.useRealTimers();
        }
    });

    it("keys the coalescing per document, so one file's edits cannot swallow another's pass", () => {
        vi.useFakeTimers();
        try {
            const debouncer = new UriDebouncer<NormalizedUri>(100);
            const first = vi.fn();
            const second = vi.fn();
            runOrDebounceParse(URI, large, debouncer, first);
            runOrDebounceParse("file:///mod/other.tp2" as NormalizedUri, large, debouncer, second);
            vi.advanceTimersByTime(100);
            expect(first).toHaveBeenCalledTimes(1);
            expect(second).toHaveBeenCalledTimes(1);
            debouncer.dispose();
        } finally {
            vi.useRealTimers();
        }
    });
});
