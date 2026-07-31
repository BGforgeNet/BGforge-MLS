/**
 * Find References for Fallout SSL files.
 * Returns all locations referencing the symbol at the cursor position.
 *
 * Reuses getSymbolScope (scope determination) and findScopedReferences
 * (AST traversal) from the rename infrastructure.
 */

import type { Location, Position } from "vscode-languageserver/node";
import { makeRange } from "../core/position-utils";
import type { ReferencesIndex } from "../shared/references-index";
import type { Symbols } from "../core/symbol-index";
import { parseWithCache } from "../../../shared/parsers/fallout-ssl";
import { ScopeKind } from "./scope-kinds";
import { getSymbolScope } from "./symbol-scope";
import { findScopedReferences } from "./reference-finder";
import { rivalDefinitionUris } from "./symbol-definitions";
import { getLocalDefinition } from "./definition";

/**
 * Filter out the declaration location from a set of references.
 * Uses getLocalDefinition to find the declaration, then excludes the matching location.
 */
function excludeDeclaration(locations: Location[], text: string, uri: string, position: Position): Location[] {
    const defLocation = getLocalDefinition(text, uri, position);
    if (!defLocation) {
        return locations;
    }
    // Guard on URI: cross-file refs at the same line/column must not be excluded
    return locations.filter(
        (loc) =>
            loc.uri !== uri ||
            loc.range.start.line !== defLocation.range.start.line ||
            loc.range.start.character !== defLocation.range.start.character,
    );
}

/**
 * Find all references to the symbol at the given position.
 *
 * For locally defined symbols (procedures, macros, variables), uses scope-aware
 * AST traversal. When a ReferencesIndex is provided, cross-file references
 * are included for file-scoped symbols.
 *
 * For symbols not defined in the current file (e.g., a macro from an included
 * header), falls back to the ReferencesIndex for cross-file references and
 * file-scope AST search for local occurrences.
 */
export function findReferences(
    text: string,
    position: Position,
    uri: string,
    includeDeclaration: boolean,
    refsIndex?: ReferencesIndex,
    symbols?: Symbols,
): Location[] {
    const tree = parseWithCache(text);
    if (!tree) {
        return [];
    }

    const scopeInfo = getSymbolScope(tree.rootNode, position);
    if (!scopeInfo) {
        return [];
    }

    if (scopeInfo.scope === ScopeKind.External) {
        // Symbol not defined in the current file - fall back to cross-file lookup.
        // This handles cases like GVAR_DEN_GANGWAR used in den.h but defined in global.h.
        if (!refsIndex) {
            return [];
        }
        // Get cross-file references from the index (includes current file)
        const crossFileRefs = refsIndex.lookup(scopeInfo.name);
        // Also search the current file for matching identifiers using file-scope traversal
        const fileScopeInfo = { name: scopeInfo.name, scope: ScopeKind.File };
        const localNodes = findScopedReferences(tree.rootNode, fileScopeInfo);
        const localLocations = localNodes.map((node) => ({ uri, range: makeRange(node) }));
        // Merge: local refs + cross-file refs (excluding current file to avoid duplicates)
        const externalRefs = crossFileRefs.filter((loc) => loc.uri !== uri);
        const allLocations = [...localLocations, ...externalRefs];
        return includeDeclaration ? allLocations : excludeDeclaration(allLocations, text, uri, position);
    }

    const refNodes = findScopedReferences(tree.rootNode, scopeInfo);
    if (refNodes.length === 0) {
        return [];
    }

    const localLocations = refNodes.map((node) => ({
        uri,
        range: makeRange(node),
    }));

    // For file-scoped symbols, add cross-file references from the index
    let allLocations = localLocations;
    if (scopeInfo.scope === ScopeKind.File && refsIndex) {
        // Reaching this branch means the CURRENT file defines the symbol, so any other file that also defines
        // it at file scope has its own unrelated symbol of that name, and its occurrences are not references to
        // this one. Fallout dialogs make that the common case rather than an edge: nearly every script defines
        // its own `Node004`, so without this every sibling script's `Node004` came back as a reference. Rename
        // has always applied the rule (it skips a candidate file that redefines the name); this is the same
        // rule on the read side, which is what keeps the two agreeing about what a reference is.
        const rivals = symbols ? rivalDefinitionUris(symbols, scopeInfo.name, uri) : new Set<string>();
        const crossFileRefs = refsIndex.lookup(scopeInfo.name).filter((loc) => loc.uri !== uri && !rivals.has(loc.uri));
        allLocations = [...localLocations, ...crossFileRefs];
    }

    return includeDeclaration ? allLocations : excludeDeclaration(allLocations, text, uri, position);
}
