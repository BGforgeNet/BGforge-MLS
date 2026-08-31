/**
 * Shared tree-sitter parser factory.
 * Creates parser modules for different grammars with optional caching.
 */

import { type Tree, Parser, Language } from "web-tree-sitter";
import * as path from "path";
import * as fs from "fs";
import QuickLRU from "quick-lru";

interface ParserModule {
    init(): Promise<void>;
    getParser(): Parser;
    isInitialized(): boolean;
}

interface CachedParserModule extends ParserModule {
    /** Parse text with caching. Returns cached tree if text unchanged. */
    parseWithCache(text: string): Tree | null;
    /** Invalidate cache for specific text or all entries if text not provided. */
    invalidateCache(text?: string): void;
}

let treeSitterInitialized = false;

async function initTreeSitter(): Promise<void> {
    if (treeSitterInitialized) return;
    const wasmBinary = fs.readFileSync(path.join(__dirname, "web-tree-sitter.wasm"));
    await Parser.init({ wasmBinary });
    treeSitterInitialized = true;
}

/**
 * Creates a parser module for a specific grammar.
 * @param wasmFileName - Name of the grammar WASM file (e.g., "tree-sitter-baf.wasm")
 * @param name - Human-readable name for error messages
 */
export function createParserModule(wasmFileName: string, name: string): ParserModule {
    let parser: Parser | null = null;
    let initialized = false;

    return {
        async init(): Promise<void> {
            if (initialized) return;
            await initTreeSitter();
            parser = new Parser();
            const wasmPath = path.join(__dirname, wasmFileName);
            const language = await Language.load(wasmPath);
            parser.setLanguage(language);
            initialized = true;
        },

        getParser(): Parser {
            if (!parser) {
                throw new Error(`${name} parser not initialized. Call init() first.`);
            }
            return parser;
        },

        isInitialized(): boolean {
            return initialized;
        },
    };
}

/** Default maximum cache entries.
 *
 * Sized for realistic editor workloads: comfortably above a typical set of
 * open tabs plus the header files referenced from each tab. 10 thrashed on
 * any session touching more distinct texts than that; 64 is comfortably
 * above the observed working set. Resident memory scales with this size x avg
 * file size only because every evicted tree is deleted - see the cache below. */
const DEFAULT_MAX_CACHE_SIZE = 64;

/**
 * Creates a cached parser module that wraps a regular parser module.
 * Caches parsed trees by text content hash to avoid redundant parsing.
 *
 * @param wasmFileName - Name of the grammar WASM file (e.g., "tree-sitter-baf.wasm")
 * @param name - Human-readable name for error messages
 * @param maxCacheSize - Maximum number of cached trees (default: 64)
 */
export function createCachedParserModule(
    wasmFileName: string,
    name: string,
    maxCacheSize: number = DEFAULT_MAX_CACHE_SIZE,
): CachedParserModule {
    const base = createParserModule(wasmFileName, name);

    // Keyed by full document text, not URI+version with incremental `tree.edit()`
    // reparsing. Incremental parsing was measured and declined: a full reparse of a
    // typical script averages ~6 ms and a 12250-line TP2 installer ~58 ms
    // (server/test/perf/parser-cache.bench.ts, tp2-parse.bench.ts). At single-digit
    // ms for the common case, the incremental machinery (threading didChange edit
    // ranges through to `oldTree`, tree lifetime management, per-grammar
    // golden-equivalence tests) is not justified by the saving. If large-file
    // keystroke latency is ever a concern, debouncing the tree-sitter validation is
    // the cheaper mitigation than incremental reparsing.
    // A Tree owns a wasm allocation that web-tree-sitter frees only on an explicit delete() - it
    // registers no FinalizationRegistry, so dropping the JS reference reclaims nothing. Every path that
    // removes a tree from this cache therefore deletes it, or the process leaks one tree per distinct
    // text it ever parsed: measured at ~115 MB unreclaimable after a 1700-file workspace scan, and
    // ~0.92 MB per parse while editing a single document, growing linearly with no plateau.
    //
    // Safe because no caller holds a tree across a yield: parseWithCache's result is consumed
    // synchronously at every call site, so a tree cannot be evicted while still in use. A caller that
    // awaits between parsing and reading the tree would break that and must copy what it needs first.
    const cache = new QuickLRU<string, Tree>({
        maxSize: maxCacheSize,
        onEviction: (_text, tree) => tree.delete(),
    });

    return {
        ...base,

        parseWithCache(text: string): Tree | null {
            if (!base.isInitialized()) {
                return null;
            }

            const cached = cache.get(text);
            if (cached) {
                return cached;
            }

            // Parse and cache
            const tree = base.getParser().parse(text);
            if (tree) {
                cache.set(text, tree);
            }
            return tree;
        },

        // QuickLRU fires onEviction for neither delete() nor clear(), so both branches free explicitly.
        invalidateCache(text?: string): void {
            if (text === undefined) {
                for (const [, tree] of cache) {
                    tree.delete();
                }
                cache.clear();
            } else {
                cache.get(text)?.delete();
                cache.delete(text);
            }
        },
    };
}
