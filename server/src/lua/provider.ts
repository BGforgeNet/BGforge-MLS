import type {
    CancellationToken,
    CompletionItem,
    DocumentSymbol,
    FoldingRange,
    Location,
    Position,
    SignatureHelp,
    SymbolInformation,
    WorkspaceEdit,
} from "vscode-languageserver/node";
import { conlog, getLinePrefix } from "../common";
import type { NormalizedUri } from "../core/normalized-uri";
import { EXT_LUA, LANG_LUA } from "../core/languages";
import { FileIndex } from "../core/file-index";
import { type IndexedSymbol, SourceType } from "../core/symbol";
import { loadStaticSymbols } from "../core/static-loader";
import { compile as compileLua } from "../lua-compile";
import { type HoverResult, HoverResult as HoverResultFactory } from "../core/capabilities";
import { getJsdocCompletions } from "../shared/jsdoc-completions";
import type { SemanticTokenSpan } from "../shared/semantic-tokens";
import * as signature from "../shared/signature";
import { initParser, isInitialized, parseWithCache } from "../../../shared/parsers/lua";
import {
    definition,
    findReferences,
    formatLua,
    getDocumentSymbols,
    getLocalSymbol,
    getSemanticTokenSpans,
    luaFoldingRanges,
    mergeLocalCompletions,
    parseLuaFile,
    prepareRename,
    rename,
} from "./analysis";
import type {
    FormatResult,
    LanguageProvider,
    ProviderContext,
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
    WorkspaceSymbolCapability,
} from "../language-provider";

const LUA_JSDOC_TYPES = new Map([
    ["any", { detail: "Any Lua value" }],
    ["nil", { detail: "Nil value" }],
    ["boolean", { detail: "Boolean value" }],
    ["number", { detail: "Numeric value" }],
    ["integer", { detail: "Integer value" }],
    ["string", { detail: "String value" }],
    ["table", { detail: "Table value" }],
    ["function", { detail: "Function value" }],
    ["thread", { detail: "Coroutine/thread" }],
    ["userdata", { detail: "Userdata value" }],
]);

