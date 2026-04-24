/**
 * Symbols - Unified storage and query for language symbols.
 *
 * Provides a single source of truth for all LSP features. Symbols are stored
 * per-file with secondary indices for fast lookup by name.
 *
 * Design principles:
 * - File-level granularity: Updates only affect the specified file
 * - Immutable symbols: Stored symbols are never mutated
 * - Scope-aware queries: Respects visibility rules based on scope level
 * - Pre-computed responses: Symbols contain ready-to-return LSP data
 * - Type-safe lookups: Typed methods return narrowed symbol types
 */

import { type CancellationToken, type Location, type SymbolInformation } from "vscode-languageserver/node";
import type { NormalizedUri } from "./normalized-uri";
import {
    type IndexedSymbol,
    type CallableSymbol,
    type VariableSymbol,
    ScopeLevel,
    SourceType,
    SymbolKind,
    isCallableSymbol,
    isVariableSymbol,
    symbolKindToVscodeKind,
} from "./symbol";

// =============================================================================
// Types
// =============================================================================

/**
 * Context for symbol lookup operations.
 * Used for scope resolution when multiple symbols share a name.
 */
interface QueryContext {
    /** URI of the current document */
    uri?: string;

    /** Current position (for function/loop scope resolution) */
    position?: { line: number; character: number };

    /** Name of the containing function/procedure (for scope resolution) */
    containerName?: string;
}

/**
 * Options for query operations.
 */
interface QueryOptions {
    /** Filter by name prefix (case-insensitive) */
    prefix?: string;

    /** Filter by symbol kinds */
    kinds?: readonly SymbolKind[];

    /** Filter to symbols from specific file (static symbols always included) */
    uri?: string;

    /** Exclude symbols from this file (for avoiding duplicates with local completion) */
    excludeUri?: string;

    /** Maximum number of results */
    limit?: number;
}

/**
 * Constructor options for Symbols.
 */
interface SymbolsOptions {
    /**
     * Maximum number of files to retain in the index.
     *
     * When the limit is exceeded the least-recently-updated file is evicted
     * (Map insertion order — mirroring text-cache.ts).  2000 files is a
     * generous upper bound for typical workspaces; keeps memory bounded while
     * allowing large mod projects to stay fully indexed during a session.
     */
    maxFiles?: number;
}

/** Default cap — enough for large workspaces, bounded against runaway growth. */
const DEFAULT_MAX_FILES = 2000;

// =============================================================================
// Symbols
// =============================================================================

/**
 * Unified symbol storage providing lookups and queries for all LSP features.
 *
 * Provides both generic lookups (returning IndexedSymbol union type) and typed lookups
 * (returning narrowed types like CallableSymbol) for type-safe access.
 */
export class Symbols {
    // -------------------------------------------------------------------------
    // Primary storage
    // -------------------------------------------------------------------------

    /** Per-file symbol storage: uri -> symbols (insertion order = LRU order) */
    private readonly files: Map<NormalizedUri, readonly IndexedSymbol[]> = new Map();

    /** Maximum number of files retained; oldest-inserted is evicted on overflow. */
    private readonly maxFiles: number;

    /** Static symbols (built-in, from YAML/JSON) */
    private staticSymbols: readonly IndexedSymbol[] = [];

    // -------------------------------------------------------------------------
    // Secondary indices (for fast lookup)
    // -------------------------------------------------------------------------

    /** Name -> Symbols (multiple symbols can share a name across scopes) */
    private readonly byName: Map<string, IndexedSymbol[]> = new Map();

    /**
     * Materialised flat list of all symbols (file + static, excluding Navigation
     * which is workspace-search-only). Rebuilt lazily on first read after any
     * mutation that could affect its contents.
     *
     * Two hot callers hit this: query({}) from completion handlers (per keystroke)
     * and searchWorkspaceSymbols (per Ctrl+T keystroke). Before this cache, both
     * rebuilt the list on every call by iterating the files Map.
     */
    private allSymbolsCache: IndexedSymbol[] | null = null;

    /**
     * Same as allSymbolsCache but *including* Navigation symbols. Used only by
     * searchWorkspaceSymbols, which surfaces navigation entries.
     */
    private allSymbolsWithNavCache: IndexedSymbol[] | null = null;

    private invalidateAllSymbolsCache(): void {
        this.allSymbolsCache = null;
        this.allSymbolsWithNavCache = null;
    }

    private getAllSymbolsNoNav(): readonly IndexedSymbol[] {
        if (this.allSymbolsCache === null) {
            const flat: IndexedSymbol[] = [];
            for (const symbols of this.files.values()) {
                for (const symbol of symbols) {
                    if (symbol.source.type !== SourceType.Navigation) {
                        flat.push(symbol);
                    }
                }
            }
            flat.push(...this.staticSymbols);
            this.allSymbolsCache = flat;
        }
        return this.allSymbolsCache;
    }

