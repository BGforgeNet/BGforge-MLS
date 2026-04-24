/**
 * Provider capability interfaces and shared types.
 *
 * Each interface represents a cohesive feature set that a language provider
 * can implement. Providers declare capabilities via `implements` clauses,
 * getting compile-time enforcement of required methods.
 *
 * Also contains shared types (FormatResult, HoverResult, ProviderContext)
 * used across capabilities. These live here to avoid circular imports
 * between capabilities and language-provider.
 */

import type {
    CancellationToken,
    CompletionItem,
    DocumentSymbol,
    FoldingRange,
    Hover,
    InlayHint,
    Location,
    Position,
    Range,
    SignatureHelp,
    SymbolInformation,
    TextEdit,
    WorkspaceEdit,
} from "vscode-languageserver/node";
import type { IndexedSymbol } from "./symbol";
import type { SemanticTokenSpan } from "../shared/semantic-tokens";
import type { MLSsettings } from "../settings";

// =============================================================================
// Shared types used across capabilities
// =============================================================================

/**
 * Result from a provider's hover method.
 * Discriminated union that replaces the ambiguous Hover | null | undefined return:
 * - handled=true, hover=Hover: provider found a result
 * - handled=true, hover=null: provider handled it but nothing to show (block fallthrough)
 * - handled=false: provider didn't handle it, fall through to data-driven hover
 */
export type HoverResult = { readonly handled: true; readonly hover: Hover | null } | { readonly handled: false };

/** Factory helpers for creating HoverResult values. */
export const HoverResult = {
    found: (hover: Hover): HoverResult => ({ handled: true, hover }),
    empty: (): HoverResult => ({ handled: true, hover: null }),
    notHandled: (): HoverResult => ({ handled: false }),
} as const;

/**
 * Result from formatting a document.
 * Includes edits and optional warning message for validation failures.
 */
export interface FormatResult {
    edits: TextEdit[];
    /** Warning message to show to user (e.g., validation failure) */
    warning?: string;
}

/**
 * Context passed to providers during initialization.
 * Contains everything a provider needs to set up.
 */
export interface ProviderContext {
    /** Absolute path to workspace root, undefined if no workspace folders exist */
    workspaceRoot: string | undefined;
    /** User settings */
    settings: MLSsettings;
    /**
     * Returns open document buffer text if available, undefined otherwise.
     * Accepts plain string (not NormalizedUri) because it delegates to the
     * VSCode TextDocuments API which uses raw URI strings from the LSP protocol.
     */
    getDocumentText?: (uri: string) => string | undefined;
}

// =============================================================================
// Base — required for all providers
// =============================================================================

export interface ProviderBase {
    readonly id: string;
    init(context: ProviderContext): Promise<void>;
}

// =============================================================================
// Feature capabilities
// =============================================================================

export interface FormattingCapability {
    format(text: string, uri: string): FormatResult;
}

export interface SymbolCapability {
    symbols(text: string): DocumentSymbol[];
}

export interface FoldingCapability {
    foldingRanges(text: string): FoldingRange[];
}

export interface NavigationCapability {
    definition?(text: string, position: Position, uri: string): Location | null;
    references?(
        text: string,
        position: Position,
        uri: string,
        includeDeclaration: boolean,
        token: CancellationToken,
    ): Location[];
}

export interface RenameCapability {
    rename(
        text: string,
        position: Position,
        newName: string,
        uri: string,
    ): Promise<WorkspaceEdit | null> | WorkspaceEdit | null;
    prepareRename(text: string, position: Position): { range: Range; placeholder: string } | null;
}

export interface HoverCapability {
    hover(text: string, symbol: string, uri: string, position: Position): HoverResult;
}

export interface CompletionCapability {
    getCompletions(uri: string): CompletionItem[];
    filterCompletions?(
        items: CompletionItem[],
        text: string,
        position: Position,
        uri: string,
        triggerCharacter?: string,
    ): CompletionItem[];
}

export interface DataCapability {
    resolveSymbol?(name: string, text: string, uri: string): IndexedSymbol | undefined;
    getSignature?(uri: string, symbol: string, paramIndex: number): SignatureHelp | null;
    getSymbolDefinition?(symbol: string): Location | null;
    localSignature?(text: string, symbol: string, paramIndex: number): SignatureHelp | null;
}

export interface CompilationCapability {
    compile(uri: string, text: string, interactive: boolean): Promise<void>;
}

export interface IndexingCapability {
    indexExtensions: string[];
    reloadFileData(uri: string, text: string): void;
    onWatchedFileDeleted?(uri: string): void;
    onDocumentClosed?(uri: string): void;
}

export interface FeatureGateCapability {
    shouldProvideFeatures(text: string, position: Position): boolean;
}

export interface SemanticTokenCapability {
    semanticTokens(text: string, uri: string): SemanticTokenSpan[];
}

export interface InlayHintCapability {
    inlayHints(text: string, uri: string, range: Range): InlayHint[];
}

export interface WorkspaceSymbolCapability {
    workspaceSymbols(query: string, token: CancellationToken): SymbolInformation[];
}
