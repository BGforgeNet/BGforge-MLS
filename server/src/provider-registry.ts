/**
 * Provider Registry - manages all language providers and routes requests.
 *
 * Central hub for language features: registers providers, initializes them at
 * startup, and routes feature requests to the appropriate provider.
 *
 * URI normalization: All public methods that accept URIs normalize them before
 * passing to providers. See core/normalized-uri.ts.
 *
 * File-watching logic: core/file-watcher-manager.ts
 * Workspace startup indexing: core/workspace-scanner.ts
 */

import type { CancellationToken, SignatureHelp } from "vscode-languageserver/node";
import {
    CompletionItem,
    DocumentSymbol,
    FileChangeType,
    FoldingRange,
    Hover,
    Location,
    Position,
    Range,
    InlayHint,
    SemanticTokens,
    SymbolInformation,
    WorkspaceEdit,
} from "vscode-languageserver/node";
import type { FormatResult, LanguageProvider, ProviderContext } from "./language-provider";
import { HoverResult } from "./language-provider";
import { conlog } from "./common";
import { validLocationOrNull } from "./core/location-utils";
import { normalizeUri } from "./core/normalized-uri";
import { decodeWorkspaceSymbolQuery } from "../../shared/protocol";
import { encodeSemanticTokens } from "./shared/semantic-tokens";
import { FileWatcherManager } from "./core/file-watcher-manager";
import { scanWorkspaceFiles } from "./core/workspace-scanner";

class ProviderRegistry {
    private providers: Map<string, LanguageProvider> = new Map();
    private context: ProviderContext | undefined;
    /** Maps alias language IDs to their parent provider ID */
    private aliases: Map<string, string> = new Map();
    private fileWatcher: FileWatcherManager = new FileWatcherManager();

    register(provider: LanguageProvider): void {
        this.providers.set(provider.id, provider);
        conlog(`Registered provider: ${provider.id}`);
    }

    /** Register an alias language ID that shares data with an existing provider. */
    registerAlias(aliasLangId: string, parentLangId: string): void {
        this.aliases.set(aliasLangId, parentLangId);
        conlog(`Registered alias: ${aliasLangId} -> ${parentLangId}`);
    }

    private resolveLangId(langId: string): string {
        return this.aliases.get(langId) ?? langId;
    }

    /** Initialize all registered providers sequentially (simpler debugging). */
    async init(context: ProviderContext): Promise<void> {
        this.context = context;
        for (const provider of this.providers.values()) {
            try {
                await provider.init(context);
            } catch (error) {
                conlog(`Failed to initialize provider ${provider.id}: ${error}`);
            }
        }
        conlog(`Initialized ${this.providers.size} providers`);
        this.fileWatcher.buildExtensionMap(this.providers.values());
        await scanWorkspaceFiles(this.providers.values(), this, context.workspaceRoot);
    }

    /** Update settings on the shared context so all providers see the change without a reload. */
    updateSettings(settings: ProviderContext["settings"]): void {
        if (this.context) {
            this.context.settings = settings;
        }
    }

    /** Get the initialization context. Throws if not initialized. */
    getContext(): ProviderContext {
        if (!this.context) {
            throw new Error("ProviderRegistry not initialized");
        }
        return this.context;
    }

    /** Get a provider by language ID (resolves aliases). */
    get(langId: string): LanguageProvider | undefined {
        return this.providers.get(this.resolveLangId(langId));
    }
    /** Returns true if a provider (or alias) is registered for the language. */
    has(langId: string): boolean {
        return this.providers.has(this.resolveLangId(langId)) || this.aliases.has(langId);
    }

    /**
     * Check if LSP features should be provided at this position.
     * Returns false when the cursor is in a zone where features should be suppressed
     * (e.g., inside comments). Defaults to true if not implemented by the provider.
     */
    shouldProvideFeatures(langId: string, text: string, position: Position): boolean {
        const provider = this.get(langId);
        if (provider?.shouldProvideFeatures) {
            return provider.shouldProvideFeatures(text, position);
        }
        return true;
    }

    // =========================================================================
    // Feature routing - delegates to appropriate provider
    // =========================================================================

    format(langId: string, text: string, uri: string): FormatResult {
        const normUri = normalizeUri(uri);
        const provider = this.get(langId);
        if (provider?.format) {
            return provider.format(text, normUri);
        }
        return { edits: [] };
    }

    symbols(langId: string, text: string): DocumentSymbol[] {
        const provider = this.get(langId);
        if (provider?.symbols) {
            return provider.symbols(text);
        }
        return [];
    }

    /**
     * Search workspace symbols across all providers.
     * Aggregates results from every provider that implements workspaceSymbols.
     * Returns empty immediately when the token is already cancelled.
     */
    workspaceSymbols(query: string, token: CancellationToken): SymbolInformation[] {
        if (token.isCancellationRequested) {
            return [];
        }

        const decoded = decodeWorkspaceSymbolQuery(query);
        if (decoded.languageId) {
            const provider = this.get(decoded.languageId);
            return provider?.workspaceSymbols?.(decoded.query, token) ?? [];
        }

        const results: SymbolInformation[] = [];
        for (const provider of this.providers.values()) {
            if (provider.workspaceSymbols) {
                results.push(...provider.workspaceSymbols(decoded.query, token));
            }
        }
        return results;
    }

    foldingRanges(langId: string, text: string): FoldingRange[] {
        const provider = this.get(langId);
        if (provider?.foldingRanges) {
            return provider.foldingRanges(text);
        }
        return [];
    }

    definition(langId: string, text: string, position: Position, uri: string): Location | null {
        const normUri = normalizeUri(uri);
        const provider = this.get(langId);
        if (provider?.definition) {
            return provider.definition(text, position, normUri);
        }
        return null;
    }

