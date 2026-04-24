/**
 * Context detector for TP2 completion.
 * Only detects function call/definition contexts and comment/JSDoc.
 * All other positions return empty array (no filtering).
 */

import type { Node as SyntaxNode } from "web-tree-sitter";
import { CompletionContext } from "../types";
import { detectFunctionCallContext, detectFunctionDefContext } from "./function-call";

/**
 * Detect context by walking up from cursor node.
 * Only function call/definition contexts are detected.
 * Returns empty array for all other positions (no filtering = show everything).
 */
export function detectContextFromNode(node: SyntaxNode, cursorOffset: number): CompletionContext[] {
    let current: SyntaxNode | null = node;

    while (current) {
        const context =
            detectFunctionCallContext(current, cursorOffset) ?? detectFunctionDefContext(current, cursorOffset);

        if (context) {
            return context;
        }

        current = current.parent;
    }

    // No function call/definition context found -> no filtering
    return [];
}
