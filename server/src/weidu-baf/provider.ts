/**
 * WeiDU BAF language provider.
 * Implements all BAF file features in one place.
 *
 * Uses unified Symbols storage for completion and hover data.
 */

import type { CompletionItem, FoldingRange, Position } from "vscode-languageserver/node";
import { conlog } from "../common";
import type { NormalizedUri } from "../core/normalized-uri";
import { LANG_WEIDU_BAF } from "../core/languages";
import type { IndexedSymbol } from "../core/symbol";
import { Symbols } from "../core/symbol-index";
import { loadStaticSymbols } from "../core/static-loader";
import {
    type FormatResult,
    type LanguageProvider,
    type ProviderContext,
    type ProviderBase,
    type FormattingCapability,
    type CompletionCapability,
    type DataCapability,
    type FoldingCapability,
    type FeatureGateCapability,
    type CompilationCapability,
} from "../language-provider";
import { createIsInsideComment } from "../shared/comment-check";
import { stripCommentsWeidu } from "@bgforge/format";
import { getFormatOptions } from "../shared/format-options";
import { resolveSymbolStatic, getStaticCompletions, formatWithValidation } from "../shared/provider-helpers";
import { formatDocument as formatAst } from "./format/core";
import { initParser, parseWithCache, isInitialized } from "./parser";
import { compile as weiduCompile } from "../weidu-compile";
import { createFoldingRangesProvider } from "../shared/folding-ranges";
import { SyntaxType } from "./tree-sitter.d";

/** Comment node types in the BAF grammar. */
const BAF_COMMENT_TYPES: ReadonlySet<string> = new Set([SyntaxType.Comment, SyntaxType.LineComment]);

const isInsideComment = createIsInsideComment(isInitialized, parseWithCache, BAF_COMMENT_TYPES);

/** BAF block-level node types for code folding. */
const BAF_FOLDABLE_TYPES = new Set([SyntaxType.Block, SyntaxType.Response]);

const bafFoldingRanges = createFoldingRangesProvider(isInitialized, parseWithCache, BAF_FOLDABLE_TYPES);

class WeiduBafProvider
    implements
        ProviderBase,
        FormattingCapability,
        CompletionCapability,
        DataCapability,
        FoldingCapability,
        FeatureGateCapability,
        CompilationCapability
{
    readonly id = LANG_WEIDU_BAF;
    private symbolStore: Symbols | undefined;
    private storedContext: ProviderContext | undefined;

    async init(context: ProviderContext): Promise<void> {
        this.storedContext = context;

        await initParser();

        this.symbolStore = new Symbols();
        const staticSymbols = loadStaticSymbols(LANG_WEIDU_BAF);
        this.symbolStore.loadStatic(staticSymbols);

        conlog(`WeiDU BAF provider initialized with ${staticSymbols.length} static symbols`);
    }

    shouldProvideFeatures(text: string, position: Position): boolean {
        return !isInsideComment(text, position);
    }

    // BAF has no user-defined constructs (no functions/macros/variables),
    // so symbol lookup is static-only (YAML data: actions + triggers).
    resolveSymbol(name: string, _text: string, _uri: string): IndexedSymbol | undefined {
        return resolveSymbolStatic(name, this.symbolStore);
    }

    foldingRanges(text: string): FoldingRange[] {
        return bafFoldingRanges(text);
    }

    format(text: string, uri: string): FormatResult {
        return formatWithValidation({
            text,
            uri,
            languageName: "BAF",
            isInitialized,
            parse: parseWithCache,
            formatAst: (rootNode, options) => formatAst(rootNode, options),
            getFormatOptions,
            stripComments: stripCommentsWeidu,
        });
    }

    getCompletions(_uri: string): CompletionItem[] {
        return getStaticCompletions(this.symbolStore);
    }

    async compile(uri: string, text: string, interactive: boolean): Promise<void> {
        if (!this.storedContext) {
            conlog("WeiDU BAF provider not initialized, cannot compile");
            return;
        }
        // uri is guaranteed normalized by the ProviderRegistry gateway
        await weiduCompile(uri as NormalizedUri, this.storedContext.settings.weidu, interactive, text);
    }
}

export const weiduBafProvider: LanguageProvider = new WeiduBafProvider();
