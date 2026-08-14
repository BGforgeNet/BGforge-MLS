/**
 * Locating parse errors in a tree-sitter tree.
 *
 * Tree-sitter always returns a tree, inserting ERROR and MISSING nodes where the input did not fit the
 * grammar, so every consumer that walks a tree for meaning - a formatter, a compiler, the editor's live
 * diagnostics - has to decide what to do about them. What they need differs: a formatter refuses at the
 * first one, while a compiler and the editor want every one at once. The wording of each refusal is that
 * consumer's own contract, so only the search lives here.
 */

import type { Node as SyntaxNode } from "web-tree-sitter";

/** Whether this node is itself a parse error, as opposed to merely containing one. */
function isParseError(node: SyntaxNode): boolean {
    return node.type === "ERROR" || node.isError || node.isMissing;
}

/**
 * The first ERROR or MISSING node in document order, or null when the tree is clean. Kept separate from
 * `collectParseErrors` for its short circuit: a clean tree costs one check rather than a full walk, and a
 * broken one stops at the first hit instead of walking every damaged region. It returns exactly what
 * `collectParseErrors(node)[0]` would - the two walk the tree the same way, which a test pins.
 */
export function findParseError(node: SyntaxNode): SyntaxNode | null {
    if (isParseError(node)) return node;
    if (!node.hasError) return null;
    for (const child of node.children) {
        if (!child) continue;
        const error = findParseError(child);
        if (error) return error;
    }
    return null;
}

/**
 * Every ERROR or MISSING node, in document order.
 *
 * An ERROR node's descendants are recovery debris rather than further mistakes, so the walk does not
 * descend into one - reporting them too would bury the real problem under a pile of derived noise. That
 * single rule is what makes reporting all of them useful rather than overwhelming, and it is why this is
 * a shared walk instead of a `hasError` loop written per consumer.
 */
export function collectParseErrors(node: SyntaxNode): SyntaxNode[] {
    const errors: SyntaxNode[] = [];
    collect(node, errors);
    return errors;
}

function collect(node: SyntaxNode, errors: SyntaxNode[]): void {
    if (isParseError(node)) {
        errors.push(node);
        return;
    }
    if (!node.hasError) return;
    for (const child of node.children) {
        if (child) collect(child, errors);
    }
}
