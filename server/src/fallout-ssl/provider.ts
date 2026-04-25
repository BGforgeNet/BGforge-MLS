/**
 * Fallout SSL language provider.
 * Implements all Fallout SSL file features in one place.
 *
 * Uses unified Symbols storage for static completion and hover data.
 * Header-based symbols (procedures, macros from .h files) are handled by header-parser.
 * Local symbols (current file) are built with language-specific formatters
 * in local-symbols.ts, following the same pattern as TP2.
 */

import { promises as fsPromises } from "node:fs";
import { fileURLToPath } from "node:url";
import {
    type CancellationToken,
    type CompletionItem,
    type DocumentSymbol,
    type FoldingRange,
    type Location,
    type Position,
    type SignatureHelp,
    type SymbolInformation,
    type WorkspaceEdit,
} from "vscode-languageserver/node";
import type { NormalizedUri } from "../core/normalized-uri";
import { type IndexedSymbol, SourceType } from "../core/symbol";
import { conlog, errorMessage, getLinePrefix } from "../common";
import { EXT_FALLOUT_SSL_ALL, LANG_FALLOUT_SSL } from "../core/languages";
import { isHeaderFile } from "../core/location-utils";
import { FileIndex } from "../core/file-index";
import { loadStaticSymbols } from "../core/static-loader";
import { compile as falloutCompile } from "./compiler";
import {
    type FormatResult,
    type LanguageProvider,
    type ProviderContext,
    type ProviderBase,
    type FormattingCapability,
    type SymbolCapability,
    type FoldingCapability,
    type NavigationCapability,
    type RenameCapability,
    type CompletionCapability,
    type DataCapability,
    type CompilationCapability,
    type IndexingCapability,
    type FeatureGateCapability,
    type SemanticTokenCapability,
    type WorkspaceSymbolCapability,
} from "../language-provider";
import { formatWithValidation } from "../shared/provider-helpers";
import { getJsdocCompletions } from "../shared/jsdoc-completions";
import { FALLOUT_JSDOC_TYPES } from "../shared/fallout-types";
import { stripCommentsFalloutSsl, formatFalloutSsl as formatAst } from "@bgforge/format";
import { getFormatOptions } from "../shared/format-options";
import * as signature from "../shared/signature";
import { initParser, isInitialized, parseWithCache } from "./parser";
import { createFoldingRangesProvider } from "../shared/folding-ranges";
import { getDocumentSymbols } from "./symbol";
import { getLocalDefinition } from "./definition";
import { findReferences } from "./references";
import { renameSymbol, prepareRenameSymbol, renameSymbolWorkspace, prepareRenameSymbolWorkspace } from "./rename";
import { getLocalSignature } from "./signature";
import { parseFile } from "./header-parser";
import { getLocalSymbols, lookupLocalSymbol, clearLocalSymbolsCache } from "./local-symbols";
import { getSslCompletionContext, SslCompletionContext, isSslDeclarationSite } from "./completion-context";
import { SyntaxType } from "./tree-sitter.d";
import { getSemanticTokenSpans } from "./semantic-tokens";
import type { SemanticTokenSpan } from "../shared/semantic-tokens";

/** SSL block-level node types for code folding. */
const SSL_FOLDABLE_TYPES = new Set([
    SyntaxType.Procedure,
    SyntaxType.IfStmt,
    SyntaxType.WhileStmt,
    SyntaxType.ForStmt,
    SyntaxType.ForeachStmt,
    SyntaxType.SwitchStmt,
    SyntaxType.Block,
]);

const sslFoldingRanges = createFoldingRangesProvider(isInitialized, parseWithCache, SSL_FOLDABLE_TYPES);

