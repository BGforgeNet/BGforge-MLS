/**
 * WeiDU TP2 language provider.
 * Implements all TP2 file features in one place.
 *
 * Uses unified Symbols storage for static completion and hover data.
 * User-defined functions and variables from .tph headers are handled by header-parser.
 */

import {
    type CancellationToken,
    type CompletionItem,
    CompletionItemKind,
    type DocumentSymbol,
    type FoldingRange,
    type Location,
    type Position,
    type SymbolInformation,
    type WorkspaceEdit,
    InsertTextFormat,
} from "vscode-languageserver/node";
import { extname } from "path";
import { fileURLToPath } from "url";
import { conlog, getLinePrefix } from "../common";
import type { NormalizedUri } from "../core/normalized-uri";
import { EXT_WEIDU_TP2, LANG_WEIDU_TP2 } from "../core/languages";
import { isHeaderFile } from "../core/location-utils";
import { FileIndex } from "../core/file-index";
import { Symbols } from "../core/symbol-index";
import { loadStaticSymbols } from "../core/static-loader";
import {
    type FormatResult,
    HoverResult,
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
    type SemanticTokenCapability,
    type WorkspaceSymbolCapability,
} from "../language-provider";
import { getFormatOptions } from "../shared/format-options";
import { stripCommentsWeidu } from "../shared/format-utils";
import { resolveSymbolWithLocal, formatWithValidation } from "../shared/provider-helpers";
import { compile as weiduCompile } from "../weidu-compile";
import { getContextAtPosition, getFuncParamsContext, isAtDeclarationSite } from "./completion/context";
import { filterItemsByContext } from "./completion/filter";
import { getParamCompletions } from "./completion/parameter";
import { CompletionCategory, CompletionContext, type Tp2CompletionItem } from "./completion/types";
import { formatDocument as formatAst } from "./format/core";
import { initParser, parseWithCache, isInitialized } from "./parser";
import { getDocumentSymbols } from "./symbol";
import { getDefinition, isOnFunctionCallParamName } from "./definition";
import { parseFile } from "./header-parser";
import { CallableContext, isCallableSymbol, isVariableSymbol, type IndexedSymbol, SourceType } from "../core/symbol";
import { looksLikeConstant } from "./tree-utils";
import { findReferences } from "./references";
import { renameSymbol, prepareRenameSymbol } from "./rename";
import { buildFunctionCallSnippet, getKeywordSnippet } from "./snippets";
import { getFunctionParamHover } from "./hover";
import { localCompletion, isInsideComment, isOnLoopVariableBinding } from "./ast-utils";
import { getLocalSymbols as extractLocalSymbols, lookupLocalSymbol, clearLocalSymbolsCache } from "./local-symbols";
import { WEIDU_JSDOC_TYPES } from "../../../shared/weidu-types";
import { getJsdocCompletions as getSharedJsdocCompletions } from "../shared/jsdoc-completions";
import { createFoldingRangesProvider } from "../shared/folding-ranges";
import { SyntaxType } from "./tree-sitter.d";
import { getSemanticTokenSpans } from "./semantic-tokens";
import { JSDOC_TYPE_TO_TOKEN, type SemanticTokenSpan } from "../shared/semantic-tokens";

/**
 * Resolve a variable symbol's JSDoc type to a semantic token type, if applicable.
 * Returns the token type string if the symbol is a constant with a recognized styled type
 * (resref, byte, char, dword), or undefined otherwise.
 */
function getStyledTokenType(symbol: IndexedSymbol): string | undefined {
    if (!isVariableSymbol(symbol) || !looksLikeConstant(symbol.name)) {
        return undefined;
    }
    const type = symbol.variable.type;
    if (!type) {
        return undefined;
    }
    // Extract base type: "resref offset" → "resref", "byte array offset" → "byte"
    const baseType = type.split(" ", 1)[0]!;
    return JSDOC_TYPE_TO_TOKEN.get(baseType);
}

/** TP2 block-level node types for code folding. */
const TP2_FOLDABLE_TYPES = new Set([
    SyntaxType.ActionDefineFunction,
    SyntaxType.ActionDefineMacro,
    SyntaxType.ActionDefinePatchFunction,
    SyntaxType.ActionDefinePatchMacro,
    SyntaxType.ActionIf,
    SyntaxType.ActionTry,
    SyntaxType.PatchBlock,
    SyntaxType.PatchFor,
    SyntaxType.PatchForEach,
    SyntaxType.PatchIf,
    SyntaxType.PatchWhile,
    SyntaxType.Component,
    SyntaxType.AlwaysBlock,
    SyntaxType.ActionCopy,
    SyntaxType.InnerAction,
    SyntaxType.InnerPatch,
    SyntaxType.InnerPatchFile,
    SyntaxType.InnerPatchSave,
]);

