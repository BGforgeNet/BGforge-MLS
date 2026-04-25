/**
 * Predicate action formatting (REQUIRE_PREDICATE).
 */

import type { Node as SyntaxNode } from "web-tree-sitter";
import type { FormatContext } from "./types";
import { normalizeWhitespace, withNormalizedComment } from "./utils";
import { formatCondition } from "./control-flow";

/**
 * Format REQUIRE_PREDICATE action.
 * Structure: REQUIRE_PREDICATE condition message
 */
export function formatPredicateAction(node: SyntaxNode, ctx: FormatContext, depth: number): string {
    const indent = ctx.indent.repeat(depth);
    const contIndent = indent + ctx.indent;

    const predicate = node.childForFieldName("predicate");
    const message = node.childForFieldName("message");

    if (!predicate || !message) {
        return withNormalizedComment(indent + normalizeWhitespace(node.text));
    }

    const condLines = formatCondition(predicate, "REQUIRE_PREDICATE", indent, contIndent, ctx.lineLimit);

    if (condLines.length === 1) {
        return condLines[0] + " " + normalizeWhitespace(message.text);
    }

    condLines[condLines.length - 1] += " " + normalizeWhitespace(message.text);
    return condLines.join("\n");
}
