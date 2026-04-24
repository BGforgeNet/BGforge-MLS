/**
 * Fallout SSL file parser.
 * Extracts both symbol definitions and cross-file references from a single
 * tree-sitter AST parse, returning a unified ParseResult.
 *
 * Main API: parseFile() - Returns ParseResult for FileIndex storage.
 *
 * Delegates to shared symbol builders in utils.ts (buildProcedureSymbol,
 * buildMacroSymbol, buildVariableSymbol) with workspace scope via displayPath.
 */

import type { Location } from "vscode-languageserver/node";
import type { Node } from "web-tree-sitter";
import { computeDisplayPath } from "../core/location-utils";
import { type ParseResult, EMPTY_PARSE_RESULT } from "../core/parse-result";
import { makeRange as makeRangeFromNode } from "../core/position-utils";
import { type IndexedSymbol, SourceType } from "../core/symbol";
import * as jsdoc from "../shared/jsdoc";
import {
    buildProcedureSymbol,
    buildMacroSymbol,
    buildVariableSymbol,
    extractMacros,
    extractParams,
    extractProcedures,
    findPrecedingDocComment,
    makeRange,
} from "./utils";
import { isInitialized, parseWithCache } from "./parser";
import { SyntaxType } from "./tree-sitter.d";

// =============================================================================
// Unified Parse API
// =============================================================================

/**
 * Parse a file and return both symbols and references from a single AST walk.
 *
 * Uses tree-sitter AST parsing to extract procedures, macros, variables
 * (for the symbol index) and all identifier locations (for the references index).
 *
 * @param uri File URI
 * @param text File content
 * @param workspaceRoot Workspace root for computing relative displayPath
 * @param sourceType Override source type (default: Workspace). Use Navigation for non-header files.
 */
export function parseFile(uri: string, text: string, workspaceRoot?: string, sourceType?: SourceType): ParseResult {
    if (!isInitialized()) {
        return EMPTY_PARSE_RESULT;
    }

    const tree = parseWithCache(text);
    if (!tree) {
        return EMPTY_PARSE_RESULT;
    }

    const root = tree.rootNode;

    // --- Symbols ---
    const symbols = extractSymbols(root, uri, workspaceRoot, sourceType);

    // --- References: collect all identifiers ---
    const refs = collectIdentifierRefs(root, uri);

    return { symbols, refs };
}

/** Extract symbol definitions from the AST root. */
function extractSymbols(
    root: Node,
    uri: string,
    workspaceRoot?: string,
    sourceType?: SourceType,
): readonly IndexedSymbol[] {
    const displayPath = computeDisplayPath(uri, workspaceRoot);
    const result: IndexedSymbol[] = [];

    // Extract procedures via tree-sitter AST
    const procedures = extractProcedures(root);
    for (const [name, { node }] of procedures) {
        const docComment = findPrecedingDocComment(root, node);
        const parsed = docComment ? jsdoc.parse(docComment) : null;
        const astParams = extractParams(node);
        result.push(buildProcedureSymbol(name, uri, node, astParams, parsed, { displayPath }));
    }

    // Extract macros via tree-sitter AST
    const macros = extractMacros(root);
    for (const macro of macros) {
        result.push(buildMacroSymbol(macro, uri, displayPath));
    }

    // Extract top-level variables and exports
    for (const node of root.children) {
        if (node.type === SyntaxType.VariableDecl) {
            const docComment = findPrecedingDocComment(root, node);
            const parsed = docComment ? jsdoc.parse(docComment) : null;
            for (const child of node.children) {
                if (child.type === SyntaxType.VarInit) {
                    const nameNode = child.childForFieldName("name");
                    if (nameNode) {
                        result.push(
                            buildVariableSymbol(nameNode.text, uri, makeRange(child), undefined, parsed, displayPath),
                        );
                    }
                }
            }
        } else if (node.type === SyntaxType.ExportDecl) {
            const docComment = findPrecedingDocComment(root, node);
            const parsed = docComment ? jsdoc.parse(docComment) : null;
            const nameNode = node.childForFieldName("name");
            if (nameNode) {
                result.push(
                    buildVariableSymbol(nameNode.text, uri, makeRange(node), "export variable", parsed, displayPath),
                );
            }
        }
    }

    // Remap source type when called for non-header files (e.g., Navigation for Ctrl+T)
    if (sourceType !== undefined && sourceType !== SourceType.Workspace) {
        return result.map((s) => ({
            ...s,
            source: { ...s.source, type: sourceType },
        }));
    }

    return result;
}

/**
 * Collect all identifier references from the AST.
 * Groups by name into a Map for the cross-file references index.
 *
 * Collects all Identifier nodes at any depth -- the references query
 * handles scoping and filtering. This gives a simple, complete index.
 */
function collectIdentifierRefs(root: Node, uri: string): ReadonlyMap<string, readonly Location[]> {
    const refs = new Map<string, Location[]>();

    function visit(node: Node): void {
        if (node.type === SyntaxType.Identifier) {
            const name = node.text;
            let locs = refs.get(name);
            if (!locs) {
                locs = [];
                refs.set(name, locs);
            }
            locs.push({ uri, range: makeRangeFromNode(node) });
        }

        for (const child of node.children) {
            visit(child);
        }
    }

    visit(root);
    return refs;
}
