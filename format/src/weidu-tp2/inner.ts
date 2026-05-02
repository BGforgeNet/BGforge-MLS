/**
 * INNER_ACTION and INNER_PATCH formatting.
 * These allow running actions from patch context or patches on string buffers.
 */

import type { Node as SyntaxNode } from "web-tree-sitter";
import { type FormatContext, KW_BEGIN, KW_END } from "./types";
import {
    isComment,
    isKeyword,
    isAction,
    isPatch,
    isControlFlow,
    isFunctionCall,
    isCopyAction,
    normalizeWhitespace,
    handleComment,
    pushBlankIfGap,
} from "./utils";
import { SyntaxType } from "../../../server/src/weidu-tp2/tree-sitter.d";

// ============================================
// INNER_ACTION formatting
// ============================================

/**
 * Format INNER_ACTION blocks.
 * INNER_ACTION allows running top-level actions from within a patch context.
 * Structure: INNER_ACTION BEGIN <actions> END
 */
export function formatInnerAction(
    node: SyntaxNode,
    ctx: FormatContext,
    depth: number,
    formatNode: (node: SyntaxNode, ctx: FormatContext, depth: number) => string,
): string {
    const indent = ctx.indent.repeat(depth);
    const bodyIndent = ctx.indent.repeat(depth + 1);
    const lines: string[] = [];

    lines.push(indent + "INNER_ACTION BEGIN");

    let lastEndRow = -1;
    for (const child of node.children) {
        if (isKeyword(child, KW_BEGIN)) {
            lastEndRow = child.startPosition.row;
            continue;
        }
        if (isKeyword(child, KW_END)) {
            continue;
        }
        if (child.type === SyntaxType.Identifier && child.text.toUpperCase() === "INNER_ACTION") {
            continue;
        }

        if (isComment(child)) {
            lastEndRow = handleComment(lines, child, bodyIndent, lastEndRow);
        } else if (
            isAction(child.type) ||
            isCopyAction(child.type) ||
            isControlFlow(child.type) ||
            isFunctionCall(child.type) ||
            child.type === SyntaxType.InlinedFile
        ) {
            pushBlankIfGap(lines, child, lastEndRow);
            lines.push(formatNode(child, ctx, depth + 1));
            lastEndRow = child.endPosition.row;
        }
    }

    lines.push(indent + KW_END);
    return lines.join("\n");
}

// ============================================
// INNER_PATCH formatting
// ============================================

/** Check if a node is valid INNER_PATCH body content. */
function isInnerPatchBodyContent(type: string): boolean {
    return isPatch(type) || isControlFlow(type) || isFunctionCall(type);
}

/**
 * Format INNER_PATCH / INNER_PATCH_SAVE blocks.
 * These execute patches on a string buffer.
 * Structure: INNER_PATCH[_SAVE var] buffer BEGIN <patches> END
 */
