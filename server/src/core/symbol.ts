/**
 * Core Symbol type definitions for the unified Symbols.
 *
 * This module defines the Symbol type as a discriminated union - the single source
 * of truth for all LSP features. Each Symbol contains:
 * - Core identification (name, kind, location, scope, source)
 * - Pre-computed LSP responses (completion, hover, signature)
 * - Type-specific data (params for callables, value for variables)
 *
 * Design principles:
 * - Discriminated union: Symbol kind determines what data is available
 * - Compile-time safety: Can't create a CallableSymbol without callable data
 * - Immutable: All fields are readonly
 * - Pre-computed: LSP responses are built once at parse time
 *
 * Note: DocumentSymbol is NOT pre-computed here. It's computed on request by each
 * provider's symbols() method because it requires AST traversal specific to each
 * language.
 */

import {
    CompletionItem,
    CompletionItemKind,
    Hover,
    SignatureInformation,
    SymbolKind as VscodeSymbolKind,
} from "vscode-languageserver/node";

// =============================================================================
// Symbol Kind
// =============================================================================

/**
 * Classification of symbols across all supported languages.
 * More granular than LSP SymbolKind to capture language-specific distinctions.
 */
export const enum SymbolKind {
    // Callables
    Function = "function", // TP2 DEFINE_*_FUNCTION
    Procedure = "procedure", // SSL procedure
    Macro = "macro", // SSL #define or TP2 DEFINE_*_MACRO
    Action = "action", // WeiDU action (BAF/D/TP2)
    Trigger = "trigger", // WeiDU trigger (BAF/D)

    // Data
    Variable = "variable", // General variable
    Constant = "constant", // Constant value
    Parameter = "parameter", // Function/procedure parameter
    LoopVariable = "loop_variable", // Loop iteration variable

    // Structures
    State = "state", // Dialog state (D files)
    Component = "component", // TP2 component
}

// =============================================================================
// Scope
// =============================================================================

/**
 * Scope level determines variable visibility and lookup order.
 * Listed from broadest to narrowest scope.
 */
export const enum ScopeLevel {
    Global = "global", // Built-in/static symbols
    Workspace = "workspace", // From workspace headers (.h, .tph)
    File = "file", // Script-scope (SSL) or file-scope (TP2)
    Function = "function", // Inside procedure (SSL) or function (TP2)
    Loop = "loop", // Loop variables (TP2 PHP_EACH, FOR_EACH)
}

/**
 * Scope information for a symbol.
 */
export interface SymbolScope {
    /** The scope level of this symbol */
    readonly level: ScopeLevel;

    /**
     * For function/loop-scoped symbols: identifier of the containing scope.
     * Format: "uri#containerName" (e.g., "file:///test.ssl#my_procedure")
     * Undefined for file-scope and above.
     */
    readonly containerId?: string;
}

// =============================================================================
// Source
// =============================================================================

/**
 * Where the symbol data originated from.
 */
export const enum SourceType {
    Static = "static", // Built-in from YAML/JSON data files
    Workspace = "workspace", // Parsed from workspace headers
    External = "external", // From external headers directory
    Document = "document", // From current open document
    Navigation = "navigation", // Non-header workspace files (for Ctrl+T search only, excluded from completion)
}

// =============================================================================
// Callable Context and Definition Type
// =============================================================================

/**
 * Context in which a callable operates: action, patch, or dimorphic (for WeiDU).
 * Dimorphic functions can be used in both action and patch contexts.
 */
export enum CallableContext {
    Action = "action",
    Patch = "patch",
    Dimorphic = "dimorphic",
}

/**
 * Definition type: function or macro (for WeiDU).
 */
export enum CallableDefType {
    Function = "function",
    Macro = "macro",
}

// =============================================================================
// Declaration Kind
// =============================================================================

/**
 * How a variable was declared.
 */
export enum DeclarationKind {
    Set = "set",
    Sprint = "sprint",
    TextSprint = "text_sprint",
}

/**
 * Source information for a symbol.
 */
export interface SymbolSource {
    /** How the symbol was loaded */
    readonly type: SourceType;

    /** URI of the source file. Null for static/built-in symbols with no source file. */
    readonly uri: string | null;

    /**
     * Display path for UI (e.g., relative to workspace root).
     * Used in completion labelDetails and hover.
     */
    readonly displayPath?: string;
}

// =============================================================================
// Location
// =============================================================================

/**
 * Location of a symbol in source code.
 */
export interface SymbolLocation {
    readonly uri: string;
    readonly range: {
        readonly start: { readonly line: number; readonly character: number };
        readonly end: { readonly line: number; readonly character: number };
    };
}

// =============================================================================
// Callable Info (for functions, procedures, macros, actions, triggers)
// =============================================================================

/**
 * Parameter information for callable symbols.
 */
export interface CallableParam {
    readonly name: string;
    readonly type?: string; // "int", "string", "array", etc.
    readonly defaultValue?: string;
    readonly description?: string;
    readonly required?: boolean;
}

/**
 * Information specific to callable symbols (functions, procedures, macros).
 */
export interface CallableInfo {
    /** Parameter categories for WeiDU-style functions */
    readonly params?: {
        readonly intVar: readonly CallableParam[];
        readonly strVar: readonly CallableParam[];
        readonly ret: readonly string[];
        readonly retArray: readonly string[];
    };

    /** Simple parameter list for procedures/macros */
    readonly parameters?: readonly CallableParam[];

    /** JSDoc description */
    readonly description?: string;

    /** Context: action or patch (for WeiDU) */
    readonly context?: CallableContext;

    /** Definition type: function or macro (for WeiDU) */
    readonly dtype?: CallableDefType;
}

