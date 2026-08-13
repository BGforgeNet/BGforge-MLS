/**
 * Locating the first parse error in a tree-sitter tree.
 *
 * Tree-sitter always returns a tree, inserting ERROR and MISSING nodes where the input did not fit the
 * grammar, so every consumer that walks a tree for meaning - a formatter, a compiler - has to decide
 * what to do about them. Both refuse, and both need the same first-error position to say where; the
 * wording of the refusal is each consumer's own contract, so only the search lives here.
 */

import type { Node as SyntaxNode } from "web-tree-sitter";

/**
 * The first ERROR or MISSING node in document order, or null when the tree is clean. Subtrees without
 * `hasError` are skipped, so a clean tree costs one check rather than a full walk.
 */
export function findParseError(node: SyntaxNode): SyntaxNode | null {
    if (node.type === "ERROR" || node.isMissing) return node;
    if (!node.hasError) return null;
    for (const child of node.children) {
        if (!child) continue;
        const error = findParseError(child);
        if (error) return error;
    }
    return null;
}