class FalloutSslProvider
    implements
        ProviderBase,
        FormattingCapability,
        SymbolCapability,
        FoldingCapability,
        NavigationCapability,
        RenameCapability,
        CompletionCapability,
        DataCapability,
        CompilationCapability,
        IndexingCapability,
        FeatureGateCapability,
        SemanticTokenCapability,
        WorkspaceSymbolCapability
{
    readonly id = LANG_FALLOUT_SSL;
    readonly indexExtensions = [...EXT_FALLOUT_SSL_ALL];

    private fileIndex: FileIndex | undefined;
    private staticSignatures: signature.SigMap | undefined;
    private storedContext: ProviderContext | undefined;

    private lookupFallbackSymbol(name: string, currentUri?: string): IndexedSymbol | undefined {
        return this.fileIndex?.symbols
            .lookupAll(name)
            .find((symbol) => symbol.source.type !== SourceType.Navigation && symbol.source.uri !== currentUri);
    }

    async init(context: ProviderContext): Promise<void> {
        this.storedContext = context;

        await initParser();

        this.fileIndex = new FileIndex();
        const staticSymbols = loadStaticSymbols(LANG_FALLOUT_SSL);
        this.fileIndex.loadStatic(staticSymbols);

        this.staticSignatures = signature.loadStatic(LANG_FALLOUT_SSL);

        conlog(`Fallout SSL provider initialized with ${staticSymbols.length} static symbols`);
    }

    /**
     * Read file text, preferring open document buffers over disk.
     * Returns null if the file cannot be read.
     */
    private async readFileText(uri: string): Promise<string | null> {
        // Try open document buffer first
        const bufferText = this.storedContext?.getDocumentText?.(uri);
        if (bufferText !== undefined) {
            return bufferText;
        }

        try {
            return await fsPromises.readFile(fileURLToPath(uri), "utf-8");
        } catch (err) {
            conlog(`readFileText: failed to read ${uri}: ${errorMessage(err)}`, "warn");
            return null;
        }
    }

    resolveSymbol(name: string, text: string, uri: string): IndexedSymbol | undefined {
        const version = this.storedContext?.getDocumentVersion?.(uri);
        const local = lookupLocalSymbol(name, text, version, uri);
        if (local) {
            conlog(`resolveSymbol: name="${name}" uri="${uri}" local=found`, "debug");
            return local;
        }
        // Guard the expensive getLocalSymbols call behind the debug flag directly.
        if (this.storedContext?.settings.debug) {
            const allLocal = getLocalSymbols(text, version, uri);
            conlog(
                `resolveSymbol: name="${name}" uri="${uri}" local=not found; local symbols: [${allLocal.map((s) => s.name).join(", ")}]`,
                "debug",
            );
        }
        const fallback = this.lookupFallbackSymbol(name, uri);
        conlog(`resolveSymbol: fallback=${fallback ? "found" : "not found"}`, "debug");
        return fallback;
    }

    format(text: string, uri: string): FormatResult {
        return formatWithValidation({
            text,
            uri,
            languageName: "SSL",
            isInitialized,
            parse: parseWithCache,
            formatAst: (rootNode, options) => formatAst(rootNode, options),
            getFormatOptions,
            stripComments: stripCommentsFalloutSsl,
        });
    }

    symbols(text: string): DocumentSymbol[] {
        if (!isInitialized()) {
            return [];
        }
        return getDocumentSymbols(text);
    }

    foldingRanges(text: string): FoldingRange[] {
        return sslFoldingRanges(text);
    }

    definition(text: string, position: Position, uri: string): Location | null {
        if (!isInitialized()) {
            return null;
        }
        return getLocalDefinition(text, uri, position);
    }

    references(
        text: string,
        position: Position,
        uri: string,
        includeDeclaration: boolean,
        _token: CancellationToken,
    ): Location[] {
        if (!isInitialized()) {
            return [];
        }
        // Single-file AST traversal — bounded work; no per-iteration cancellation needed.
        return findReferences(text, position, uri, includeDeclaration, this.fileIndex?.refs);
    }

    filterCompletions(
        items: CompletionItem[],
        text: string,
        position: Position,
        uri: string,
        triggerCharacter?: string,
    ): CompletionItem[] {
        const context = getSslCompletionContext(text, position);

        if (context === SslCompletionContext.Comment) {
            return [];
        }
        if (context === SslCompletionContext.Jsdoc) {
            return getJsdocCompletions(FALLOUT_JSDOC_TYPES, getLinePrefix(text, position));
        }

        if (triggerCharacter === "@") {
            return [];
        }

        // At declaration sites (e.g. procedure <name>, variable <name>, #define <name>),
        // the user is naming a new symbol — completions are not useful.
        if (isSslDeclarationSite(text, position)) {
            return [];
        }

        // Merge local symbols into completions (local takes precedence)
        const version = this.storedContext?.getDocumentVersion?.(uri);
        const localSymbols = getLocalSymbols(text, version, uri);
        const localLabels = new Set(localSymbols.map((s) => s.name));
        const filtered = items.filter((item) => !localLabels.has(item.label as string));
        return [...localSymbols.map((s) => s.completion), ...filtered];
    }

    shouldProvideFeatures(text: string, position: Position): boolean {
        const context = getSslCompletionContext(text, position);
        return context === SslCompletionContext.Code;
    }

    localSignature(text: string, symbol: string, paramIndex: number): SignatureHelp | null {
        if (!isInitialized()) {
            return null;
        }
        return getLocalSignature(text, symbol, paramIndex);
    }

    semanticTokens(text: string, _uri: string): SemanticTokenSpan[] {
        return getSemanticTokenSpans(text);
    }

    prepareRename(
        text: string,
        position: Position,
    ): { range: { start: Position; end: Position }; placeholder: string } | null {
        if (!isInitialized()) {
            return null;
        }

        // Try workspace-aware prepare first (allows renaming header-defined symbols)
        if (this.fileIndex) {
            const wsResult = prepareRenameSymbolWorkspace(
                text,
                position,
                this.fileIndex.symbols,
                this.storedContext?.workspaceRoot,
            );
            if (wsResult) {
                return wsResult;
            }
        }

        // Fall back to single-file prepare (local variables, params)
        return prepareRenameSymbol(text, position);
    }

    async rename(text: string, position: Position, newName: string, uri: string): Promise<WorkspaceEdit | null> {
        if (!isInitialized()) {
            return null;
        }

        // Try workspace-wide rename first (for symbols defined in headers)
        if (this.fileIndex) {
            conlog(`rename: trying workspace rename for "${newName}" at ${uri}`, "debug");
            const wsResult = await renameSymbolWorkspace(
                text,
                position,
                newName,
                uri,
                this.fileIndex.refs,
                this.fileIndex.symbols,
                (fileUri) => this.readFileText(fileUri),
                this.storedContext?.workspaceRoot,
            );
            if (wsResult) {
                conlog(`rename: workspace rename succeeded`, "debug");
                return wsResult;
            }
            conlog(`rename: workspace rename returned null, falling back to single-file`, "debug");
        } else {
            conlog(`rename: no fileIndex, using single-file rename`, "debug");
        }

        // Fall back to single-file rename (local variables, params)
        const result = renameSymbol(text, position, newName, uri);
        conlog(`rename: single-file rename ${result ? "succeeded" : "returned null"}`, "debug");
        return result;
    }

    getCompletions(uri: string): CompletionItem[] {
        return this.fileIndex
            ? this.fileIndex.symbols.query({ excludeUri: uri }).map((s: IndexedSymbol) => s.completion)
            : [];
    }

    getSignature(_uri: string, symbolName: string, paramIndex: number): SignatureHelp | null {
        if (this.staticSignatures) {
            const sig = this.staticSignatures.get(symbolName);
            if (sig) {
                return signature.getResponse(sig, paramIndex);
            }
        }
        const symbol = this.fileIndex?.symbols.lookup(symbolName);
        if (symbol?.signature) {
            return signature.getResponse(symbol.signature, paramIndex);
        }
        return null;
    }

    getSymbolDefinition(symbolName: string): Location | null {
        const symbol = this.lookupFallbackSymbol(symbolName);
        return symbol?.location ?? null;
    }

    reloadFileData(uri: string, text: string): void {
        if (isInitialized() && this.fileIndex) {
            const st = isHeaderFile(uri) ? SourceType.Workspace : SourceType.Navigation;
            const result = parseFile(uri, text, this.storedContext?.workspaceRoot, st);
            // uri is guaranteed normalized by the ProviderRegistry gateway
            this.fileIndex.updateFile(uri as NormalizedUri, result);
        }
    }

    onWatchedFileDeleted(uri: string): void {
        // uri is guaranteed normalized by the ProviderRegistry gateway
        this.fileIndex?.removeFile(uri as NormalizedUri);
    }

    workspaceSymbols(query: string, token: CancellationToken): SymbolInformation[] {
        return this.fileIndex?.symbols.searchWorkspaceSymbols(query, 500, token) ?? [];
    }

    onDocumentClosed(uri: string): void {
        clearLocalSymbolsCache(uri);
    }

    async compile(uri: string, text: string, interactive: boolean): Promise<void> {
        if (!this.storedContext) {
            conlog("Fallout SSL provider not initialized, cannot compile");
            return;
        }
        // uri is guaranteed normalized by the ProviderRegistry gateway
        await falloutCompile(uri as NormalizedUri, this.storedContext.settings.falloutSSL, interactive, text);
    }
}

export const falloutSslProvider: LanguageProvider = new FalloutSslProvider();
