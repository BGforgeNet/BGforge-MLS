/**
 * Shared folding range extraction from tree-sitter ASTs.
 *
 * Walks the AST and produces FoldingRange[] for block-level nodes and multi-line comments.
 * Each language provider passes its own set of foldable node types.
 */

import { type FoldingRange, FoldingRangeKind } from "vscode-languageserver/node";
import type { Node as SyntaxNode } from "web-tree-sitter";

/** Comment node type names recognized across all grammars. */
const COMMENT_TYPES = new Set(["comment", "line_comment"]);

/**
 * Create a bound foldingRanges method for a language provider.
 * Eliminates repeated init/parse/fold boilerplate across providers.
 */
export function createFoldingRangesProvider(
    isInitialized: () => boolean,
    parseWithCache: (text: string) => { rootNode: SyntaxNode } | null,
    blockTypes: ReadonlySet<string>,
): (text: string) => FoldingRange[] {
    return (text) => {
        if (!isInitialized()) {
            return [];
        }
        const tree = parseWithCache(text);
        if (!tree) {
            return [];
        }
        return getFoldingRanges(tree.rootNode, blockTypes);
    };
}

/**
 * Extract folding ranges from a tree-sitter AST.
 *
 * Walks the tree recursively, producing a FoldingRange for each multi-line node
 * whose type is in `blockTypes` or is a comment type.
 *
 * @param rootNode - The tree-sitter root node to walk
 * @param blockTypes - Set of node type strings that should be foldable (language-specific)
 * @returns Array of FoldingRange objects
 */
export function getFoldingRanges(rootNode: SyntaxNode, blockTypes: ReadonlySet<string>): FoldingRange[] {
    const ranges: FoldingRange[] = [];
    walkNode(rootNode, blockTypes, ranges);
    return ranges;
}

function walkNode(node: SyntaxNode, blockTypes: ReadonlySet<string>, ranges: FoldingRange[]): void {
    for (const child of node.children) {
        const startLine = child.startPosition.row;
        const endLine = child.endPosition.row;

        // Only fold nodes spanning more than one line
        if (endLine > startLine) {
            if (COMMENT_TYPES.has(child.type)) {
                ranges.push({ startLine, endLine, kind: FoldingRangeKind.Comment });
            } else if (blockTypes.has(child.type)) {
                ranges.push({ startLine, endLine });
            }
        }

        // Recurse into children for nested blocks
        walkNode(child, blockTypes, ranges);
    }
}