// =============================================================================
// Variable Info
// =============================================================================

/**
 * Information specific to variable symbols.
 */
export interface VariableInfoData {
    /** Inferred or declared type (omitted when unknown) */
    readonly type?: string;

    /** Value if known (may be truncated) */
    readonly value?: string;

    /** How the variable was declared */
    readonly declarationKind?: DeclarationKind;

    /** JSDoc description */
    readonly description?: string;
}

// =============================================================================
// Base Symbol (common fields)
// =============================================================================

/**
 * Base fields shared by all symbol types.
 */
interface BaseSymbol {
    /** Symbol name (identifier) */
    readonly name: string;

    /** Location of the symbol definition. Null for built-in symbols with no source file. */
    readonly location: SymbolLocation | null;

    /** Scope information */
    readonly scope: SymbolScope;

    /** Source of this symbol */
    readonly source: SymbolSource;

    /** Pre-computed completion item */
    readonly completion: CompletionItem;

    /** Pre-computed hover content */
    readonly hover: Hover;

    /** Pre-computed signature (only for callables) */
    readonly signature?: SignatureInformation;
}

// =============================================================================
// Discriminated Symbol Types
// =============================================================================

/**
 * Callable symbols: functions, procedures, macros, actions, triggers.
 * Contains CallableInfo with parameter details.
 */
export interface CallableSymbol extends BaseSymbol {
    readonly kind:
        | SymbolKind.Function
        | SymbolKind.Procedure
        | SymbolKind.Macro
        | SymbolKind.Action
        | SymbolKind.Trigger;
    readonly callable: CallableInfo;
}

/**
 * Variable symbols.
 * Contains VariableInfoData with type and value.
 */
export interface VariableSymbol extends BaseSymbol {
    readonly kind: SymbolKind.Variable | SymbolKind.Parameter | SymbolKind.LoopVariable;
    readonly variable: VariableInfoData;
}

/**
 * Constant symbols.
 */
export interface ConstantSymbol extends BaseSymbol {
    readonly kind: SymbolKind.Constant;
    readonly constant: {
        readonly value: string;
        readonly type?: string;
    };
}

/**
 * State symbols (for dialog files).
 */
export interface StateSymbol extends BaseSymbol {
    readonly kind: SymbolKind.State;
}

/**
 * Component symbols (for TP2 mod installers).
 */
export interface ComponentSymbol extends BaseSymbol {
    readonly kind: SymbolKind.Component;
}

/**
 * Unified symbol type - discriminated union of all symbol types.
 * The `kind` field determines which type-specific data is available.
 *
 * Named IndexedSymbol to avoid collision with JavaScript's built-in Symbol.
 */
export type IndexedSymbol = CallableSymbol | VariableSymbol | ConstantSymbol | StateSymbol | ComponentSymbol;

// =============================================================================
// Type Guards
// =============================================================================

/** Set of callable symbol kinds */
export const CALLABLE_KINDS: ReadonlySet<SymbolKind> = new Set([
    SymbolKind.Function,
    SymbolKind.Procedure,
    SymbolKind.Macro,
    SymbolKind.Action,
    SymbolKind.Trigger,
]);

/** Set of variable symbol kinds */
const VARIABLE_KINDS: ReadonlySet<SymbolKind> = new Set([
    SymbolKind.Variable,
    SymbolKind.Parameter,
    SymbolKind.LoopVariable,
]);

/**
 * Type guard: check if symbol is a callable (function, procedure, macro, etc.)
 */
export function isCallableSymbol(symbol: IndexedSymbol): symbol is CallableSymbol {
    return CALLABLE_KINDS.has(symbol.kind);
}

/**
 * Type guard: check if symbol is a variable.
 */
export function isVariableSymbol(symbol: IndexedSymbol): symbol is VariableSymbol {
    return VARIABLE_KINDS.has(symbol.kind);
}

// =============================================================================
// Conversion Helpers
// =============================================================================

/**
 * Convert SymbolKind to LSP CompletionItemKind.
 */
export function symbolKindToCompletionKind(kind: SymbolKind): CompletionItemKind {
    switch (kind) {
        case SymbolKind.Function:
        case SymbolKind.Procedure:
        case SymbolKind.Action:
        case SymbolKind.Trigger:
            return CompletionItemKind.Function;
        case SymbolKind.Macro:
            return CompletionItemKind.Snippet;
        case SymbolKind.Variable:
        case SymbolKind.Parameter:
        case SymbolKind.LoopVariable:
            return CompletionItemKind.Variable;
        case SymbolKind.Constant:
            return CompletionItemKind.Constant;
        case SymbolKind.State:
        case SymbolKind.Component:
            return CompletionItemKind.Class;
        default:
            return CompletionItemKind.Text;
    }
}

/**
 * Convert SymbolKind to VSCode SymbolKind (for DocumentSymbol).
 */
export function symbolKindToVscodeKind(kind: SymbolKind): VscodeSymbolKind {
    switch (kind) {
        case SymbolKind.Function:
        case SymbolKind.Procedure:
        case SymbolKind.Macro:
        case SymbolKind.Action:
        case SymbolKind.Trigger:
            return VscodeSymbolKind.Function;
        case SymbolKind.Variable:
        case SymbolKind.Parameter:
        case SymbolKind.LoopVariable:
            return VscodeSymbolKind.Variable;
        case SymbolKind.Constant:
            return VscodeSymbolKind.Constant;
        case SymbolKind.State:
            return VscodeSymbolKind.Class;
        case SymbolKind.Component:
            return VscodeSymbolKind.Module;
        default:
            return VscodeSymbolKind.Variable;
    }
}
