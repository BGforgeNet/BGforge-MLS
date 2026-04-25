/**
 * Local symbol extraction for WeiDU TP2 files.
 *
 * Converts the current document's AST to IndexedSymbol[] for unified
 * hover/completion/definition handling. This is the bridge between
 * AST-based local analysis and the indexed symbol lookup system.
 *
 * Cached by text hash for performance - same text returns same result.
 * Also maintains a name->symbol map for O(1) lookups.
 *
 * Symbol-building pattern: Delegates to header-parser helpers.
 * Reuses `parseFile()` from header-parser.ts, which internally
 * uses the `functionInfoToSymbol()`/`variableInfoToSymbol()` helpers.
 * This file is a thin caching wrapper — all symbol construction logic
 * lives in header-parser.ts.
 */

import type { IndexedSymbol } from "../core/symbol";
import { TextCache } from "../shared/text-cache";
import { parseFile } from "./header-parser";
import { isInitialized } from "../../../shared/parsers/weidu-tp2";

/** Cached local symbols data: symbols array + name lookup map */
interface LocalSymbolsData {
    symbols: readonly IndexedSymbol[];
    byName: Map<string, IndexedSymbol>;
}

/** LRU cache for local symbols */
const cache = new TextCache<LocalSymbolsData>();

/**
 * Parse document and build local symbols data.
 * Called by cache on miss.
 */
function parseLocalSymbols(text: string, uri: string): LocalSymbolsData | null {
    if (!isInitialized()) {
        return null;
    }

    // parseFile works for ANY TP2 content, not just headers
    // skipPath: true because local symbols don't need file path in hover (it's redundant)
    const { symbols } = parseFile(uri, text, { skipPath: true });

    // Build name lookup map (first definition wins)
    const byName = new Map<string, IndexedSymbol>();
    for (const sym of symbols) {
        if (!byName.has(sym.name)) {
            byName.set(sym.name, sym);
        }
    }

    return { symbols, byName };
}

/**
 * Get all local symbols from the current document.
 *
 * @param text Document text
 * @param version Document version counter (LSP `TextDocument.version`) used as
 *   cache key; pass `undefined` to bypass the cache.
 * @param uri Document URI
 * @returns IndexedSymbol[] for the document, empty array if parsing fails
 */
export function getLocalSymbols(text: string, version: number | undefined, uri: string): readonly IndexedSymbol[] {
    return cache.getOrParse(uri, version, text, parseLocalSymbols)?.symbols ?? [];
}

/**
 * Look up a local symbol by name. O(1) via cached map.
 *
 * @param name Symbol name to find
 * @param text Document text
 * @param version Document version counter (LSP `TextDocument.version`) used as
 *   cache key; pass `undefined` to bypass the cache.
 * @param uri Document URI
 * @returns IndexedSymbol if found locally, undefined otherwise
 */
export function lookupLocalSymbol(
    name: string,
    text: string,
    version: number | undefined,
    uri: string,
): IndexedSymbol | undefined {
    return cache.getOrParse(uri, version, text, parseLocalSymbols)?.byName.get(name);
}

/**
 * Clear cache for a specific URI.
 * Called when a document is closed to free memory.
 */
export function clearLocalSymbolsCache(uri: string): void {
    cache.clear(uri);
}

/**
 * Clear entire cache.
 * Used for testing.
 */
export function clearAllLocalSymbolsCache(): void {
    cache.clearAll();
}
