/**
 * Find References for WeiDU TP2 files.
 * Returns all locations referencing the symbol at the cursor position.
 *
 * Reuses getSymbolAtPosition (symbol discovery) and findAllReferences
 * (AST traversal) from the rename infrastructure.
 */

import { Location, Position } from "vscode-languageserver/node";
import { makeRange } from "../core/position-utils";
import type { ReferencesIndex } from "../shared/references-index";
import { parseWithCache } from "./parser";
import { getSymbolAtPosition, isRenameableSymbol } from "./symbol-discovery";
import { findAllReferences } from "./reference-finder";

/**
 * Find all references to the symbol at the given position.
 * Returns empty array if the symbol is not found or not a user-defined symbol.
 *
 * When a ReferencesIndex is provided, cross-file references are included
 * for function/macro symbols (file-scoped).
 */
export function findReferences(
    text: string,
    position: Position,
    uri: string,
    includeDeclaration: boolean,
    refsIndex?: ReferencesIndex,
): Location[] {
    const tree = parseWithCache(text);
    if (!tree) {
        return [];
    }

    const symbolInfo = getSymbolAtPosition(tree.rootNode, position);
    if (!symbolInfo || !isRenameableSymbol(symbolInfo)) {
        return [];
    }

    const occurrences = findAllReferences(tree.rootNode, symbolInfo);
    if (occurrences.length === 0) {
        return [];
    }

    const localLocations = occurrences
        .filter((occ) => includeDeclaration || !occ.isDefinition)
        .map((occ) => ({
            uri,
            range: makeRange(occ.node),
        }));

    // For function/macro symbols, add cross-file references from the index.
    if (symbolInfo.kind === "function" && refsIndex) {
        const crossFileRefs = refsIndex.lookup(symbolInfo.name).filter((loc) => loc.uri !== uri);
        return [...localLocations, ...crossFileRefs];
    }

    return localLocations;
}
