/**
 * Local symbol extraction for Fallout SSL files.
 *
 * Converts the current document's AST to IndexedSymbol[] for unified
 * hover/completion/definition handling. Delegates to shared symbol builders
 * in utils.ts (buildProcedureSymbol, buildMacroSymbol, buildVariableSymbol).
 *
 * Cached by text hash for performance - same text returns same result.
 */

import type { IndexedSymbol } from "../core/symbol";
import { TextCache } from "../shared/text-cache";
import { parseWithCache, isInitialized } from "../../../shared/parsers/fallout-ssl";
import {
    extractProcedures,
    extractMacros,
    findPrecedingDocComment,
    makeRange,
    extractParams,
    buildProcedureSymbol,
    buildMacroSymbol,
    buildVariableSymbol,
} from "./utils";
import * as jsdoc from "../shared/jsdoc";
import { SyntaxType } from "./tree-sitter.d";
// Generated from server/data/fallout-ssl-base.yml by generate-data.sh.
// Inlined by esbuild at bundle time.
import engineProcDocs from "../../out/fallout-ssl-engine-proc-docs.json";

const ENGINE_PROC_DOCS = engineProcDocs as Record<string, string>;

/** Cached local symbols data: symbols array + name lookup map */
interface LocalSymbolsData {
    symbols: IndexedSymbol[];
    byName: Map<string, IndexedSymbol>;
}

/** LRU cache for local symbols */
const cache = new TextCache<LocalSymbolsData>();

/**
 * Parse document and build local symbols data.
 * Called by cache on miss.
 */
function parseLocalSymbols(text: string, uri: string): LocalSymbolsData | null {
    if (!isInitialized()) {
        return null;
    }

    const tree = parseWithCache(text);
    if (!tree) {
        return null;
    }

    const symbols: IndexedSymbol[] = [];
    const root = tree.rootNode;

    // Extract procedures
    const procedures = extractProcedures(root);
    for (const [name, { node }] of procedures) {
        const docComment = findPrecedingDocComment(root, node);
        const parsed = docComment ? jsdoc.parse(docComment) : null;
        const astParams = extractParams(node);
        const engineDoc = ENGINE_PROC_DOCS[name];
        symbols.push(buildProcedureSymbol(name, uri, node, astParams, parsed, { engineDoc }));
    }

    // Extract macros
    const macros = extractMacros(root);
    for (const macro of macros) {
        symbols.push(buildMacroSymbol(macro, uri));
    }

    // Extract file-level variables and exports - use language-tagged code fence
    for (const node of root.children) {
        if (node.type === SyntaxType.VariableDecl) {
            const docComment = findPrecedingDocComment(root, node);
            const parsed = docComment ? jsdoc.parse(docComment) : null;
            for (const child of node.children) {
                if (child.type === SyntaxType.VarInit) {
                    const nameNode = child.childForFieldName("name");
                    if (nameNode) {
                        symbols.push(buildVariableSymbol(nameNode.text, uri, makeRange(child), undefined, parsed));
                    }
                }
            }
        } else if (node.type === SyntaxType.ExportDecl) {
            const docComment = findPrecedingDocComment(root, node);
            const parsed = docComment ? jsdoc.parse(docComment) : null;
            const nameNode = node.childForFieldName("name");
            if (nameNode) {
                symbols.push(buildVariableSymbol(nameNode.text, uri, makeRange(node), "export variable", parsed));
            }
        }
    }

    // Build name lookup map (first definition wins)
    const byName = new Map<string, IndexedSymbol>();
    for (const sym of symbols) {
        if (!byName.has(sym.name)) {
            byName.set(sym.name, sym);
        }
    }

    return { symbols, byName };
}

/**
 * Get all local symbols from the current document.
 *
 * @param version Document version counter (LSP `TextDocument.version`) used as
 *   cache key; pass `undefined` to bypass the cache.
 */
export function getLocalSymbols(text: string, version: number | undefined, uri: string): IndexedSymbol[] {
    return cache.getOrParse(uri, version, text, parseLocalSymbols)?.symbols ?? [];
}

/**
 * Look up a local symbol by name. O(1) via cached map.
 *
 * @param version Document version counter (LSP `TextDocument.version`) used as
 *   cache key; pass `undefined` to bypass the cache.
 */
export function lookupLocalSymbol(
    name: string,
    text: string,
    version: number | undefined,
    uri: string,
): IndexedSymbol | undefined {
    return cache.getOrParse(uri, version, text, parseLocalSymbols)?.byName.get(name);
}

/**
 * Clear cache for a specific URI.
 */
export function clearLocalSymbolsCache(uri: string): void {
    cache.clear(uri);
}

/**
 * Clear entire cache (for testing).
 */
export function clearAllLocalSymbolsCache(): void {
    cache.clearAll();
}