class LuaProvider
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
    readonly id = LANG_LUA;
    readonly indexExtensions = [EXT_LUA];

    private fileIndex: FileIndex | undefined;
    private staticSignatures: signature.SigMap | undefined;
    private storedContext: ProviderContext | undefined;

    async init(context: ProviderContext): Promise<void> {
        this.storedContext = context;
        await initParser();

        this.fileIndex = new FileIndex();
        const staticSymbols = loadStaticSymbols(LANG_LUA);
        this.fileIndex.loadStatic(staticSymbols);

        this.staticSignatures = signature.loadStatic(LANG_LUA);

        conlog(
            `Lua provider initialized with ${staticSymbols.length} static symbols and ${this.staticSignatures.size} static signatures`,
        );
    }

    shouldProvideFeatures(text: string, position: Position): boolean {
        if (!isInitialized() || !parseWithCache(text)) {
            return false;
        }
        const line = text.split(/\r?\n/)[position.line] ?? "";
        const prefix = line.slice(0, Math.max(0, position.character));
        return !prefix.includes("--");
    }

    resolveSymbol(name: string, text: string, uri: NormalizedUri): IndexedSymbol | undefined {
        if (!isInitialized() || !parseWithCache(text)) {
            return undefined;
        }

        const local = getLocalSymbol(name, text, uri, this.storedContext?.workspaceRoot);
        if (local) {
            return local;
        }

        const indexed = this.fileIndex?.symbols.lookup(name);
        if (!indexed) {
            return undefined;
        }
        return indexed.source.type === SourceType.Static ? indexed : undefined;
    }

    format(text: string, _uri: NormalizedUri): FormatResult {
        if (!isInitialized() || !parseWithCache(text)) {
            return { edits: [] };
        }
        return formatLua(text);
    }

    symbols(text: string): DocumentSymbol[] {
        if (!isInitialized() || !parseWithCache(text)) {
            return [];
        }
        return getDocumentSymbols(text);
    }

    foldingRanges(text: string): FoldingRange[] {
        if (!isInitialized() || !parseWithCache(text)) {
            return [];
        }
        return luaFoldingRanges(text);
    }

    definition(text: string, position: Position, uri: NormalizedUri): Location | null {
        if (!isInitialized() || !parseWithCache(text)) {
            return null;
        }
        return definition(text, uri, position);
    }

    references(
        text: string,
        position: Position,
        uri: NormalizedUri,
        includeDeclaration: boolean,
        _token: CancellationToken,
    ): Location[] {
        if (!isInitialized() || !parseWithCache(text)) {
            return [];
        }
        return findReferences(text, position, uri, includeDeclaration, this.fileIndex?.refs);
    }

    prepareRename(text: string, position: Position) {
        if (!isInitialized() || !parseWithCache(text)) {
            return null;
        }
        return prepareRename(text, position);
    }

    async rename(text: string, position: Position, newName: string, uri: NormalizedUri): Promise<WorkspaceEdit | null> {
        if (!isInitialized() || !parseWithCache(text)) {
            return null;
        }
        return rename(text, position, newName, uri, this.fileIndex?.refs);
    }

    hover(text: string, symbol: string, uri: NormalizedUri, _position: Position): HoverResult {
        if (!isInitialized() || !parseWithCache(text)) {
            return HoverResultFactory.notHandled();
        }
        const local = getLocalSymbol(symbol, text, uri, this.storedContext?.workspaceRoot);
        if (local?.hover) {
            return HoverResultFactory.found(local.hover);
        }
        return HoverResultFactory.notHandled();
    }

    getCompletions(uri: NormalizedUri): CompletionItem[] {
        return this.fileIndex
            ? this.fileIndex.symbols.query({ excludeUri: uri }).map((symbol: IndexedSymbol) => symbol.completion)
            : [];
    }

    filterCompletions(
        items: CompletionItem[],
        text: string,
        position: Position,
        uri: NormalizedUri,
        triggerCharacter?: string,
    ): CompletionItem[] {
        if (!isInitialized() || !parseWithCache(text)) {
            return [];
        }

        const linePrefix = getLinePrefix(text, position);
        if (linePrefix.includes("---@")) {
            return getJsdocCompletions(LUA_JSDOC_TYPES, linePrefix);
        }
        if (triggerCharacter === "@") {
            return [];
        }

        return mergeLocalCompletions(items, text, uri, this.storedContext?.workspaceRoot);
    }

    getSignature(_uri: NormalizedUri, symbolName: string, paramIndex: number): SignatureHelp | null {
        const sig = this.staticSignatures?.get(symbolName);
        if (!sig) {
            return null;
        }
        return signature.getResponse(sig, paramIndex);
    }

    semanticTokens(text: string, _uri: NormalizedUri): SemanticTokenSpan[] {
        if (!isInitialized() || !parseWithCache(text)) {
            return [];
        }
        return getSemanticTokenSpans(text);
    }

    workspaceSymbols(query: string, token: CancellationToken): SymbolInformation[] {
        return this.fileIndex?.symbols.searchWorkspaceSymbols(query, 500, token) ?? [];
    }

    reloadFileData(uri: NormalizedUri, text: string): void {
        if (!isInitialized() || !this.fileIndex) {
            return;
        }
        const result = parseLuaFile(uri, text, this.storedContext?.workspaceRoot);
        this.fileIndex.updateFile(uri, result);
    }

    onWatchedFileDeleted(uri: NormalizedUri): void {
        this.fileIndex?.removeFile(uri);
    }

    async compile(uri: NormalizedUri, text: string, interactive: boolean): Promise<void> {
        if (!this.storedContext) {
            return;
        }
        await compileLua(uri, this.storedContext.settings.lua, interactive, text);
    }
}

export const luaProvider: LanguageProvider = new LuaProvider();