const tp2FoldingRanges = createFoldingRangesProvider(isInitialized, parseWithCache, TP2_FOLDABLE_TYPES);

/**
 * Add parameter completions (INT_VAR, STR_VAR names) when in funcParamName context.
 * Returns the original items if not in funcParamName context or no params available.
 */
function addParamCompletions(
    items: Tp2CompletionItem[],
    contexts: CompletionContext[],
    symbolStore?: Symbols,
): Tp2CompletionItem[] {
    if (!contexts.includes(CompletionContext.FuncParamName)) {
        return items;
    }
    const funcContext = getFuncParamsContext();
    if (!funcContext) {
        return items;
    }
    const paramCompletions = getParamCompletions(funcContext, symbolStore);
    if (paramCompletions.length === 0) {
        return items;
    }
    return [...items, ...paramCompletions];
}

/**
 * Apply snippets for function/macro calls based on active contexts.
 *
 * Snippets are applied globally (skipped only in param contexts where they
 * would interfere with INT_VAR/STR_VAR value entry). The snippet prefix
 * (LAF/LPF/LAM/LPM) is symbol-driven, not position-driven:
 * - In name contexts: user already typed the keyword, so no prefix is added.
 * - In general context: prefix is determined from the symbol's callable data
 *   (action function -> LAF, patch macro -> LPM, dimorphic -> LAF/.tpp LPF).
 */
function applySnippets(
    items: Tp2CompletionItem[],
    contexts: CompletionContext[],
    text: string,
    uri: string,
    symbolStore: Symbols | undefined,
): Tp2CompletionItem[] {
    const inNameContext =
        contexts.includes(CompletionContext.LafName) ||
        contexts.includes(CompletionContext.LpfName) ||
        contexts.includes(CompletionContext.LamName) ||
        contexts.includes(CompletionContext.LpmName);
    const inParamContext =
        contexts.includes(CompletionContext.FuncParamName) || contexts.includes(CompletionContext.FuncParamValue);

    // No snippets in param contexts
    if (inParamContext) {
        return items;
    }

    const ext = extname(fileURLToPath(uri)).toLowerCase();

    return items.map((item) => {
        // Apply keyword snippets for action/patch command keywords
        const cat = item.category;
        if (cat === CompletionCategory.Action || cat === CompletionCategory.Patch) {
            const kwSnippet = getKeywordSnippet(item.label as string);
            if (kwSnippet) {
                return { ...item, insertText: kwSnippet, insertTextFormat: InsertTextFormat.Snippet };
            }
            return item;
        }

        const funcName = item.label as string;
        const symbol = symbolStore?.lookup(funcName) ?? lookupLocalSymbol(funcName, text, uri);
        if (!symbol || !isCallableSymbol(symbol)) {
            return item;
        }

        const prefix = inNameContext
            ? undefined
            : getSnippetPrefixFromSymbol(symbol.callable.dtype, symbol.callable.context, ext);

        const snippet = buildFunctionCallSnippet(symbol.callable, funcName, prefix);
        if (snippet) {
            return {
                ...item,
                insertText: snippet,
                insertTextFormat: InsertTextFormat.Snippet,
            };
        }
        return item;
    });
}

/**
 * Determine the keyword prefix for a function/macro snippet from the symbol's own data.
 * - Action function -> LAF, action macro -> LAM
 * - Patch function -> LPF, patch macro -> LPM
 * - Dimorphic function -> LPF in .tpp files, LAF in all others
 */
function getSnippetPrefixFromSymbol(
    dtype: string | undefined,
    callableContext: CallableContext | undefined,
    ext: string,
): string | undefined {
    const isMacro = dtype === "macro";
    if (callableContext === CallableContext.Patch) {
        return isMacro ? "LPM" : "LPF";
    }
    if (callableContext === CallableContext.Action) {
        return isMacro ? "LAM" : "LAF";
    }
    // Dimorphic: use LPF in .tpp files, LAF elsewhere
    if (callableContext === CallableContext.Dimorphic) {
        return ext === ".tpp" ? "LPF" : "LAF";
    }
    return undefined;
}