    private getAllSymbolsWithNav(): readonly IndexedSymbol[] {
        if (this.allSymbolsWithNavCache === null) {
            const flat: IndexedSymbol[] = [];
            for (const symbols of this.files.values()) {
                for (const symbol of symbols) flat.push(symbol);
            }
            // Static is not included here — searchWorkspaceSymbols skips it.
            this.allSymbolsWithNavCache = flat;
        }
        return this.allSymbolsWithNavCache;
    }

    constructor(options?: SymbolsOptions) {
        this.maxFiles = options?.maxFiles ?? DEFAULT_MAX_FILES;
    }

    // -------------------------------------------------------------------------
    // Storage operations
    // -------------------------------------------------------------------------

    /**
     * Update all symbols for a file.
     * Replaces any existing symbols for that file.
     *
     * Re-inserting a URI that already exists moves it to the most-recently-used
     * position in the LRU order, so it is not the next eviction candidate.
     * When the file count exceeds maxFiles the least-recently-updated file is
     * removed (Map insertion order, mirroring text-cache.ts).
     */
    updateFile(uri: NormalizedUri, symbols: readonly IndexedSymbol[]): void {
        // Remove old symbols from indices (and from files Map to refresh LRU order)
        this.removeFileFromIndices(uri);
        this.files.delete(uri);

        // Store new symbols (re-insertion moves uri to end = most-recent)
        this.files.set(uri, symbols);

        // Add to indices
        for (const symbol of symbols) {
            this.addToNameIndex(symbol);
        }

        // Evict oldest entry when over capacity (Map.keys() yields insertion order)
        if (this.files.size > this.maxFiles) {
            const oldestKey = this.files.keys().next().value;
            if (oldestKey !== undefined) {
                this.removeFileFromIndices(oldestKey);
                this.files.delete(oldestKey);
            }
        }

        this.invalidateAllSymbolsCache();
    }

    /**
     * Clear all symbols from a file.
     */
    clearFile(uri: NormalizedUri): void {
        this.removeFileFromIndices(uri);
        this.files.delete(uri);
        this.invalidateAllSymbolsCache();
    }

    /**
     * Get all symbols for a specific file.
     * Returns empty array if file not found.
     * Callers must not mutate the returned array (enforced by readonly type).
     */
    getFileSymbols(uri: NormalizedUri): readonly IndexedSymbol[] {
        return this.files.get(uri) ?? [];
    }

    /**
     * Load static (built-in) symbols.
     * Replaces any existing static symbols.
     */
    loadStatic(symbols: readonly IndexedSymbol[]): void {
        // Remove old static symbols from indices
        for (const symbol of this.staticSymbols) {
            this.removeFromNameIndex(symbol);
        }

        // Store new static symbols
        this.staticSymbols = symbols;

        // Add to indices
        for (const symbol of symbols) {
            this.addToNameIndex(symbol);
        }

        this.invalidateAllSymbolsCache();
    }

    // -------------------------------------------------------------------------
    // Generic query operations
    // -------------------------------------------------------------------------

    /**
     * Look up a symbol by exact name.
     * Returns the best match based on scope precedence: document > workspace > static.
     *
     * Use typed lookups (lookupCallable, lookupVariable) when you know the symbol type.
     */
    lookup(name: string, context?: QueryContext): IndexedSymbol | undefined {
        const all = this.lookupAll(name, context);
        return all[0];
    }

    /**
     * Look up definition location for a symbol by name.
     * Returns null for symbols without locations (e.g., static/built-in symbols).
     *
     * Use this for go-to-definition to avoid returning null locations to VSCode.
     */
    lookupDefinition(name: string, context?: QueryContext): Location | null {
        const symbol = this.lookup(name, context);
        return symbol?.location ?? null;
    }

    /**
     * Look up all symbols with exact name.
     * Returns matches sorted by scope precedence (best first), with URI as tiebreaker
     * for deterministic ordering when multiple files define the same symbol.
     *
     * Use for go-to-definition when multiple definitions may exist.
     */
    lookupAll(name: string, context?: QueryContext): IndexedSymbol[] {
        const candidates = this.byName.get(name);
        if (!candidates || candidates.length === 0) {
            return [];
        }

        // Always sort for deterministic ordering:
        // - With context: sort by scope precedence, then URI as tiebreaker
        // - Without context: sort by URI only (alphabetical)
        return [...candidates].sort((a, b) => this.compareScopePrecedence(a, b, context?.uri));
    }

