/**
 * Unified tree-sitter parser manager.
 *
 * Centralizes parser creation, sequential initialization (required by
 * web-tree-sitter's shared TRANSFER_BUFFER), and per-language caching.
 * Providers access parsers through this manager instead of owning their
 * own parser module instances.
 */

import type { Parser, Tree } from "web-tree-sitter";
import { createCachedParserModule } from "../shared/parser-factory";
import { conlog } from "../common";

/** Per-language cached parser module, stored internally by the manager. */
interface ManagedParser {
    readonly langId: string;
    readonly name: string;
    readonly module: ReturnType<typeof createCachedParserModule>;
}

class ParserManager {
    private readonly parsers = new Map<string, ManagedParser>();

    /**
     * Register a language parser with its WASM grammar file.
     * Safe to call multiple times — subsequent calls for the same langId are no-ops.
     */
    register(langId: string, wasmFileName: string, name: string): void {
        if (this.parsers.has(langId)) {
            return;
        }
        const module = createCachedParserModule(wasmFileName, name);
        this.parsers.set(langId, { langId, name, module });
    }

    /**
     * Register and initialize a single parser.
     * Used by per-language parser re-export modules so tests can init parsers
     * without going through the full server startup.
     *
     * Not safe to call concurrently with initAll() — both await Language.load()
     * which races on web-tree-sitter's shared TRANSFER_BUFFER. In practice this
     * is fine: the server calls initAll() once at startup, tests call initOne()
     * per language, and these paths never overlap.
     */
    async initOne(langId: string, wasmFileName: string, name: string): Promise<void> {
        this.register(langId, wasmFileName, name);
        const parser = this.parsers.get(langId)!;
        if (!parser.module.isInitialized()) {
            await parser.module.init();
        }
    }

    /**
     * Initialize all registered parsers sequentially.
     *
     * web-tree-sitter uses a shared TRANSFER_BUFFER for JS/WASM communication
     * (see https://github.com/tree-sitter/tree-sitter/pull/570). When multiple
     * Language.load() calls run concurrently, they race on this buffer and
     * corrupt parser state — parsing returns ERROR nodes for valid input.
     *
     * This method owns the sequential constraint so callers don't need to
     * worry about it.
     */
    async initAll(): Promise<void> {
        // Failures are logged but not re-thrown — matches the existing ProviderRegistry
        // pattern. Providers guard all parser access with isInitialized() checks, so a
        // failed parser degrades gracefully (features return empty results) rather than
        // crashing the server.
        for (const parser of this.parsers.values()) {
            try {
                // Tree-sitter WASM init must be sequential — parallel init
                // causes WASM memory corruption on some runtimes.
                // eslint-disable-next-line no-await-in-loop
                await parser.module.init();
            } catch (error) {
                conlog(`Failed to initialize ${parser.name} parser: ${error}`);
            }
        }
        conlog(`ParserManager: initialized ${this.parsers.size} parsers`);
    }

    /** Check if a specific language parser is initialized. */
    isInitialized(langId: string): boolean {
        return this.parsers.get(langId)?.module.isInitialized() ?? false;
    }

    /** Parse text with caching for a specific language. Throws if unregistered, returns null if not initialized. */
    parseWithCache(langId: string, text: string): Tree | null {
        const parser = this.parsers.get(langId);
        if (!parser) {
            throw new Error(`No parser registered for language: ${langId}`);
        }
        return parser.module.parseWithCache(text);
    }

    /**
     * Get the raw Parser instance for a language.
     * Throws if the parser is not registered or not initialized.
     * Prefer parseWithCache() for normal usage — this is for cases that need
     * direct parser access (e.g., incremental parsing).
     */
    getParser(langId: string): Parser {
        const parser = this.parsers.get(langId);
        if (!parser) {
            throw new Error(`No parser registered for language: ${langId}`);
        }
        return parser.module.getParser();
    }
}

/** Singleton parser manager instance. */
export const parserManager = new ParserManager();
