/**
 * Rename symbol for Fallout SSL files.
 *
 * Single-file rename: renames locally defined symbols (procedures, variables, exports).
 * Workspace-wide rename: renames symbols defined in workspace headers across all
 * referencing files, using the ReferencesIndex for cross-file lookup.
 */

import { isAbsolute, relative } from "node:path";
import { fileURLToPath } from "node:url";
import type { Node } from "web-tree-sitter";
import {
    OptionalVersionedTextDocumentIdentifier,
    Position,
    TextDocumentEdit,
    TextEdit,
    WorkspaceEdit,
} from "vscode-languageserver/node";
import { normalizeUri } from "../core/normalized-uri";
import type { ReferencesIndex } from "../shared/references-index";
import { SourceType } from "../core/symbol";
import type { Symbols } from "../core/symbol-index";
import { parseWithCache, isInitialized } from "./parser";
import { findIdentifierAtPosition, findIdentifierNodeAtPosition, isLocalDefinition, makeRange } from "./utils";
import { ScopeKind } from "./scope-kinds";
import { type SslSymbolScope, getSymbolScope } from "./symbol-scope";
import { isFileScopeDef } from "./symbol-definitions";
import { findScopedReferences } from "./reference-finder";

/** SSL identifiers: alphanumeric + underscore, must not be empty. */
const VALID_IDENTIFIER = /^[a-zA-Z_][a-zA-Z0-9_]*$/;

/** Check that a resolved path stays within a given base directory. */
function isWithinBase(resolvedPath: string, base: string): boolean {
    const rel = relative(base, resolvedPath);
    return !rel.startsWith("..") && !isAbsolute(rel);
}

/**
 * Prepare for rename by validating the position and returning the range and placeholder.
 * Returns null if rename is not allowed at this position.
 *
 * Scope-aware: only allows rename if the symbol is defined in an accessible scope
 * (the current procedure for locals, or file scope for procedures/macros/exports).
 */
export function prepareRenameSymbol(
    text: string,
    position: Position,
): { range: { start: Position; end: Position }; placeholder: string } | null {
    if (!isInitialized()) {
        return null;
    }

    const tree = parseWithCache(text);
    if (!tree) {
        return null;
    }

    const symbolNode = findIdentifierNodeAtPosition(tree.rootNode, position);
    if (!symbolNode) {
        return null;
    }

    // Determine scope -- null means no identifier at cursor, "external" means not locally defined
    const scopeInfo = getSymbolScope(tree.rootNode, position);
    if (!scopeInfo || scopeInfo.scope === ScopeKind.External) {
        return null;
    }

    return {
        range: {
            start: { line: symbolNode.startPosition.row, character: symbolNode.startPosition.column },
            end: { line: symbolNode.endPosition.row, character: symbolNode.endPosition.column },
        },
        placeholder: symbolNode.text,
    };
}

/**
 * Rename a locally defined symbol with scope awareness.
 * Procedure-scoped symbols are renamed only within their procedure.
 * File-scoped symbols are renamed across the file, skipping procedure-local shadows.
 * Returns null if the symbol at position is not defined in an accessible scope.
 */
export function renameSymbol(text: string, position: Position, newName: string, uri: string): WorkspaceEdit | null {
    if (!isInitialized() || !VALID_IDENTIFIER.test(newName)) {
        return null;
    }

    const tree = parseWithCache(text);
    if (!tree) {
        return null;
    }

    const scopeInfo = getSymbolScope(tree.rootNode, position);
    if (!scopeInfo || scopeInfo.scope === ScopeKind.External) {
        return null;
    }

    const refs = findScopedReferences(tree.rootNode, scopeInfo);
    if (refs.length === 0) {
        return null;
    }

    const edits: TextEdit[] = refs.map((node) => ({
        range: makeRange(node),
        newText: newName,
    }));

    return {
        changes: {
            [uri]: edits,
        },
    };
}

// =============================================================================
// Workspace-wide rename
// =============================================================================

/**
 * Determine the definition URI for a symbol.
 * Returns the URI where the symbol is defined, or null if it can't be determined
 * or if the symbol is from an external/static source (not renameable).
 */
