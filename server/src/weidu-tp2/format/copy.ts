/**
 * COPY action formatting: COPY, COPY_EXISTING, COPY_LARGE, etc.
 * Handles file pairs, patches, and suffix keywords (BUT_ONLY, IF_EXISTS).
 */

import type { Node as SyntaxNode } from "web-tree-sitter";
import {
    type FormatContext,
    KW_BEGIN,
    KW_END,
    KW_BUT_ONLY,
    KW_BUT_ONLY_IF_IT_CHANGES,
    KW_IF_EXISTS,
    KW_UNLESS,
    KW_IF,
    INLINE_COMMENT_SPACING,
    throwFormatError,
} from "./types";
import {
    isComment,
    isKeyword,
    isPatch,
    isControlFlow,
    isFunctionCall,
    normalizeComment,
    normalizeWhitespace,
    handleComment,
} from "./utils";
import { SyntaxType } from "../tree-sitter.d";

// ============================================
// Types
// ============================================

/** Collected parts of a COPY action for formatting. */
interface CopyActionParts {
    keyword: string;
    filePairs: string[];
    /** Inline comment on the header line (same row as last file pair). */
    headerComment: string;
    patches: SyntaxNode[];
    suffix: string[];
}

// ============================================
// COPY action parsing
// ============================================

/** Check if a node is a file pair type. */
function isFilePairType(type: string): boolean {
    return (
        type === "file_pair" || type === "copy_random_item" || type === "copy_large_item" || type === "copy_2da_item"
    );
}

/** Check if a node is a patch or patch-related content. */
function isPatchContent(type: string): boolean {
    return (
        isPatch(type) ||
        isControlFlow(type) ||
        isFunctionCall(type) ||
        type === "patch_block" ||
        type === "patches" ||
        type === "if_filter" ||
        type === "inner_action"
    );
}

/** Check if a node is a suffix keyword. */
function isSuffixKeyword(child: SyntaxNode): boolean {
    return (
        isKeyword(child, KW_BUT_ONLY) || isKeyword(child, KW_BUT_ONLY_IF_IT_CHANGES) || isKeyword(child, KW_IF_EXISTS)
    );
}

/**
 * Parse a 'when' node and extract its parts as suffix strings.
 * The 'when' node can contain: IF value, UNLESS value, IF_SIZE_IS value, IF_EXISTS, BUT_ONLY, BUT_ONLY_IF_IT_CHANGES
 */
function parseWhenNode(node: SyntaxNode): string[] {
    const result: string[] = [];
    const children = node.children;

    for (let i = 0; i < children.length; i++) {
        const child = children[i];
        if (!child) continue;

        // Skip comments - they'll be output separately
        if (isComment(child)) {
            result.push(normalizeComment(child.text));
            continue;
        }

        const text = child.text;

        // Standalone keywords
        if (text === "IF_EXISTS" || text === "BUT_ONLY" || text === "BUT_ONLY_IF_IT_CHANGES") {
            result.push(text);
            continue;
        }

        // Keywords with values: IF, UNLESS, IF_SIZE_IS
        // Skip any intervening comments to find the value, but collect them first
        if (text === "IF" || text === "UNLESS" || text === "IF_SIZE_IS") {
            let valueIdx = i + 1;
            const commentsBetween: string[] = [];
            // Collect comments between keyword and value.
            // The `children[valueIdx] &&` truthy check inside the condition narrows
            // the value in-place under noUncheckedIndexedAccess, but the narrowing
            // does not propagate to the sibling `isComment(children[valueIdx]!)`
            // call or to the body's `children[valueIdx]!.text` read — both index
            // again into the same array and re-yield T | undefined.
            while (valueIdx < children.length && children[valueIdx] && isComment(children[valueIdx]!)) {
                commentsBetween.push(normalizeComment(children[valueIdx]!.text));
                valueIdx++;
            }
            const valueChild = children[valueIdx];
            if (valueChild && isValueType(valueChild.type)) {
                // Output keyword with value, then any intervening comments
                result.push(text + " " + valueChild.text);
                result.push(...commentsBetween);
                i = valueIdx; // Skip to after the value
            } else {
                result.push(text);
                result.push(...commentsBetween);
            }
        }
    }

    return result;
}

/** Check if a node is a value type (for UNLESS/IF values). */
function isValueType(type: string): boolean {
    return (
        type === "value" || type === "string" || type === "variable_ref" || type === "identifier" || type === "number"
    );
}