export function formatInnerPatch(
    node: SyntaxNode,
    ctx: FormatContext,
    depth: number,
    formatNode: (node: SyntaxNode, ctx: FormatContext, depth: number) => string,
): string {
    const indent = ctx.indent.repeat(depth);
    const bodyIndent = ctx.indent.repeat(depth + 1);
    const lines: string[] = [];

    // Determine keyword (INNER_PATCH, INNER_PATCH_SAVE, or INNER_PATCH_FILE)
    let keyword = "INNER_PATCH";
    for (const child of node.children) {
        if (child.text === "INNER_PATCH" || child.text === "INNER_PATCH_SAVE" || child.text === "INNER_PATCH_FILE") {
            keyword = child.text;
            break;
        }
    }

    // Build header: INNER_PATCH[_SAVE var] buffer
    const headerParts: string[] = [keyword];

    // For INNER_PATCH_SAVE, add the var field if present
    const varNode = node.childForFieldName("var");
    if (varNode) {
        headerParts.push(normalizeWhitespace(varNode.text));
    }

    // Add buffer field if present (for INNER_PATCH/INNER_PATCH_SAVE)
    const bufferNode = node.childForFieldName("buffer");
    if (bufferNode) {
        headerParts.push(normalizeWhitespace(bufferNode.text));
    }

    // Add file field if present (for INNER_PATCH_FILE)
    const fileNode = node.childForFieldName("file");
    if (fileNode) {
        headerParts.push(normalizeWhitespace(fileNode.text));
    }

    // Output header + BEGIN
    const header = headerParts.join(" ") + " " + KW_BEGIN;
    lines.push(indent + header);

    // Process body content (patches)
    let lastEndRow = -1;
    for (const child of node.children) {
        if (isKeyword(child, KW_BEGIN)) {
            lastEndRow = child.startPosition.row;
            continue;
        }
        if (isKeyword(child, KW_END)) {
            continue;
        }
        // Skip keyword identifier
        if (child.text === keyword) {
            continue;
        }
        // Skip var, buffer, and file nodes (already handled via named fields)
        if (child === varNode || child === bufferNode || child === fileNode) {
            continue;
        }

        // Body content (patches and comments)
        if (isComment(child)) {
            lastEndRow = handleComment(lines, child, bodyIndent, lastEndRow);
        } else if (isInnerPatchBodyContent(child.type)) {
            pushBlankIfGap(lines, child, lastEndRow);
            lines.push(formatNode(child, ctx, depth + 1));
            lastEndRow = child.endPosition.row;
        }
    }

    lines.push(indent + KW_END);
    return lines.join("\n");
}

// ============================================
// REPLACE_BCS_BLOCK formatting
// ============================================

/**
 * Format REPLACE_BCS_BLOCK / R_B_B patches.
 * Structure: R_B_B [CASE_SENSITIVE|CASE_INSENSITIVE] file+ [ON_MISMATCH <patches> END]
 */
export function formatReplaceBcsBlock(
    node: SyntaxNode,
    ctx: FormatContext,
    depth: number,
    formatNode: (node: SyntaxNode, ctx: FormatContext, depth: number) => string,
): string {
    const indent = ctx.indent.repeat(depth);
    const bodyIndent = ctx.indent.repeat(depth + 1);
    const lines: string[] = [];

    // Collect header parts and detect ON_MISMATCH
    const headerParts: string[] = [];
    let inOnMismatch = false;
    let hasOnMismatch = false;
    let lastEndRow = -1;

    for (const child of node.children) {
        const textUpper = child.text.toUpperCase();

        // Keywords
        if (textUpper === "R_B_B" || textUpper === "REPLACE_BCS_BLOCK") {
            headerParts.push(child.text);
            continue;
        }
        if (textUpper === "CASE_SENSITIVE" || textUpper === "CASE_INSENSITIVE") {
            headerParts.push(child.text);
            continue;
        }
        if (textUpper === "ON_MISMATCH") {
            hasOnMismatch = true;
            inOnMismatch = true;
            // Output header first, then ON_MISMATCH
            lines.push(indent + headerParts.join(" "));
            lines.push(indent + "ON_MISMATCH");
            lastEndRow = child.startPosition.row;
            continue;
        }
        if (textUpper === "END") {
            continue;
        }

        // File strings (before ON_MISMATCH)
        if (!inOnMismatch && child.type === SyntaxType.String) {
            headerParts.push(child.text);
            continue;
        }

        // Body content (after ON_MISMATCH)
        if (inOnMismatch) {
            if (isComment(child)) {
                lastEndRow = handleComment(lines, child, bodyIndent, lastEndRow);
            } else if (isPatch(child.type) || isControlFlow(child.type) || isFunctionCall(child.type)) {
                pushBlankIfGap(lines, child, lastEndRow);
                lines.push(formatNode(child, ctx, depth + 1));
                lastEndRow = child.endPosition.row;
            }
        }
    }

    // If no ON_MISMATCH, output as single line
    if (!hasOnMismatch) {
        return indent + headerParts.join(" ");
    }

    lines.push(indent + KW_END);
    return lines.join("\n");
}