function findDefinitionUri(
    symbolName: string,
    currentUri: string,
    currentRootNode: Node,
    symbolStore: Symbols,
    workspaceRoot: string | undefined,
): { uri: string; isExternal: boolean } | null {
    // Check if defined locally in current file
    if (isLocalDefinition(currentRootNode, symbolName)) {
        if (isFileScopeDef(currentRootNode, symbolName)) {
            return { uri: currentUri, isExternal: false };
        }
        // Function-scoped: not shareable, handled by single-file rename
        return null;
    }

    // Check symbol store (workspace headers, external headers, static)
    const indexed = symbolStore.lookup(symbolName);
    if (!indexed) {
        return null;
    }

    if (indexed.source.type === SourceType.Static) {
        // Built-in symbol, not renameable
        return null;
    }

    if (indexed.source.type === SourceType.Workspace) {
        const defUri = indexed.location?.uri;
        if (!defUri) return null;

        // Check if the definition is inside the workspace (renameable)
        // vs external headersDirectory (read-only)
        if (workspaceRoot && defUri.startsWith("file://")) {
            const defPath = fileURLToPath(defUri);
            return { uri: defUri, isExternal: !isWithinBase(defPath, workspaceRoot) };
        }
        return { uri: defUri, isExternal: false };
    }

    if (indexed.source.type === SourceType.External) {
        const extUri = indexed.location?.uri;
        if (!extUri) return null;
        return { uri: extUri, isExternal: true };
    }

    return null;
}

/**
 * Prepare for workspace-wide rename.
 * Allows rename for symbols defined in workspace headers (not just current file).
 * Returns null if the symbol is not workspace-renameable (falls back to single-file).
 */
export function prepareRenameSymbolWorkspace(
    text: string,
    position: Position,
    symbolStore: Symbols,
    workspaceRoot: string | undefined,
): { range: { start: Position; end: Position }; placeholder: string } | null {
    if (!isInitialized()) {
        return null;
    }

    const tree = parseWithCache(text);
    if (!tree) {
        return null;
    }

    const symbolNode = findIdentifierNodeAtPosition(tree.rootNode, position);
    if (!symbolNode) {
        return null;
    }

    // If locally defined, let single-file prepare handle it
    if (isLocalDefinition(tree.rootNode, symbolNode.text)) {
        return null;
    }

    // Check if it's a workspace-defined symbol (renameable across files)
    const indexed = symbolStore.lookup(symbolNode.text);
    if (!indexed) {
        return null;
    }

    // Only allow rename for workspace symbols (not static/external)
    if (indexed.source.type !== SourceType.Workspace) {
        return null;
    }

    // Check if definition is inside workspace (not external headersDirectory)
    const defUri = indexed.location?.uri;
    if (!defUri) {
        return null;
    }

    if (workspaceRoot && defUri.startsWith("file://")) {
        const defPath = fileURLToPath(defUri);
        if (!isWithinBase(defPath, workspaceRoot)) {
            return null;
        }
    }

    return {
        range: {
            start: { line: symbolNode.startPosition.row, character: symbolNode.startPosition.column },
            end: { line: symbolNode.endPosition.row, character: symbolNode.endPosition.column },
        },
        placeholder: symbolNode.text,
    };
}

/**
 * Rename a symbol across workspace files using the ReferencesIndex.
 *
 * Uses a flat name-based index instead of an include graph to find candidate files.
 * This handles cases where headers use symbols they don't directly #include --
 * e.g., den.h uses GVAR_DEN_GANGWAR from global.h, relying on .ssl files to
 * include both. The index catches all files that reference the name.
 *
 * Algorithm:
 * 1. Find symbol at position, determine definition URI
 * 2. Get all files that reference the symbol name from the ReferencesIndex
 * 3. For each candidate file, re-parse and find scoped references
 * 4. Collect edits into a WorkspaceEdit
 *
 * Performance note: the candidate set is broader than the old include-graph approach --
 * for common names like `i` or `x`, many unrelated files may be re-parsed. Safety checks
 * (isFileScopeDef, findScopedReferences) filter them out correctly, but latency scales
 * with workspace size. Acceptable since renames are infrequent and user-initiated.
 *
 * Returns null if the symbol is not workspace-renameable (caller falls back to single-file).
 */