/**
 * Collect local variable/symbol completions from both file-scope and deep-scope sources.
 * Deduplicates by name (first occurrence wins, preserving rich hover from file-scope).
 *
 * @param variablesOnly When true, only include Variable-kind items from file-scope symbols
 *   (excludes functions/macros). Deep-scope items are always variables.
 * @param excludeWord Word to exclude from results (prevents self-referencing completion
 *   when tree-sitter parses an incomplete declaration).
 */
function collectLocalCompletions(
    text: string,
    uri: string,
    options?: { variablesOnly?: boolean; excludeWord?: string },
): Tp2CompletionItem[] {
    const { variablesOnly = false, excludeWord } = options ?? {};
    const seen = new Set<string>();
    const result: Tp2CompletionItem[] = [];

    for (const s of extractLocalSymbols(text, uri)) {
        if (seen.has(s.name)) continue;
        if (excludeWord && s.name === excludeWord) continue;
        if (variablesOnly && s.completion.kind !== CompletionItemKind.Variable) continue;
        seen.add(s.name);
        result.push(s.completion);
    }

    // Deep-scoped variables (inside function bodies, loops) not covered by file-scope
    for (const v of localCompletion(text)) {
        const label = v.label as string;
        if (seen.has(label)) continue;
        if (excludeWord && label === excludeWord) continue;
        seen.add(label);
        result.push(v);
    }

    return result;
}

/** JSDoc completion items with TP2 category metadata. */
function getJsdocCompletions(linePrefix: string): Tp2CompletionItem[] {
    return getSharedJsdocCompletions(WEIDU_JSDOC_TYPES, linePrefix).map((item) => ({
        ...item,
        category: CompletionCategory.Jsdoc,
    }));
}

