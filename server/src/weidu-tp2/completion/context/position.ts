/**
 * Position utilities for TP2 completion context.
 * Provides BEGIN...END block boundary detection for function call/definition context detection.
 */

import type { Node as SyntaxNode } from "web-tree-sitter";
import { SyntaxType } from "../../tree-sitter.d";
import { KW_BEGIN, KW_END } from "@bgforge/format";

/**
 * BEGIN/END block boundary positions.
 * Used by function definitions and control flow constructs.
 */
interface BlockBoundaries {
    /** Byte offset where BEGIN keyword ends (after the BEGIN keyword) */
    beginEnd: number;
    /** Byte offset where END keyword starts (before the END keyword) */
    endStart: number;
    /** Optional: byte offset where function name ends (used for detecting funcParams context) */
    functionNameEnd?: number;
}

/**
 * Find BEGIN and END keyword positions in a node.
 * Returns -1 for missing keywords.
 *
 * @param node Node to search (typically a function definition or control flow construct)
 * @param trackFunctionName If true, also track the first identifier (function name)
 * @returns Boundary positions
 */
export function findBeginEndBoundaries(node: SyntaxNode, trackFunctionName = false): BlockBoundaries {
    let beginEnd = -1;
    let endStart = -1;
    let functionNameEnd = -1;

    for (const child of node.children) {
        if (child.type === KW_BEGIN) {
            beginEnd = child.endIndex;
        } else if (child.type === KW_END) {
            endStart = child.startIndex;
        } else if (trackFunctionName && child.type === SyntaxType.Identifier && functionNameEnd < 0) {
            // First identifier is the function name
            functionNameEnd = child.endIndex;
        }
    }

    return { beginEnd, endStart, functionNameEnd };
}