export function renameSymbolWorkspace(
    text: string,
    position: Position,
    newName: string,
    uri: string,
    refsIndex: ReferencesIndex,
    symbolStore: Symbols,
    getFileText: (uri: string) => string | null,
    workspaceRoot: string | undefined,
    debugLog?: (msg: string) => void,
): WorkspaceEdit | null {
    if (!isInitialized() || !VALID_IDENTIFIER.test(newName)) {
        return null;
    }

    const tree = parseWithCache(text);
    if (!tree) {
        return null;
    }

    const symbolName = findIdentifierAtPosition(tree.rootNode, position);
    if (!symbolName) {
        debugLog?.(`rename: no identifier at position ${position.line}:${position.character}`);
        return null;
    }

    debugLog?.(`rename: symbol="${symbolName}" uri=${uri}`);

    // Determine where the symbol is defined
    const defInfo = findDefinitionUri(symbolName, uri, tree.rootNode, symbolStore, workspaceRoot);
    if (!defInfo) {
        // Not a workspace-scope symbol (e.g., function-scoped variable)
        debugLog?.(`rename: findDefinitionUri returned null (not a workspace-scope symbol)`);
        return null;
    }

    if (defInfo.isExternal) {
        // Symbol defined in external headers (read-only): not renameable
        debugLog?.(`rename: symbol defined in external headers (read-only), uri=${defInfo.uri}`);
        return null;
    }

    // Normalize URIs to prevent encoding mismatches (e.g., %21 vs ! on Windows).
    // The registry gateway already normalizes `uri`, so normalizeUri is idempotent here.
    // defInfo.uri comes from the symbol store and genuinely needs normalization.
    const normUri = normalizeUri(uri);
    const definitionUri = normalizeUri(defInfo.uri);
    debugLog?.(`rename: definitionUri=${definitionUri}`);

    // Collect candidate files from the ReferencesIndex (all files that reference this name)
    const indexedUris = refsIndex.lookupUris(symbolName);
    debugLog?.(`rename: ReferencesIndex returned ${indexedUris.size} file(s) for "${symbolName}"`);

    // Always include the definition file and current file as safety nets
    const candidateUris = new Set(indexedUris);
    candidateUris.add(definitionUri);
    candidateUris.add(normUri);

    debugLog?.(`rename: ${candidateUris.size} candidate files to scan`);

    // Build edits for each candidate file.
    // Uses documentChanges format (TextDocumentEdit[]) so VS Code treats the
    // entire rename as a single atomic undo operation across all files.
    const documentChanges: TextDocumentEdit[] = [];
    const fileScopeInfo: SslSymbolScope = { name: symbolName, scope: ScopeKind.File };

    for (const candidateUri of candidateUris) {
        const candidateText = candidateUri === normUri ? text : getFileText(candidateUri);

        if (!candidateText) {
            debugLog?.(`rename: skipping ${candidateUri} (could not read file text)`);
            continue;
        }

        const candidateTree = parseWithCache(candidateText);
        if (!candidateTree) {
            debugLog?.(`rename: skipping ${candidateUri} (parse failed)`);
            continue;
        }

        // For consuming files: skip entirely if the symbol is redefined at file scope
        // (a different procedure/macro/export with the same name). Procedure-local
        // shadows are handled by findScopedReferences (it skips those subtrees).
        if (candidateUri !== definitionUri && isFileScopeDef(candidateTree.rootNode, symbolName)) {
            debugLog?.(`rename: skipping ${candidateUri} (symbol redefined at file scope)`);
            continue;
        }

        // Use file-scoped reference finding with shadow exclusion:
        // skips procedures that have a local definition of the same name
        const refs = findScopedReferences(candidateTree.rootNode, fileScopeInfo);
        if (refs.length === 0) {
            debugLog?.(`rename: skipping ${candidateUri} (no references found)`);
            continue;
        }

        debugLog?.(`rename: ${candidateUri} -> ${refs.length} reference(s)`);

        const edits: TextEdit[] = refs.map((node) => ({
            range: makeRange(node),
            newText: newName,
        }));

        documentChanges.push(
            TextDocumentEdit.create(
                // version: null means "apply regardless of current version"
                OptionalVersionedTextDocumentIdentifier.create(candidateUri, null),
                edits,
            ),
        );
    }

    if (documentChanges.length === 0) {
        debugLog?.(`rename: no edits produced across all candidates`);
        return null;
    }

    debugLog?.(`rename: workspace edit covers ${documentChanges.length} file(s)`);
    return { documentChanges };
}
