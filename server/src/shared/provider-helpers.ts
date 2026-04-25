/**
 * Shared provider helpers to reduce duplication across language providers.
 *
 * Contains common patterns for symbol resolution, formatting,
 * and completions that are used by multiple providers.
 */

import type { CompletionItem } from "vscode-languageserver/node";
import type { IndexedSymbol } from "../core/symbol";
import type { Symbols } from "../core/symbol-index";
import type { FormatResult } from "../language-provider";
import { conlog } from "../common";
import { createFullDocumentEdit, validateFormatting, type CommentStripper, type FormatOutput } from "./format-utils";

// ============================================
// Symbol resolution
// ============================================

/**
 * Resolve a symbol from static/indexed storage only.
 * Used by providers without local symbols (BAF, D, Worldmap).
 */
export function resolveSymbolStatic(name: string, symbols: Symbols | undefined): IndexedSymbol | undefined {
    return symbols?.lookup(name);
}

/**
 * Resolve a symbol with local-first priority.
 * Used by providers with local symbols (SSL, TP2).
 *
 * Resolution order:
 * 1. Local symbols (fresh buffer) - always checked first
 * 2. Indexed symbols (headers + static), EXCLUDING current file
 */
export function resolveSymbolWithLocal(
    name: string,
    text: string,
    version: number | undefined,
    uri: string,
    symbols: Symbols | undefined,
    lookupLocal: (name: string, text: string, version: number | undefined, uri: string) => IndexedSymbol | undefined,
): IndexedSymbol | undefined {
    // Local symbols take priority (fresh buffer)
    const local = lookupLocal(name, text, version, uri);
    if (local) {
        return local;
    }

    // Fall back to indexed symbols (static + headers)
    if (symbols) {
        const indexed = symbols.lookup(name);
        if (indexed) {
            // Return if NOT from the current file (different file or static with null uri)
            if (indexed.source.uri !== uri) {
                return indexed;
            }
            // Also return static symbols (uri is null, which !== uri already handles)
        }
    }

    return undefined;
}

// ============================================
// Static data access
// ============================================

/**
 * Get completions from static/indexed symbol storage.
 * Used by providers that return all symbols as completions.
 */
export function getStaticCompletions(symbols: Symbols | undefined): CompletionItem[] {
    if (!symbols) {
        return [];
    }
    return symbols.query({}).map((s: IndexedSymbol) => s.completion);
}

// ============================================
// Formatting
// ============================================

/** Options for the formatWithValidation helper. Generic parameters allow type-safe usage without `any`. */
interface FormatWithValidationOptions<TRoot = unknown, TOpts = unknown> {
    /** Current document text */
    text: string;
    /** Document URI */
    uri: string;
    /** Language name for error messages (e.g., "BAF", "TP2") */
    languageName: string;
    /** Check if the parser is initialized */
    isInitialized: () => boolean;
    /** Parse text into a tree (returns null on failure) */
    parse: (text: string) => { rootNode: TRoot } | null;
    /** Format the AST root node with options */
    formatAst: (rootNode: TRoot, options: TOpts) => FormatOutput;
    /** Get format options for a URI */
    getFormatOptions: (uri: string) => TOpts;
    /** Strip comments for validation (language-specific) */
    stripComments: CommentStripper;
}

/**
 * Shared format method with parse, format, validate, and error handling.
 * Used by BAF, D, and TP2 providers.
 */
export function formatWithValidation<TRoot, TOpts>(opts: FormatWithValidationOptions<TRoot, TOpts>): FormatResult {
    if (!opts.isInitialized()) {
        return { edits: [] };
    }

    const tree = opts.parse(opts.text);
    if (!tree) {
        return { edits: [] };
    }

    const options = opts.getFormatOptions(opts.uri);

    let result;
    try {
        result = opts.formatAst(tree.rootNode, options);
    } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        conlog(`${opts.languageName} formatter error: ${msg}`);
        return { edits: [], warning: `${opts.languageName} formatter error: ${msg}` };
    }

    if (result.warning) {
        conlog(`${opts.languageName} formatter error: ${result.warning}`);
        return { edits: [], warning: result.warning };
    }

    const validationError = validateFormatting(opts.text, result.text, opts.stripComments);
    if (validationError) {
        conlog(`${opts.languageName} formatter validation failed: ${validationError}`);
        return {
            edits: [],
            warning: `${opts.languageName} formatter validation failed: ${validationError}`,
        };
    }

    if (result.text === opts.text) return { edits: [] };
    return { edits: createFullDocumentEdit(opts.text, result.text) };
}
