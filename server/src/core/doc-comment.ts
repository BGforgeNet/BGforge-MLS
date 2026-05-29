/**
 * Locate the JSDoc block comment that documents a definition node.
 *
 * Shared by the language providers (fallout-ssl, weidu-tp2, weidu-d) so the
 * "which comment documents this definition" rule lives in one place.
 *
 * Scans the definition's preceding siblings: line comments and blank lines
 * between the doc comment and the definition are skipped; a non-doc block
 * comment or any real node ends the search. This mirrors how TypeScript
 * associates a JSDoc comment with the following declaration, which is the
 * least-surprising behavior for the JSDoc-style block comments these languages
 * share. Strict line-adjacency (Go/Rust style) would instead hide a doc comment
 * separated from its definition by a blank line.
 */

import type { Node } from "web-tree-sitter";

/** Return the raw text (delimiters included) of the doc comment preceding `node`, or null. */
export function findPrecedingDocComment(node: Node): string | null {
    let sibling = node.previousNamedSibling;
    while (sibling) {
        const text = sibling.text;
        if (text.startsWith("/**")) {
            return text;
        }
        // Skip line comments; stop at a non-doc block comment or any real node.
        if (!text.startsWith("//")) {
            return null;
        }
        sibling = sibling.previousNamedSibling;
    }
    return null;
}
