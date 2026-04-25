/**
 * Completion context detection for Fallout SSL.
 * Determines whether the cursor is inside a JSDoc comment, regular comment, or code.
 */

import type { Position } from "vscode-languageserver/node";
import { getLinePrefix } from "../common";
import { isInitialized, parseWithCache } from "../../../shared/parsers/fallout-ssl";
import { SyntaxType } from "./tree-sitter.d";

/** SSL completion context for filterCompletions. */
export enum SslCompletionContext {
    /** Inside a JSDoc block (starts with slash-star-star) */
    Jsdoc = "jsdoc",
    /** Inside a regular comment (block or line) */
    Comment = "comment",
    /** Regular code context */
    Code = "code",
}

/**
 * Detect whether the cursor is inside a JSDoc comment, regular comment, or code.
 * Uses tree-sitter to find the node at cursor position and check its type.
 *
 * @param text Document text
 * @param position Cursor position (0-based line and character)
 * @returns The completion context at the cursor position
 */
export function getSslCompletionContext(text: string, position: Position): SslCompletionContext {
    if (!isInitialized()) {
        return SslCompletionContext.Code;
    }

    const tree = parseWithCache(text);
    if (!tree) {
        return SslCompletionContext.Code;
    }

    const node = tree.rootNode.descendantForPosition({
        row: position.line,
        column: position.character,
    });
    if (!node) {
        return SslCompletionContext.Code;
    }

    if (node.type === SyntaxType.Comment) {
        const commentText = node.text.trimStart();
        if (commentText.startsWith("/**")) {
            return SslCompletionContext.Jsdoc;
        }
        return SslCompletionContext.Comment;
    }

    if (node.type === SyntaxType.LineComment) {
        return SslCompletionContext.Comment;
    }

    return SslCompletionContext.Code;
}

/**
 * Pattern matching SSL declaration sites where the user is naming a new symbol.
 * Matches: procedure <name>, variable <name>, export variable <name>, #define <name>
 *
 * Why regex instead of tree-sitter AST:
 * At declaration sites the user is mid-typing a new identifier (e.g. `procedure fo|`).
 * Tree-sitter cannot produce a valid declaration node for incomplete input — the grammar
 * requires a complete construct, so partial input lands in an ERROR node with no reliable
 * node type to match against. This is a known tree-sitter limitation — error recovery
 * does not produce typed incomplete nodes, only ERROR nodes
 * (see https://github.com/tree-sitter/tree-sitter/issues/923).
 * Line-text regex is the fallback convention used throughout this codebase for similar
 * incomplete-input scenarios.
 * See also: DECLARATION_SITE_PATTERN in weidu-tp2/completion/context/constants.ts.
 */
const SSL_DECLARATION_SITE_PATTERN = /^\s*(?:export\s+)?(?:variable|procedure)\s+\S*$|^\s*#define\s+\S*$/i;

/**
 * Check if the cursor is at an SSL declaration site where completions should be suppressed.
 * The user is typing a new name, not referencing an existing symbol.
 */
export function isSslDeclarationSite(text: string, position: Position): boolean {
    return SSL_DECLARATION_SITE_PATTERN.test(getLinePrefix(text, position));
}
