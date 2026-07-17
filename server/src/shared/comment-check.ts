/**
 * Shared comment detection factory for tree-sitter-based providers.
 * Creates an isInsideComment function bound to a specific parser and comment types.
 */

import type { Position } from "vscode-languageserver/node";
import type { Node as SyntaxNode } from "web-tree-sitter";

/**
 * Classify a position by probing the leaf node at the cursor, then - if that yields nothing - the
 * character immediately before it. Returns the first non-null classification, or null.
 *
 * Tree-sitter node ranges are half-open [start, end): a line comment ends at end-of-line, so
 * descendantForPosition at the final column resolves to the parent code node. That final column is
 * exactly where the cursor sits while typing at the end of a `//` line, so probing only the cursor
 * column misclassifies it as code. The one-column-back probe catches that boundary case.
 */
export function classifyAtCursorBoundary<T>(
    root: SyntaxNode,
    position: Position,
    classify: (node: SyntaxNode) => T | null,
): T | null {
    const at = root.descendantForPosition({ row: position.line, column: position.character });
    const hit = at ? classify(at) : null;
    if (hit !== null) {
        return hit;
    }
    if (position.character > 0) {
        const before = root.descendantForPosition({ row: position.line, column: position.character - 1 });
        if (before) {
            return classify(before);
        }
    }
    return null;
}

/**
 * Create a comment check function for a specific language.
 * The returned function checks if a position falls inside a comment node.
 *
 * @param isInitialized - Check if the language parser is ready
 * @param parseWithCache - Parse text using the language's cached parser
 * @param commentTypes - Set of tree-sitter node type strings considered comments
 */
export function createIsInsideComment(
    isInitialized: () => boolean,
    parseWithCache: (text: string) => { rootNode: SyntaxNode } | null,
    commentTypes: ReadonlySet<string>,
): (text: string, position: Position) => boolean {
    return (text, position) => {
        if (!isInitialized()) {
            return false;
        }
        const tree = parseWithCache(text);
        if (!tree) {
            return false;
        }
        return (
            classifyAtCursorBoundary(tree.rootNode, position, (node) => (commentTypes.has(node.type) ? true : null)) ===
            true
        );
    };
}
