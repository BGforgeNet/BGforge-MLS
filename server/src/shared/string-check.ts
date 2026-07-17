/**
 * Shared string-literal detection factory for tree-sitter-based providers.
 * Creates an isPositionInString function bound to a specific parser and string node types.
 *
 * Sibling of comment-check.ts's createIsInsideComment, but walks ancestors rather than
 * probing only the leaf: a string literal has child tokens (delimiters, content, embedded
 * variable spans), so the leaf node at the cursor is a DESCENDANT of the string node.
 */

import type { Position } from "vscode-languageserver/node";
import type { Node as SyntaxNode } from "web-tree-sitter";
import { classifyAtCursorBoundary } from "./comment-check";

/**
 * Create a "is this position inside a string literal?" check for a specific language.
 *
 * Routes through classifyAtCursorBoundary (the same end-of-line boundary probe comment detection
 * uses) but walks ANCESTORS inside the classifier: a string literal has child tokens (delimiters,
 * content, embedded variable spans), so the leaf at the cursor is a descendant of the string node.
 *
 * @param isInitialized - Check if the language parser is ready
 * @param parseWithCache - Parse text using the language's cached parser
 * @param stringTypes - Set of tree-sitter node type strings considered string literals
 */
export function createIsInsideString(
    isInitialized: () => boolean,
    parseWithCache: (text: string) => { rootNode: SyntaxNode } | null,
    stringTypes: ReadonlySet<string>,
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
            classifyAtCursorBoundary(tree.rootNode, position, (node) => {
                for (let n: SyntaxNode | null = node; n; n = n.parent) {
                    if (stringTypes.has(n.type)) {
                        return true;
                    }
                }
                return null;
            }) === true
        );
    };
}