    /**
     * Query symbols with optional filters.
     *
     * TODO: Results are returned in Map insertion order, which can change when files
     * are reloaded. This affects completion list ordering but is low-impact since IDEs
     * sort/filter results anyway. Adding deterministic sorting would hurt performance.
     * See compareScopePrecedence() for how lookup() handles this via URI tiebreaker.
     */
    query(options: QueryOptions): readonly IndexedSymbol[] {
        let results: IndexedSymbol[];

        if (options.excludeUri) {
            // excludeUri requires per-file iteration (the cache is pre-flattened).
            results = [];
            for (const [fileUri, symbols] of this.files) {
                if (fileUri === options.excludeUri) continue;
                for (const symbol of symbols) {
                    if (symbol.source.type !== SourceType.Navigation) {
                        results.push(symbol);
                    }
                }
            }
            results.push(...this.staticSymbols);
        } else {
            results = [...this.getAllSymbolsNoNav()];
        }

        if (options.prefix) {
            const prefix = options.prefix.toLowerCase();
            results = results.filter((s) => s.name.toLowerCase().startsWith(prefix));
        }

        if (options.kinds && options.kinds.length > 0) {
            const kinds = new Set(options.kinds);
            results = results.filter((s) => kinds.has(s.kind));
        }

        if (options.uri) {
            results = results.filter(
                (s) => s.source.uri === options.uri || s.source.type === SourceType.Static,
            );
        }

        if (options.limit && results.length > options.limit) {
            results = results.slice(0, options.limit);
        }

        return results;
    }

    /**
     * Get all symbols visible at a position in a file.
     *
     * Visibility is determined by scope level:
     * - Global (static): Always visible
     * - Workspace (headers): Always visible
     * - File: Only visible in same file
     * - Function: Only visible in same function
     * - Loop: Only visible in same loop
     *
     * For function/loop scope, caller must provide containerName in context.
     *
     * TODO: When multiple headers define the same symbol, which one is returned
     * depends on Map iteration order (file load order). See query() TODO for details.
     * Currently not called by any provider - they use query() + local merge instead.
     */
    getVisibleSymbols(uri: NormalizedUri, context?: QueryContext): readonly IndexedSymbol[] {
        const results: IndexedSymbol[] = [];
        const seen = new Set<string>();

        // 1. File-local symbols (highest precedence)
        const fileSymbols = this.files.get(uri);
        if (fileSymbols) {
            for (const symbol of fileSymbols) {
                if (this.isVisibleInContext(symbol, uri, context)) {
                    if (!seen.has(symbol.name)) {
                        results.push(symbol);
                        seen.add(symbol.name);
                    }
                }
            }
        }

        // 2. Workspace symbols (from headers)
        for (const [fileUri, symbols] of this.files) {
            if (fileUri === uri) continue;

            for (const symbol of symbols) {
                if (symbol.scope.level === ScopeLevel.Workspace) {
                    if (!seen.has(symbol.name)) {
                        results.push(symbol);
                        seen.add(symbol.name);
                    }
                }
            }
        }

        // 3. Static symbols (lowest precedence, but always visible)
        for (const symbol of this.staticSymbols) {
            if (!seen.has(symbol.name)) {
                results.push(symbol);
                seen.add(symbol.name);
            }
        }

        return results;
    }

    // -------------------------------------------------------------------------
    // Typed lookup operations
    // -------------------------------------------------------------------------

    /**
     * Look up a callable symbol (function, procedure, macro, action, trigger) by name.
     * Returns the best match, already narrowed to CallableSymbol type.
     *
     * Use when hovering on a function call like `LPF my_func`.
     */
    lookupCallable(name: string, context?: QueryContext): CallableSymbol | undefined {
        return this.lookupAllCallables(name, context)[0];
    }

    /**
     * Look up all callable symbols with exact name.
     * Returns matches sorted by scope precedence, narrowed to CallableSymbol[].
     *
     * Use for go-to-definition on function calls.
     */
    lookupAllCallables(name: string, context?: QueryContext): CallableSymbol[] {
        return this.lookupAll(name, context).filter((s): s is CallableSymbol => isCallableSymbol(s));
    }

    /**
     * Look up a variable symbol by name.
     * Returns the best match, already narrowed to VariableSymbol type.
     *
     * Use when hovering on a variable reference.
     */
    lookupVariable(name: string, context?: QueryContext): VariableSymbol | undefined {
        return this.lookupAllVariables(name, context)[0];
    }

    /**
     * Look up all variable symbols with exact name.
     * Returns matches sorted by scope precedence, narrowed to VariableSymbol[].
     */
    lookupAllVariables(name: string, context?: QueryContext): VariableSymbol[] {
        return this.lookupAll(name, context).filter((s): s is VariableSymbol => isVariableSymbol(s));
    }

    // -------------------------------------------------------------------------
    // Workspace symbol search (Ctrl+T)
    // -------------------------------------------------------------------------