/** Check if child is a COPY flag (GLOB, NOGLOB, +, -). */
function isCopyFlag(text: string): boolean {
    return text === "GLOB" || text === "NOGLOB" || text === "+" || text === "-";
}

/**
 * Parse COPY action into structured parts.
 * Separates keyword, file pairs, patches, and suffix keywords.
 */
function parseCopyAction(node: SyntaxNode): CopyActionParts {
    const parts: CopyActionParts = {
        keyword: "",
        filePairs: [],
        headerComment: "",
        patches: [],
        suffix: [],
    };

    let inPatchArea = false;
    let lastHeaderRow = -1;

    for (const child of node.children) {
        // File pairs
        if (isFilePairType(child.type)) {
            parts.filePairs.push(normalizeWhitespace(child.text));
            lastHeaderRow = child.endPosition.row;
            continue;
        }

        // Keyword detection
        if (child.type === SyntaxType.Identifier && !parts.keyword) {
            parts.keyword = child.text;
            lastHeaderRow = child.endPosition.row;
            continue;
        }
        if (child.text.startsWith("COPY") || child.text === "INNER_ACTION") {
            parts.keyword = child.text;
            lastHeaderRow = child.endPosition.row;
            continue;
        }

        // COPY flags (GLOB, NOGLOB, +, -) - must come before file pairs
        if (parts.keyword && parts.filePairs.length === 0 && isCopyFlag(child.text)) {
            parts.keyword += " " + child.text;
            lastHeaderRow = child.endPosition.row;
            continue;
        }

        // Inline comment on the header line
        if (isComment(child) && !inPatchArea && lastHeaderRow >= 0 && child.startPosition.row === lastHeaderRow) {
            if (parts.filePairs.length > 0) {
                // Attach to the specific file pair it's on
                const idx = parts.filePairs.length - 1;
                parts.filePairs[idx] = parts.filePairs[idx] + INLINE_COMMENT_SPACING + normalizeComment(child.text);
            } else {
                // Comment on keyword line
                parts.headerComment = normalizeComment(child.text);
            }
            continue;
        }

        // Patches and patch-related content
        if (isPatchContent(child.type) || isComment(child)) {
            inPatchArea = true;
            parts.patches.push(child);
            continue;
        }

        // 'when' node - contains UNLESS, IF, BUT_ONLY, IF_EXISTS, IF_SIZE_IS, etc.
        if (child.type === SyntaxType.When) {
            inPatchArea = true;
            parts.suffix.push(...parseWhenNode(child));
            continue;
        }

        // Suffix keywords (BUT_ONLY, IF_EXISTS, etc.)
        if (isSuffixKeyword(child)) {
            inPatchArea = true;
            parts.suffix.push(child.text);
            continue;
        }

        // IF keyword in patch area (part of BUT_ONLY IF)
        if (isKeyword(child, KW_IF) && inPatchArea) {
            parts.suffix.push(child.text);
            continue;
        }

        // UNLESS keyword
        if (isKeyword(child, KW_UNLESS)) {
            inPatchArea = true;
            parts.suffix.push(child.text);
            continue;
        }

        // Value following UNLESS
        if (
            inPatchArea &&
            parts.suffix.length > 0 &&
            parts.suffix[parts.suffix.length - 1] === KW_UNLESS &&
            isValueType(child.type)
        ) {
            parts.suffix[parts.suffix.length - 1] = KW_UNLESS + " " + child.text;
            continue;
        }

        // Value following IF (in BUT_ONLY IF context)
        if (
            inPatchArea &&
            parts.suffix.length > 0 &&
            parts.suffix[parts.suffix.length - 1] === KW_IF &&
            isValueType(child.type)
        ) {
            parts.suffix[parts.suffix.length - 1] = KW_IF + " " + child.text;
            continue;
        }
    }

    return parts;
}

// ============================================
// COPY action formatting
// ============================================

/** Format the header (keyword + file pairs), with optional inline comment. */
function formatCopyHeader(parts: CopyActionParts, indent: string, patchIndent: string, lineLimit: number): string[] {
    const lines: string[] = [];

    if (parts.filePairs.length <= 1) {
        const firstPair = parts.filePairs[0] ?? "";
        const header = parts.keyword + " " + firstPair;
        const totalLen = indent.length + header.length;
        if (totalLen <= lineLimit || parts.filePairs.length === 0) {
            lines.push(indent + header);
        } else {
            lines.push(indent + parts.keyword);
            lines.push(patchIndent + firstPair);
        }
    } else {
        lines.push(indent + parts.keyword);
        for (const pair of parts.filePairs) {
            lines.push(patchIndent + pair);
        }
    }

    // Append inline header comment to keyword line (first line)
    if (parts.headerComment && lines.length > 0) {
        lines[0] = lines[0] + INLINE_COMMENT_SPACING + parts.headerComment;
    }

    return lines;
}

