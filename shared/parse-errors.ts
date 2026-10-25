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
import { SyntaxType as Ssl } from "./syntax-types/fallout-ssl";

/**
 * The zero-width node a grammar's scanner plants where it closed a construct the source left open (the WeiDU D
 * grammar's state END; the Fallout SSL grammar's `)`, `]`, `}` or procedure `begin`), so that what follows keeps
 * its shape. It parses as valid structure, so tree-sitter flags nothing; this module is where every consumer
 * learns it is a syntax error all the same: a missing token, named by `implicitEndToken`.
 */
export const IMPLICIT_END = "implicit_end";

/** Whether this node is an implicit END: a construct's closer the source lacks. */
export function isImplicitEnd(node: SyntaxNode): boolean {
    return node.type === IMPLICIT_END;
}

/** Per grammar (its language name), the token an implicit END stands for, by the construct holding it. */
const IMPLICIT_TOKENS: ReadonlyMap<string, ReadonlyMap<string, string>> = new Map([
    [
        "ssl",
        new Map([
            [Ssl.ParamList, ")"],
            [Ssl.ArrayExpr, "]"],
            [Ssl.MapExpr, "}"],
            [Ssl.Procedure, "begin"],
        ]),
    ],
]);

/** The token an implicit END stands for: `END` unless its grammar closes more than one kind of construct. */
export function implicitEndToken(node: SyntaxNode): string {
    return IMPLICIT_TOKENS.get(node.tree.language.name ?? "")?.get(node.parent?.type ?? "") ?? "END";
}

/** Whether this node is itself a parse error, as opposed to merely containing one. */
function isParseError(node: SyntaxNode): boolean {
    // oxlint-disable-next-line bgforge-syntax/no-node-type-literal -- grammar-agnostic: every grammar's enum spells ERROR the same way, and this module serves all of them
    return node.type === "ERROR" || node.isError || node.isMissing;
}

/**
 * The implicit ENDs under `node` that sit outside any ERROR node, in document order. Their ancestors carry no
 * error flag, so they are found by type; a grammar without the node type is skipped without a walk.
 */
function implicitEnds(node: SyntaxNode): SyntaxNode[] {
    if (node.tree.language.idForNodeType(IMPLICIT_END, true) === null) return [];
    return node.descendantsOfType(IMPLICIT_END).filter((end): end is SyntaxNode => end !== null && !insideError(end));
}

function insideError(node: SyntaxNode): boolean {
    for (let parent = node.parent; parent; parent = parent.parent) {
        if (isParseError(parent)) return true;
    }
    return false;
}

/**
 * Whether the tree under `node` has a syntax error: an ERROR or MISSING node, or an implicit END. The one check
 * every consumer that must not treat a broken file as valid - diagnostics, a formatter, a model writer - makes.
 */
export function hasSyntaxError(node: SyntaxNode): boolean {
    return findParseError(node) !== null;
}

/**
 * The first syntax error (see `hasSyntaxError`) in document order, or null when the tree is clean. Kept separate
 * from `collectParseErrors` for its short circuit: a clean tree costs one check rather than a full walk, and a
 * broken one stops at the first hit instead of walking every damaged region. It returns exactly what
 * `collectParseErrors(node)[0]` would, which a test pins.
 */
export function findParseError(node: SyntaxNode): SyntaxNode | null {
    const error = findErrorNode(node);
    const end = implicitEnds(node)[0];
    if (!end) return error;
    // On a tie the implicit END comes first: it closes the inner construct, and a MISSING token recovery inserted
    // at the same offset completes the statement around it (`[1, 2` before `end` lacks `]`, then `;`).
    return error && error.startIndex < end.startIndex ? error : end;
}

function findErrorNode(node: SyntaxNode): SyntaxNode | null {
    if (isParseError(node)) return node;
    if (!node.hasError) return null;
    for (const child of node.children) {
        if (!child) continue;
        const error = findErrorNode(child);
        if (error) return error;
    }
    return null;
}

/**
 * Every syntax error: each ERROR or MISSING node and each implicit END, in document order.
 *
 * An ERROR node's descendants are recovery debris rather than further mistakes, so the walk does not
 * descend into one - reporting them too would bury the real problem under a pile of derived noise. That
 * single rule is what makes reporting all of them useful rather than overwhelming, and it is why this is
 * a shared walk instead of a `hasError` loop written per consumer.
 */
export function collectParseErrors(node: SyntaxNode): SyntaxNode[] {
    const errors: SyntaxNode[] = [];
    collect(node, errors);
    const ends = implicitEnds(node);
    if (ends.length === 0) return errors;
    // A stable sort, so an implicit END keeps its place ahead of an error at the same offset (see findParseError).
    return [...ends, ...errors].sort((a, b) => a.startIndex - b.startIndex);
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