class WeiduTp2Provider
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
        SemanticTokenCapability,
        WorkspaceSymbolCapability
{
    readonly id = LANG_WEIDU_TP2;
    readonly indexExtensions = [...EXT_WEIDU_TP2];

    private fileIndex: FileIndex | undefined;
    private storedContext: ProviderContext | undefined;

    async init(context: ProviderContext): Promise<void> {
        this.storedContext = context;

        await initParser();

        this.fileIndex = new FileIndex();
        const staticSymbols = loadStaticSymbols(LANG_WEIDU_TP2);
        this.fileIndex.loadStatic(staticSymbols);

        conlog(`WeiDU TP2 provider initialized with ${staticSymbols.length} static symbols`);
    }

    resolveSymbol(name: string, text: string, uri: string): IndexedSymbol | undefined {
        return resolveSymbolWithLocal(name, text, uri, this.fileIndex?.symbols, lookupLocalSymbol);
    }

    getCompletions(uri: string): CompletionItem[] {
        if (!this.fileIndex) {
            return [];
        }
        const allSymbols = this.fileIndex.symbols.query({ excludeUri: uri });
        return allSymbols.map((s: IndexedSymbol) => s.completion);
    }

    filterCompletions(
        items: CompletionItem[],
        text: string,
        position: Position,
        uri: string,
        triggerCharacter?: string,
    ): CompletionItem[] {
        const filePath = fileURLToPath(uri);
        const ext = extname(filePath).toLowerCase();
        const contexts = getContextAtPosition(text, position.line, position.character);

        conlog(
            `[tp2] Completion contexts: [${contexts.join(", ")}] at ${position.line}:${position.character} in ${ext}`,
        );

        if (contexts.includes(CompletionContext.Comment)) {
            return [];
        }
        if (contexts.includes(CompletionContext.Jsdoc)) {
            return getJsdocCompletions(getLinePrefix(text, position));
        }

        // @ is a trigger character for translation references (@123) — suppress general completions
        if (triggerCharacter === "@") {
            return [];
        }

        // At declaration sites, the user is naming a new symbol.
        // "definition" (function/macro/array/loop): suppress all completions.
        // "assignment" (SET/SPRINT): show only local variable completions
        // (user may be reassigning an existing variable).
        // TODO: Filter by DeclarationKind - show only integer vars after SET, string vars after SPRINT.
        const declSite = isAtDeclarationSite(text, position);
        if (declSite === "definition") {
            return [];
        }

        // Exclude the word currently being typed to prevent self-referencing completion.
        // Applied in all paths as defense-in-depth: tree-sitter error recovery can create
        // local variables from partially typed text (e.g. phantom patch_assignment nodes).
        //
        // The (\S+)$ regex matches the last non-whitespace run before the cursor.
        // This may include WeiDU delimiters (e.g. `%my_var%` → "%my_var%"), but that's
        // safe: completion labels are bare names ("my_var"), so a delimited match like
        // "%my_var%" won't falsely exclude the bare label. Over-matching is harmless;
        // under-matching (empty string) disables exclusion, which is also safe.
        const currentWord = getLinePrefix(text, position).match(/(\S+)$/)?.[1] ?? "";

        if (declSite === "assignment") {
            return collectLocalCompletions(text, uri, { variablesOnly: true, excludeWord: currentWord });
        }

        const localCompletions = collectLocalCompletions(text, uri, { excludeWord: currentWord });

        const baseItems: Tp2CompletionItem[] = [...items, ...localCompletions];
        const withParams = addParamCompletions(baseItems, contexts, this.fileIndex?.symbols);
        const withSnippets = applySnippets(withParams, contexts, text, uri, this.fileIndex?.symbols);

        return filterItemsByContext(withSnippets, contexts);
    }

    shouldProvideFeatures(text: string, position: Position): boolean {
        return !isInsideComment(text, position);
    }

    hover(text: string, symbol: string, _uri: string, position: Position): HoverResult {
        const paramHover = getFunctionParamHover(text, symbol, position, this.fileIndex?.symbols);
        if (paramHover) {
            return HoverResult.found(paramHover);
        }

        if (isInitialized()) {
            const tree = parseWithCache(text);
            if (tree) {
                const isParamName = isOnFunctionCallParamName(tree.rootNode, position);
                const isLoopVar = isOnLoopVariableBinding(tree.rootNode, position);
                if (isParamName || isLoopVar) {
                    return HoverResult.empty();
                }
            }
        }

        // Regular symbol hover is handled by resolveSymbol() via the registry.
        // No need to duplicate the lookup here.
        return HoverResult.notHandled();
    }

    getSymbolDefinition(symbolName: string): Location | null {
        return this.fileIndex?.symbols.lookupDefinition(symbolName) ?? null;
    }

    definition(text: string, position: Position, uri: string): Location | null {
        return getDefinition(text, uri, position, this.fileIndex?.symbols);
    }

    reloadFileData(uri: string, text: string): void {
        if (isInitialized() && this.fileIndex) {
            const st = isHeaderFile(uri) ? SourceType.Workspace : SourceType.Navigation;
            const result = parseFile(uri, text, { workspaceRoot: this.storedContext?.workspaceRoot, sourceType: st });
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
            conlog("WeiDU TP2 provider not initialized, cannot compile");
            return;
        }
        // uri is guaranteed normalized by the ProviderRegistry gateway
        await weiduCompile(uri as NormalizedUri, this.storedContext.settings.weidu, interactive, text);
    }

    format(text: string, uri: string): FormatResult {
        return formatWithValidation({
            text,
            uri,
            languageName: "TP2",
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
        return tp2FoldingRanges(text);
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

    rename(text: string, position: Position, newName: string, uri: string): WorkspaceEdit | null {
        return renameSymbol(text, position, newName, uri);
    }

    prepareRename(
        text: string,
        position: Position,
    ): { range: { start: Position; end: Position }; placeholder: string } | null {
        return prepareRenameSymbol(text, position);
    }

    semanticTokens(text: string, uri: string): SemanticTokenSpan[] {
        return getSemanticTokenSpans(text, this.getTypedNames(text, uri));
    }

    /**
     * Collect names of constants with styled @type annotations (resref, byte, char, dword).
     * Returns a map from variable name to semantic token type.
     * Merges indexed symbols (other files) with local symbols (current document)
     * so that changes in the current file are reflected immediately.
     */
    private getTypedNames(text: string, uri: string): ReadonlyMap<string, string> {
        const names = new Map<string, string>();

        // From symbol index (headers and other workspace files)
        if (this.fileIndex) {
            for (const symbol of this.fileIndex.symbols.query({})) {
                const tokenType = getStyledTokenType(symbol);
                if (tokenType) {
                    names.set(symbol.name, tokenType);
                }
            }
        }

        // From current document (reflects unsaved edits immediately)
        for (const symbol of extractLocalSymbols(text, uri)) {
            const tokenType = getStyledTokenType(symbol);
            if (tokenType) {
                names.set(symbol.name, tokenType);
            }
        }

        return names;
    }
}

export const weiduTp2Provider: LanguageProvider = new WeiduTp2Provider();
