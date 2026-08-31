/**
 * Unit tests for the cached parser module's tree lifetime.
 *
 * web-tree-sitter ships no FinalizationRegistry, so a Tree's wasm allocation is reclaimed only by an
 * explicit `delete()`. The cache is an LRU, so every text beyond its capacity evicts a tree - and an
 * evicted tree that is never deleted leaks its wasm memory for the life of the process. Measured on the
 * real corpus before this was fixed: ~115 MB unreclaimable after scanning 1700 files, and ~0.92 MB per
 * parse while editing one document, growing without bound.
 *
 * Driven through the real module against the real SSL grammar: the thing under test is what happens to
 * a genuine Tree on eviction, which a stub tree cannot exercise.
 */

import { describe, expect, it, beforeAll } from "vitest";
import type { Tree } from "web-tree-sitter";
import { createCachedParserModule, createParserModule } from "../parser-factory";

/**
 * Count delete() calls on one tree, still performing the real free so the test does not itself
 * leak what it is asserting about. Returns a reader for the count.
 */
function countDeletes(tree: Tree): () => number {
    let deleted = 0;
    const original = tree.delete.bind(tree);
    tree.delete = (): void => {
        deleted++;
        original();
    };
    return () => deleted;
}

/** Small cache so a handful of parses is enough to force eviction. */
const CACHE_SIZE = 2;

function makeModule() {
    return createCachedParserModule("tree-sitter-ssl.wasm", "SSL test", CACHE_SIZE);
}

/** Distinct source texts, so each parse misses the text-keyed cache. */
const source = (n: number): string => `procedure p${n} begin end\n`;

describe("createCachedParserModule tree lifetime", () => {
    let module: ReturnType<typeof makeModule>;

    beforeAll(async () => {
        module = makeModule();
        await module.init();
    });

    it("deletes a tree when the cache evicts it", () => {
        const tree = module.parseWithCache(source(0));
        expect(tree).not.toBeNull();

        const deletes = countDeletes(tree!);

        // QuickLRU is two-generation: fill well past capacity so the first entry is evicted.
        for (let i = 1; i <= CACHE_SIZE * 4; i++) {
            module.parseWithCache(source(i));
        }

        expect(deletes()).toBe(1);
    });

    it("deletes a tree dropped by invalidateCache for one text", () => {
        const text = source(100);
        const tree = module.parseWithCache(text);
        expect(tree).not.toBeNull();

        const deletes = countDeletes(tree!);

        module.invalidateCache(text);

        expect(deletes()).toBe(1);
    });

    it("deletes every tree dropped by a full invalidateCache", () => {
        const texts = [source(200), source(201)];
        const trees = texts.map((t) => module.parseWithCache(t));
        expect(trees.every((t) => t !== null)).toBe(true);

        const deletes = trees.map((tree) => countDeletes(tree!));

        module.invalidateCache();

        expect(deletes.reduce((total, read) => total + read(), 0)).toBe(texts.length);
    });

    it("still returns the cached tree for a repeated text", () => {
        const text = source(300);
        const first = module.parseWithCache(text);
        const second = module.parseWithCache(text);

        expect(second).toBe(first);
    });

    it("drops an invalidate for a text it never cached", () => {
        // The reverse lookup misses, so there is no tree to free - the call still has to be a no-op
        // rather than throwing on the absent entry.
        expect(() => module.invalidateCache(source(400))).not.toThrow();
    });

    it("initialises at most once", async () => {
        // Second init() returns on the already-initialised guard rather than reloading the grammar.
        await module.init();

        expect(module.isInitialized()).toBe(true);
    });

    it("caches nothing when the parser yields no tree", async () => {
        // web-tree-sitter documents a null parse for a parser with no language assigned. Nothing may be
        // cached against that text, or a later parse would take the absent entry as a hit.
        const languageless = createCachedParserModule("tree-sitter-ssl.wasm", "SSL languageless", CACHE_SIZE);
        await languageless.init();
        languageless.getParser().setLanguage(null);

        expect(languageless.parseWithCache(source(500))).toBeNull();
    });

    it("loads a second grammar onto the already-started runtime", async () => {
        // The tree-sitter runtime is process-wide and started by whichever module inits first, so a
        // later module must take the already-started path rather than re-initialising the wasm.
        const baf = createCachedParserModule("tree-sitter-baf.wasm", "BAF test", CACHE_SIZE);
        await baf.init();

        expect(baf.isInitialized()).toBe(true);
        expect(baf.parseWithCache("IF\nTrue()\nTHEN\nRESPONSE #100\nEND\n")).not.toBeNull();
    });
});

describe("parser modules before init", () => {
    it("refuses to hand out a parser", () => {
        const uninitialised = createParserModule("tree-sitter-ssl.wasm", "SSL uninit");

        expect(uninitialised.isInitialized()).toBe(false);
        expect(() => uninitialised.getParser()).toThrow("SSL uninit parser not initialized");
    });

    it("parses nothing through the cache", () => {
        // Returns null rather than throwing: callers treat an uninitialised grammar as "no tree yet".
        const uninitialised = createCachedParserModule("tree-sitter-ssl.wasm", "SSL uninit");

        expect(uninitialised.parseWithCache(source(0))).toBeNull();
    });
});