/** Format patches inside COPY action. */
function formatCopyPatches(
    patches: SyntaxNode[],
    ctx: FormatContext,
    depth: number,
    formatNode: (node: SyntaxNode, ctx: FormatContext, depth: number) => string,
): string[] {
    const patchIndent = ctx.indent.repeat(depth + 1);
    const nestedIndent = ctx.indent.repeat(depth + 2);
    const lines: string[] = [];
    let lastPatchEndRow = -1;

    for (const patch of patches) {
        if (isComment(patch)) {
            handleComment(lines, patch, patchIndent, lastPatchEndRow);
            continue;
        }

        // patches wrapper node - iterate through its children
        if (patch.type === SyntaxType.Patches) {
            const innerLines = formatCopyPatches(patch.children, ctx, depth, formatNode);
            lines.push(...innerLines);
            lastPatchEndRow = patch.endPosition.row;
            continue;
        }

        if (patch.type === SyntaxType.PatchBlock) {
            lines.push(patchIndent + KW_BEGIN);
            let lastBlockPatchEndRow = -1;
            for (const patchChild of patch.children) {
                if (isKeyword(patchChild, KW_BEGIN)) {
                    lastBlockPatchEndRow = patchChild.startPosition.row;
                    continue;
                }
                if (isKeyword(patchChild, KW_END)) {
                    continue;
                }
                if (isComment(patchChild)) {
                    handleComment(lines, patchChild, nestedIndent, lastBlockPatchEndRow);
                } else if (isPatchContent(patchChild.type)) {
                    lines.push(formatNode(patchChild, ctx, depth + 2));
                    lastBlockPatchEndRow = patchChild.endPosition.row;
                }
            }
            lines.push(patchIndent + KW_END);
            lastPatchEndRow = patch.endPosition.row;
        } else {
            lines.push(formatNode(patch, ctx, depth + 1));
            lastPatchEndRow = patch.endPosition.row;
        }
    }

    return lines;
}

/** Format suffix keywords (BUT_ONLY, UNLESS, etc.). */
function formatCopySuffix(suffix: string[], indent: string): string[] {
    if (suffix.length === 0) return [];

    const lines: string[] = [];
    let suffixLine = "";

    for (const item of suffix) {
        if (item.startsWith("//")) {
            if (suffixLine) {
                lines.push(indent + suffixLine);
                suffixLine = "";
            }
            lines.push(indent + normalizeComment(item));
        } else {
            suffixLine = suffixLine ? suffixLine + " " + item : item;
        }
    }

    if (suffixLine) {
        lines.push(indent + suffixLine);
    }

    return lines;
}

/**
 * Format COPY-style actions (COPY, COPY_EXISTING, COPY_LARGE, etc.).
 *
 * Structure: KEYWORD file_pairs [patches] [BUT_ONLY]
 */
export function formatCopyAction(
    node: SyntaxNode,
    ctx: FormatContext,
    depth: number,
    formatNode: (node: SyntaxNode, ctx: FormatContext, depth: number) => string,
): string {
    const indent = ctx.indent.repeat(depth);
    const patchIndent = ctx.indent.repeat(depth + 1);

    const parts = parseCopyAction(node);

    // Report if COPY action has no keyword (malformed)
    if (!parts.keyword) {
        throwFormatError(`COPY action missing keyword`, node.startPosition.row + 1, node.startPosition.column + 1);
    }

    // Report if COPY action has no file pairs (likely malformed)
    if (parts.filePairs.length === 0 && parts.patches.length === 0) {
        throwFormatError(
            `COPY action '${parts.keyword}' has no file pairs`,
            node.startPosition.row + 1,
            node.startPosition.column + 1,
        );
    }

    const headerLines = formatCopyHeader(parts, indent, patchIndent, ctx.lineLimit);
    const patchLines = formatCopyPatches(parts.patches, ctx, depth, formatNode);
    const suffixLines = formatCopySuffix(parts.suffix, indent);

    return [...headerLines, ...patchLines, ...suffixLines].join("\n");
}
