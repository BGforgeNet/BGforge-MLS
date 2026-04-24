/**
 * Shared tree-sitter parser factory.
 * Creates parser modules for different grammars with optional caching.
 */

import { Parser, Language, Tree } from "web-tree-sitter";
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

/** Default maximum cache entries */
const DEFAULT_MAX_CACHE_SIZE = 10;

/**
 * Creates a cached parser module that wraps a regular parser module.
 * Caches parsed trees by text content hash to avoid redundant parsing.
 *
 * @param wasmFileName - Name of the grammar WASM file (e.g., "tree-sitter-baf.wasm")
 * @param name - Human-readable name for error messages
 * @param maxCacheSize - Maximum number of cached trees (default: 10)
 */
export function createCachedParserModule(
    wasmFileName: string,
    name: string,
    maxCacheSize: number = DEFAULT_MAX_CACHE_SIZE,
): CachedParserModule {
    const base = createParserModule(wasmFileName, name);

    const cache = new QuickLRU<string, Tree>({ maxSize: maxCacheSize });

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

        invalidateCache(text?: string): void {
            if (text === undefined) {
                cache.clear();
            } else {
                cache.delete(text);
            }
        },
    };
}