    references(langId: string, text: string, position: Position, uri: string, includeDeclaration: boolean, token: CancellationToken): Location[] {
        if (token.isCancellationRequested) {
            return [];
        }

        const normUri = normalizeUri(uri);
        const provider = this.get(langId);
        if (provider?.references) {
            return provider.references(text, position, normUri, includeDeclaration, token);
        }
        return [];
    }

    inlayHints(langId: string, text: string, uri: string, range: Range): InlayHint[] {
        const normUri = normalizeUri(uri);
        const provider = this.get(langId);
        if (provider?.inlayHints) {
            return provider.inlayHints(text, normUri, range);
        }
        return [];
    }

    semanticTokens(langId: string, text: string, uri: string): SemanticTokens {
        const normUri = normalizeUri(uri);
        const provider = this.get(langId);
        return encodeSemanticTokens(provider?.semanticTokens?.(text, normUri) ?? []);
    }

    prepareRename(langId: string, text: string, position: Position): { range: { start: Position; end: Position }; placeholder: string } | null {
        const provider = this.get(langId);
        if (provider?.prepareRename) {
            return provider.prepareRename(text, position);
        }
        return null;
    }

    rename(langId: string, text: string, position: Position, newName: string, uri: string): WorkspaceEdit | null {
        const normUri = normalizeUri(uri);
        const provider = this.get(langId);
        if (provider?.rename) {
            return provider.rename(text, position, newName, normUri);
        }
        return null;
    }

    // =========================================================================
    // Data feature routing - lookup from loaded/parsed data
    // =========================================================================

    /**
     * Get completions from headers/static data, then apply context-based filtering.
     * Local symbol merging happens inside each provider's filterCompletions().
     */
    completion(langId: string, text: string, uri: string, position?: Position, triggerCharacter?: string): CompletionItem[] {
        const normUri = normalizeUri(uri);
        const provider = this.get(langId);
        if (!provider) {
            return [];
        }
        const headerItems = provider.getCompletions ? provider.getCompletions(normUri) : [];
        let result = [...headerItems];
        if (provider.filterCompletions && position) {
            result = provider.filterCompletions(result, text, position, normUri, triggerCharacter);
        }
        return result;
    }

    /** AST-based hover for local symbols. Returns HoverResult indicating whether provider handled it. */
    localHover(langId: string, text: string, symbol: string, uri: string, position: Position): HoverResult {
        const normUri = normalizeUri(uri);
        const provider = this.get(langId);
        if (provider?.hover) {
            return provider.hover(text, symbol, normUri, position);
        }
        return HoverResult.notHandled();
    }

    /**
     * Get hover info using unified symbol resolution.
     * provider.resolveSymbol() checks local symbols first, then indexed/static.
     */
    hover(langId: string, uri: string, symbol: string, text?: string): Hover | null {
        const normUri = normalizeUri(uri);
        const provider = this.get(langId);
        if (!provider) {
            return null;
        }
        if (text && provider.resolveSymbol) {
            const resolved = provider.resolveSymbol(symbol, text, normUri);
            if (resolved?.hover) {
                return resolved.hover;
            }
        }
        return null;
    }

    /**
     * Get signature help, trying local first, then headers.
     * Local symbols take precedence.
     */
    signature(langId: string, text: string, uri: string, symbol: string, paramIndex: number): SignatureHelp | null {
        const normUri = normalizeUri(uri);
        const provider = this.get(langId);
        if (!provider) {
            return null;
        }
        if (provider.localSignature) {
            const local = provider.localSignature(text, symbol, paramIndex);
            if (local) {
                return local;
            }
        }
        if (provider.getSignature) {
            return provider.getSignature(normUri, symbol, paramIndex);
        }
        return null;
    }

    symbolDefinition(langId: string, symbol: string): Location | null {
        const provider = this.get(langId);
        if (provider?.getSymbolDefinition) {
            // Validate location to prevent returning empty URIs to VSCode
            return validLocationOrNull(provider.getSymbolDefinition(symbol));
        }
        return null;
    }

    reloadFileData(langId: string, uri: string, text: string): void {
        const normUri = normalizeUri(uri);
        const provider = this.get(langId);
        if (provider?.reloadFileData) {
            provider.reloadFileData(normUri, text);
        }
    }

    // =========================================================================
    // Compilation
    // =========================================================================

    /**
     * Compile a file using the appropriate provider.
     * @returns true if a provider handled the compilation, false otherwise
     */
    async compile(langId: string, uri: string, text: string, interactive: boolean): Promise<boolean> {
        const normUri = normalizeUri(uri);
        const provider = this.get(langId);
        if (provider?.compile) {
            await provider.compile(normUri, text, interactive);
            return true;
        }
        return false;
    }

    // =========================================================================
    // File watching (delegates to FileWatcherManager)
    // =========================================================================

    /** Get watch patterns for LSP registration. */
    getWatchPatterns(): { globPattern: string; kind: number }[] {
        return this.fileWatcher.getWatchPatterns(this.providers.values());
    }

    /** Handle a file change event from the workspace. */
    handleWatchedFileChange(uri: string, changeType: FileChangeType): void {
        this.fileWatcher.handleWatchedFileChange(uri, changeType);
    }

    /** Clear per-document cached data on document close. */
    handleDocumentClosed(langId: string, uri: string): void {
        this.fileWatcher.handleDocumentClosed(langId, uri, this);
    }

    /**
     * Scan workspace for indexed files and reload them through their providers.
     * Called after providers are initialized to populate indices at startup.
     */
    async scanWorkspaceFiles(workspaceRoot: string | undefined): Promise<void> {
        await scanWorkspaceFiles(this.providers.values(), this, workspaceRoot);
    }
}

// Singleton instance
export const registry = new ProviderRegistry();
