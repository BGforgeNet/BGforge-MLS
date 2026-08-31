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
import { createCachedParserModule } from "../parser-factory";

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
});