    /**
     * Search all workspace file symbols by case-insensitive substring match.
     * Includes Navigation, Workspace, Document, and External symbols.
     * Excludes Static (built-in) symbols — those have no navigable source file.
     *
     * Empty query returns all symbols (capped at maxResults).
     * LSP clients perform their own fuzzy filtering on top of these results.
     */
    searchWorkspaceSymbols(query: string, maxResults = 500, token?: CancellationToken): SymbolInformation[] {
        if (token?.isCancellationRequested) return [];

        const lowerQuery = query.toLowerCase();
        const results: SymbolInformation[] = [];
        let iterCount = 0;
        const CANCEL_CHECK_INTERVAL = 16;

        for (const symbol of this.getAllSymbolsWithNav()) {
            if (++iterCount % CANCEL_CHECK_INTERVAL === 0 && token?.isCancellationRequested) {
                return results;
            }

            if (lowerQuery && !symbol.name.toLowerCase().includes(lowerQuery)) continue;
            if (!symbol.location) continue;

            results.push({
                name: symbol.name,
                kind: symbolKindToVscodeKind(symbol.kind),
                containerName: symbol.source.displayPath,
                location: { uri: symbol.location.uri, range: symbol.location.range },
            });

            if (results.length >= maxResults) return results;
        }

        return results;
    }

    // -------------------------------------------------------------------------
    // Private helpers
    // -------------------------------------------------------------------------

    private addToNameIndex(symbol: IndexedSymbol): void {
        const existing = this.byName.get(symbol.name);
        if (existing) {
            existing.push(symbol);
        } else {
            this.byName.set(symbol.name, [symbol]);
        }
    }

    private removeFromNameIndex(symbol: IndexedSymbol): void {
        const existing = this.byName.get(symbol.name);
        if (!existing) return;

        const index = existing.indexOf(symbol);
        if (index !== -1) {
            existing.splice(index, 1);
            if (existing.length === 0) {
                this.byName.delete(symbol.name);
            }
        }
    }

    private removeFileFromIndices(uri: NormalizedUri): void {
        const symbols = this.files.get(uri);
        if (!symbols) return;

        for (const symbol of symbols) {
            this.removeFromNameIndex(symbol);
        }
    }

    /**
     * Compare two symbols by scope precedence.
     * Returns negative if a should come first, positive if b should come first.
     * Uses URI as a tiebreaker for deterministic ordering when scores are equal.
     */
    private compareScopePrecedence(a: IndexedSymbol, b: IndexedSymbol, contextUri?: string): number {
        const scoreA = this.getScopePrecedenceScore(a, contextUri);
        const scoreB = this.getScopePrecedenceScore(b, contextUri);
        const scoreDiff = scoreB - scoreA; // Higher score = higher precedence

        // Use URI as tiebreaker for deterministic ordering
        if (scoreDiff === 0) {
            const uriA = a.source.uri ?? "";
            const uriB = b.source.uri ?? "";
            return uriA.localeCompare(uriB);
        }

        return scoreDiff;
    }

    private getScopePrecedenceScore(symbol: IndexedSymbol, contextUri?: string): number {
        let score = 0;

        // Source type precedence
        // Static (built-in) takes priority over Workspace (headers) because built-in
        // definitions are authoritative, while headers may contain user overrides.
        switch (symbol.source.type) {
            case SourceType.Document:
                score += 1000;
                break;
            case SourceType.Static:
                score += 200;
                break;
            case SourceType.Workspace:
                score += 100;
                break;
            case SourceType.External:
                score += 10;
                break;
        }

        // Same-file bonus
        if (symbol.source.uri === contextUri) {
            score += 500;
        }

        return score;
    }

    /**
     * Check if a symbol is visible in the given context.
     */
    private isVisibleInContext(symbol: IndexedSymbol, uri: string, context?: QueryContext): boolean {
        // Global and workspace symbols are always visible
        if (symbol.scope.level === ScopeLevel.Global || symbol.scope.level === ScopeLevel.Workspace) {
            return true;
        }

        // File-scope symbols are visible within the same file
        if (symbol.scope.level === ScopeLevel.File) {
            return symbol.source.uri === uri;
        }

        // Function-scope symbols need matching container
        if (symbol.scope.level === ScopeLevel.Function) {
            if (!context?.containerName || !symbol.scope.containerId) {
                // Without container info, assume visible at file level
                return symbol.source.uri === uri;
            }
            return symbol.scope.containerId === `${uri}#${context.containerName}`;
        }

        // Only remaining scope after Global, Workspace, File, Function is Loop
        // Loop-scope symbols need matching container
        if (!context?.containerName || !symbol.scope.containerId) {
            return symbol.source.uri === uri;
        }
        return symbol.scope.containerId === `${uri}#${context.containerName}`;
    }
}
