/**
 * Shared position and range utilities for tree-sitter node conversions.
 *
 * Provides helpers to convert tree-sitter positions/ranges to LSP format.
 */

import type { Node } from "web-tree-sitter";
import type { Position, Range } from "vscode-languageserver/node";

/**
 * Create an LSP Position from tree-sitter row/column.
 * Internal helper for makeRange - not exported as it's only used internally.
 */
function makePosition(row: number, col: number): Position {
    return { line: row, character: col };
}

/**
 * Create an LSP Range from a tree-sitter node.
 */
export function makeRange(node: Node): Range {
    return {
        start: makePosition(node.startPosition.row, node.startPosition.column),
        end: makePosition(node.endPosition.row, node.endPosition.column),
    };
}
