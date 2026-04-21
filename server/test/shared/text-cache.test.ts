/**
 * Tests for shared/text-cache.ts — LRU text cache with hash-based invalidation.
 * Covers cache hits, cache misses, null-returning parse functions, LRU eviction,
 * targeted clear, full clear, and the size getter.
 */

import { describe, expect, it, vi } from "vitest";
import { TextCache } from "../../src/shared/text-cache";

describe("shared/text-cache", () => {
    describe("getOrParse()", () => {
        it("calls parse on first access (cache miss)", () => {
            const cache = new TextCache<string>();
            const parse = vi.fn().mockReturnValue("parsed");

            const result = cache.getOrParse("file:///a.ssl", "content", parse);

            expect(parse).toHaveBeenCalledOnce();
            expect(result).toBe("parsed");
        });

        it("returns cached value without calling parse on second access (cache hit)", () => {
            const cache = new TextCache<string>();
            const parse = vi.fn().mockReturnValue("parsed");

            cache.getOrParse("file:///a.ssl", "content", parse);
            const result = cache.getOrParse("file:///a.ssl", "content", parse);

            expect(parse).toHaveBeenCalledOnce();
            expect(result).toBe("parsed");
        });

        it("re-parses when text changes (hash mismatch)", () => {
            const cache = new TextCache<string>();
            const parse = vi.fn().mockReturnValue("parsed");

            cache.getOrParse("file:///a.ssl", "old content", parse);
            cache.getOrParse("file:///a.ssl", "new content", parse);

            expect(parse).toHaveBeenCalledTimes(2);
        });

        it("returns null and does not cache when parse returns null", () => {
            const cache = new TextCache<string>();
            const parse = vi.fn().mockReturnValue(null);

            const result = cache.getOrParse("file:///a.ssl", "content", parse);

            expect(result).toBeNull();
            expect(cache.size).toBe(0);
        });

        it("evicts the oldest entry when cache is at capacity", () => {
            const maxSize = 3;
            const cache = new TextCache<string>(maxSize);
            const parse = vi.fn().mockImplementation((_text: string, uri: string) => `data:${uri}`);

            // Fill cache to capacity
            cache.getOrParse("file:///1.ssl", "c1", parse);
            cache.getOrParse("file:///2.ssl", "c2", parse);
            cache.getOrParse("file:///3.ssl", "c3", parse);
            expect(cache.size).toBe(3);

            // Adding a 4th entry must evict the first
            cache.getOrParse("file:///4.ssl", "c4", parse);
            expect(cache.size).toBe(3);

            // The oldest (1) was evicted; accessing it must call parse again
            parse.mockClear();
            cache.getOrParse("file:///1.ssl", "c1", parse);
            expect(parse).toHaveBeenCalledOnce();
        });

        it("does not evict when cache size is below maximum", () => {
            const cache = new TextCache<number>(10);
            const parse = vi.fn().mockImplementation((_t: string, uri: string) => uri.length);

            cache.getOrParse("file:///a.ssl", "text", parse);
            cache.getOrParse("file:///b.ssl", "text", parse);
            expect(cache.size).toBe(2);
        });
    });

    describe("clear()", () => {
        it("removes the entry for the given URI", () => {
            const cache = new TextCache<string>();
            const parse = vi.fn().mockReturnValue("parsed");

            cache.getOrParse("file:///a.ssl", "content", parse);
            expect(cache.size).toBe(1);

            cache.clear("file:///a.ssl");
            expect(cache.size).toBe(0);
        });

        it("is a no-op when the URI is not cached", () => {
            const cache = new TextCache<string>();
            expect(() => cache.clear("file:///missing.ssl")).not.toThrow();
            expect(cache.size).toBe(0);
        });

        it("forces re-parse after clearing a URI", () => {
            const cache = new TextCache<string>();
            const parse = vi.fn().mockReturnValue("parsed");

            cache.getOrParse("file:///a.ssl", "content", parse);
            cache.clear("file:///a.ssl");
            cache.getOrParse("file:///a.ssl", "content", parse);

            expect(parse).toHaveBeenCalledTimes(2);
        });
    });

    describe("clearAll()", () => {
        it("removes all entries from the cache", () => {
            const cache = new TextCache<string>();
            const parse = vi.fn().mockReturnValue("data");

            cache.getOrParse("file:///a.ssl", "c1", parse);
            cache.getOrParse("file:///b.ssl", "c2", parse);
            expect(cache.size).toBe(2);

            cache.clearAll();
            expect(cache.size).toBe(0);
        });
    });

    describe("size", () => {
        it("returns 0 for an empty cache", () => {
            const cache = new TextCache<string>();
            expect(cache.size).toBe(0);
        });

        it("returns the number of cached entries", () => {
            const cache = new TextCache<string>();
            const parse = vi.fn().mockReturnValue("x");

            cache.getOrParse("file:///a.ssl", "t1", parse);
            expect(cache.size).toBe(1);

            cache.getOrParse("file:///b.ssl", "t2", parse);
            expect(cache.size).toBe(2);
        });
    });
});
