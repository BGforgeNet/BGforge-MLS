/**
 * WeiDU D language provider.
 * Implements all D file features in one place.
 *
 * Uses unified Symbols storage for completion and hover data.
 */

import type {
    CancellationToken,
    CompletionItem,
    DocumentSymbol,
    FoldingRange,
    Location,
    Position,
    SymbolInformation,
} from "vscode-languageserver/node";
import { conlog } from "../common";
import type { NormalizedUri } from "../core/normalized-uri";
import { EXT_WEIDU_D, LANG_WEIDU_D } from "../core/languages";
import { type IndexedSymbol, SourceType } from "../core/symbol";
import { FileIndex } from "../core/file-index";
import { loadStaticSymbols } from "../core/static-loader";
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
    type HoverCapability,
    type CompletionCapability,
    type DataCapability,
    type CompilationCapability,
    type IndexingCapability,
    type FeatureGateCapability,
    type WorkspaceSymbolCapability,
} from "../language-provider";
import { stripCommentsWeidu, formatWeiduD as formatAst } from "@bgforge/format";
import { getFormatOptions } from "../shared/format-options";
import { resolveSymbolStatic, getStaticCompletions, formatWithValidation } from "../shared/provider-helpers";
import { isInsideComment } from "./ast-utils";
import { parseFile } from "./file-parser";
import { getDefinition } from "./definition";
import { getStateLabelHover } from "./hover";
import { findReferences } from "./references";
import { prepareRenameSymbol, renameSymbol } from "./rename";
import { initParser, parseWithCache, isInitialized } from "./parser";
import { getDocumentSymbols } from "./symbol";
import { compile as weiduCompile } from "../weidu-compile";
import { createFoldingRangesProvider } from "../shared/folding-ranges";
import { SyntaxType } from "./tree-sitter.d";

/** D block-level node types for code folding. */
const D_FOLDABLE_TYPES = new Set([
    SyntaxType.BeginAction,
    SyntaxType.AppendAction,
    SyntaxType.ChainAction,
    SyntaxType.ExtendAction,
    SyntaxType.InterjectAction,
    SyntaxType.InterjectCopyTrans,
    SyntaxType.ReplaceAction,
    SyntaxType.State,
    SyntaxType.Transition,
]);

const dFoldingRanges = createFoldingRangesProvider(isInitialized, parseWithCache, D_FOLDABLE_TYPES);

class WeiduDProvider
    implements
        ProviderBase,
        FormattingCapability,
        SymbolCapability,
        FoldingCapability,
        NavigationCapability,
        RenameCapability,
        HoverCapability,
        CompletionCapability,
        DataCapability,
        CompilationCapability,
        IndexingCapability,
        FeatureGateCapability,
        WorkspaceSymbolCapability
{
    readonly id = LANG_WEIDU_D;
    readonly indexExtensions = [EXT_WEIDU_D];

    private fileIndex: FileIndex | undefined;
    private storedContext: ProviderContext | undefined;

    async init(context: ProviderContext): Promise<void> {
        this.storedContext = context;

        await initParser();

        this.fileIndex = new FileIndex();
        const staticSymbols = loadStaticSymbols(LANG_WEIDU_D);
        this.fileIndex.loadStatic(staticSymbols);

        conlog(`WeiDU D provider initialized with ${staticSymbols.length} static symbols`);
    }

    shouldProvideFeatures(text: string, position: Position): boolean {
        return !isInsideComment(text, position);
    }

    // D files have state labels for navigation, but data-driven hover/completion
    // should remain static-only (YAML data: actions + triggers).
    resolveSymbol(name: string, _text: string, _uri: string): IndexedSymbol | undefined {
        const symbol = resolveSymbolStatic(name, this.fileIndex?.symbols);
        return symbol?.source.type === SourceType.Static ? symbol : undefined;
    }

    format(text: string, uri: string): FormatResult {
        return formatWithValidation({
            text,
            uri,
            languageName: "D",
            isInitialized,
            parse: parseWithCache,
            formatAst: (rootNode, options) => formatAst(rootNode, options),
            getFormatOptions,
            stripComments: stripCommentsWeidu,
        });
    }

    symbols(text: string): DocumentSymbol[] {
        return getDocumentSymbols(text);
    }

    foldingRanges(text: string): FoldingRange[] {
        return dFoldingRanges(text);
    }

    definition(text: string, position: Position, uri: string): Location | null {
        return getDefinition(text, uri, position);
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

    prepareRename(text: string, position: Position) {
        return prepareRenameSymbol(text, position);
    }

    async rename(text: string, position: Position, newName: string, uri: string) {
        return renameSymbol(text, position, newName, uri);
    }

    hover(text: string, symbol: string, uri: string, position: Position) {
        return getStateLabelHover(text, symbol, uri, position);
    }

    getCompletions(_uri: string): CompletionItem[] {
        return getStaticCompletions(this.fileIndex?.symbols);
    }

    workspaceSymbols(query: string, token: CancellationToken): SymbolInformation[] {
        return this.fileIndex?.symbols.searchWorkspaceSymbols(query, 500, token) ?? [];
    }

    reloadFileData(uri: string, text: string): void {
        if (isInitialized() && this.fileIndex) {
            const result = parseFile(uri, text, this.storedContext?.workspaceRoot);
            // uri is guaranteed normalized by the ProviderRegistry gateway
            this.fileIndex.updateFile(uri as NormalizedUri, result);
        }
    }

    onWatchedFileDeleted(uri: string): void {
        // uri is guaranteed normalized by the ProviderRegistry gateway
        this.fileIndex?.removeFile(uri as NormalizedUri);
    }

    async compile(uri: string, text: string, interactive: boolean): Promise<void> {
        if (!this.storedContext) {
            conlog("WeiDU D provider not initialized, cannot compile");
            return;
        }
        // uri is guaranteed normalized by the ProviderRegistry gateway
        await weiduCompile(uri as NormalizedUri, this.storedContext.settings.weidu, interactive, text);
    }
}

export const weiduDProvider: LanguageProvider = new WeiduDProvider();
