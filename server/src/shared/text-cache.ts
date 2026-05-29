/**
 * Generic FIFO text cache for parsed document data.
 *
 * Caches parsed results by URI with version-based invalidation. Callers pass the
 * LSP `TextDocument.version` (a monotonic per-document counter); a stable version
 * means the document hasn't changed, so the cache hit short-circuits the parse
 * without scanning the text.
 *
 * Eviction is FIFO, not LRU: a cache hit returns without re-inserting, so entries
 * are dropped in insertion order once `maxSize` distinct URIs are held. Entries
 * are one-per-URI and version-invalidated, and both callers keep tiny per-document
 * working sets, so the eviction policy is effectively never exercised - FIFO keeps
 * the implementation a plain insertion-ordered Map with no reordering on read.
 */

/** Cache entry with version and parsed data */
interface CacheEntry<T> {
    version: number;
    data: T;
}

/** Default maximum cache entries */
const DEFAULT_MAX_SIZE = 50;

/**
 * Generic FIFO cache for text-based parsing results (see file header for why
 * the eviction policy is insertion-order rather than LRU).
 *
 * @typeParam T - The type of parsed data to cache
 */
export class TextCache<T> {
    private readonly cache = new Map<string, CacheEntry<T>>();
    private readonly maxSize: number;

    constructor(maxSize: number = DEFAULT_MAX_SIZE) {
        this.maxSize = maxSize;
    }

    /**
     * Get cached data or parse and cache new data.
     *
     * @param uri Document URI (cache key)
     * @param version Document version counter (cache validation key - usually
     *   `TextDocument.version`). When `undefined` the cache is bypassed: parse
     *   runs on every call and nothing is stored. Lets callers without access
     *   to a real document version (tests, ad-hoc parses) avoid stale-cache hits
     *   without changing the signature for real callers.
     * @param text Document text (passed to `parse` on a cache miss)
     * @param parse Function to parse text into data (called on cache miss)
     * @returns Parsed data, or null if parse returns null
     */
    getOrParse(
        uri: string,
        version: number | undefined,
        text: string,
        parse: (text: string, uri: string) => T | null,
    ): T | null {
        if (version === undefined) {
            return parse(text, uri);
        }

        // Check cache
        const cached = this.cache.get(uri);
        if (cached && cached.version === version) {
            return cached.data;
        }

        // Parse
        const data = parse(text, uri);
        if (data === null) {
            return null;
        }

        // Evict oldest if at capacity (Map maintains insertion order)
        if (this.cache.size >= this.maxSize) {
            const oldestKey = this.cache.keys().next().value;
            if (oldestKey !== undefined) {
                this.cache.delete(oldestKey);
            }
        }

        this.cache.set(uri, { version, data });
        return data;
    }

    /** Clear cache for a specific URI. */
    clear(uri: string): void {
        this.cache.delete(uri);
    }

    /** Clear entire cache. */
    clearAll(): void {
        this.cache.clear();
    }

    /** Get cache size (for testing/debugging). */
    get size(): number {
        return this.cache.size;
    }
}
