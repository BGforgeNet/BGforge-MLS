/**
 * Shared selection-range extraction from tree-sitter ASTs.
 *
 * For a requested position, finds the smallest node containing it, then walks up
 * through `.parent` links to build one LSP SelectionRange chain per position -
 * innermost first, each linked to the next via `parent`. A language provider only
 * needs to supply its own parser; the walk itself needs no language-specific node
 * types since it climbs generic `.parent` links.
 */

import { type Position, SelectionRange } from "vscode-languageserver/node";
import type { Node as SyntaxNode } from "web-tree-sitter";
import { makeRange } from "../core/position-utils";

/** True when two tree-sitter nodes cover the same source span. */
function sameSpan(a: SyntaxNode, b: SyntaxNode): boolean {
    return (
        a.startPosition.row === b.startPosition.row &&
        a.startPosition.column === b.startPosition.column &&
        a.endPosition.row === b.endPosition.row &&
        a.endPosition.column === b.endPosition.column
    );
}

/**
 * Build the selection-range chain for a single position within a parsed tree.
 *
 * Ancestors whose span is identical to their child's are skipped: a duplicate
 * range at consecutive chain links makes VS Code's Expand Selection command
 * appear stuck (each keystroke performs no visible expansion).
 */
export function getSelectionRange(rootNode: SyntaxNode, position: Position): SelectionRange {
    const start = rootNode.descendantForPosition({ row: position.line, column: position.character });

    const distinctAncestors: SyntaxNode[] = [];
    // descendantForPosition is typed as always returning a node, but the WASM
    // binding can hand back null at the edges of an unparseable document -
    // guard the same way the rest of the codebase does (see comment-check.ts).
    let current: SyntaxNode | null = start;
    while (current) {
        const innermost = distinctAncestors[distinctAncestors.length - 1];
        if (!innermost || !sameSpan(innermost, current)) {
            distinctAncestors.push(current);
        }
        current = current.parent;
    }

    let chain: SelectionRange | undefined;
    for (let i = distinctAncestors.length - 1; i >= 0; i--) {
        chain = SelectionRange.create(makeRange(distinctAncestors[i]!), chain);
    }

    // distinctAncestors is empty only when descendantForPosition returned null
    // (the defensive WASM-binding case above); fall back to a zero-width range
    // at the requested position so every input still yields a valid chain.
    return chain ?? SelectionRange.create({ start: position, end: position });
}

/**
 * Create a bound selectionRanges method for a language provider.
 * Eliminates repeated init/parse boilerplate across providers, mirroring
 * createFoldingRangesProvider in folding-ranges.ts.
 */
export function createSelectionRangesProvider(
    isInitialized: () => boolean,
    parseWithCache: (text: string) => { rootNode: SyntaxNode } | null,
): (text: string, positions: Position[]) => SelectionRange[] {
    return (text, positions) => {
        if (!isInitialized()) {
            return [];
        }
        const tree = parseWithCache(text);
        if (!tree) {
            return [];
        }
        return positions.map((position) => getSelectionRange(tree.rootNode, position));
    };
}
