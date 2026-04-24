/**
 * Core formatting logic for WeiDU TP2 files.
 * Main entry point and dispatcher for formatting operations.
 *
 * For formatter behavior and examples, see:
 * {@link https://github.com/bgforge/vscode-mls/tree/master/grammars/weidu-tp2/formatter.md}
 */

import type { Node as SyntaxNode } from "web-tree-sitter";
import {
    type FormatOptions,
    type FormatResult,
    type FormatContext,
    DEFAULT_OPTIONS,
    INLINE_COMMENT_SPACING,
    KW_BEGIN,
    KW_END,
    KW_ALWAYS,
    throwFormatError,
    NODE_INLINED_FILE,
    NODE_COMPONENT,
    NODE_ALWAYS_BLOCK,
    NODE_PATCH_FILE,
    NODE_MATCH_CASE,
    NODE_ACTION_MATCH_CASE,
    NODE_REQUIRE_PREDICATE_ACTION,
    NODE_INNER_ACTION,
    NODE_INNER_PATCH,
    NODE_INNER_PATCH_SAVE,
    NODE_INNER_PATCH_FILE,
    NODE_REPLACE_BCS_BLOCK,
} from "./types";
import {
    isComment,
    isKeyword,
    isTopLevelDirective,
    isAction,
    isControlFlow,
    isCopyAction,
    isFunctionDef,
    isFunctionCall,
    isBodyContent,
    normalizeComment,
    normalizeWhitespace,
    withNormalizedComment,
    handleComment,
} from "./utils";
import {
    formatControlFlow,
    formatCondition,
    formatCopyAction,
    formatFunctionDef,
    formatFunctionCall,
    formatMatchCase,
    formatPredicateAction,
    formatInnerAction,
    formatInnerPatch,
    formatReplaceBcsBlock,
} from "./blocks";
import { SyntaxType } from "../tree-sitter.d";
import { throwOnParseError } from "../../shared/format-utils";

// ============================================
// Simple node formatters
// ============================================

/** Format a top-level directive (BACKUP, AUTHOR, etc.). */
function formatDirective(node: SyntaxNode): string {
    return normalizeWhitespace(node.text);
}

/** Format a component (BEGIN block). */
function formatComponent(node: SyntaxNode, ctx: FormatContext): string {
    const lines: string[] = [];
    let beginLine = "";
    let lastEndRow = -1;
    let lastHeaderRow = -1;

    for (const child of node.children) {
        if (isComment(child)) {
            if (beginLine && lastHeaderRow >= 0 && child.startPosition.row === lastHeaderRow) {
                // Inline comment on the header line - append and flush
                // (must flush to prevent subsequent flags from being appended after the comment)
                lines.push(beginLine + INLINE_COMMENT_SPACING + normalizeComment(child.text));
                beginLine = "";
            } else {
                if (beginLine) {
                    lines.push(beginLine);
                    beginLine = "";
                }
                handleComment(lines, child, "", lastEndRow);
            }
            continue;
        }

        if (isKeyword(child, KW_BEGIN)) {
            beginLine = KW_BEGIN;
            lastHeaderRow = child.endPosition.row;
            continue;
        }

        // Component name/value - append to BEGIN line
        if (
            child.type === SyntaxType.Value ||
            child.type === SyntaxType.String ||
            child.type === SyntaxType.Identifier ||
            child.type === SyntaxType.VariableRef ||
            child.type === SyntaxType.TraRef
        ) {
            beginLine = beginLine ? beginLine + " " + normalizeWhitespace(child.text) : normalizeWhitespace(child.text);
            lastHeaderRow = child.endPosition.row;
            continue;
        }

        // Component flags - each on its own line
        if (
            child.type === SyntaxType.DesignatedFlag ||
            child.type === SyntaxType.DeprecatedFlag ||
            child.type === SyntaxType.SubcomponentFlag ||
            child.type === SyntaxType.GroupFlag ||
            child.type === SyntaxType.LabelFlag ||
            child.type === SyntaxType.RequirePredicateFlag ||
            child.type === SyntaxType.RequireComponentFlag ||
            child.type === SyntaxType.ForbidComponentFlag
        ) {
            if (beginLine) {
                lines.push(beginLine);
                beginLine = "";
            }
            if (child.type === SyntaxType.RequirePredicateFlag) {
                // Split long predicate conditions at OR/AND boundaries
                const predicate = child.childForFieldName("predicate");
                const message = child.childForFieldName("message");
                const contIndent = ctx.indent;
                const condLines = formatCondition(predicate, "REQUIRE_PREDICATE", "", contIndent, ctx.lineLimit);
                if (message) {
                    condLines[condLines.length - 1] += " " + normalizeWhitespace(message.text);
                }
                beginLine = condLines.join("\n");
            } else {
                beginLine = normalizeWhitespace(child.text);
            }
            lastHeaderRow = child.endPosition.row;
            continue;
        }

        // Body content - actions inside component (no indent, since the grammar
        // may place these as top-level nodes after reformatting collapses flags
        // onto the BEGIN line)
        if (
            isAction(child.type) ||
            isControlFlow(child.type) ||
            isFunctionCall(child.type) ||
            child.type === SyntaxType.InlinedFile
        ) {
            if (beginLine) {
                lines.push(beginLine);
                beginLine = "";
            }
            lines.push(formatNode(child, ctx, 0));
            lastEndRow = child.endPosition.row;
        }
    }

    if (beginLine) {
        lines.push(beginLine);
    }

    return lines.join("\n");
}

/** Format ALWAYS block. */
function formatAlwaysBlock(node: SyntaxNode, ctx: FormatContext): string {
    const lines: string[] = [];
    let lastEndRow = -1;

    for (const child of node.children) {
        if (isKeyword(child, KW_ALWAYS)) {
            lines.push(KW_ALWAYS);
            lastEndRow = child.endPosition.row;
            continue;
        }
        if (isKeyword(child, KW_END)) {
            continue;
        }
        if (isComment(child)) {
            handleComment(lines, child, ctx.indent, lastEndRow);
        } else if (child.type === SyntaxType.InlinedFile) {
            lines.push(formatInlinedFile(child, ctx, 1));
            lastEndRow = child.endPosition.row;
        } else if (isAction(child.type) || isControlFlow(child.type) || isFunctionCall(child.type)) {
            lines.push(formatNode(child, ctx, 1));
            lastEndRow = child.endPosition.row;
        }
    }

    lines.push(KW_END);
    return lines.join("\n");
}

/** Format patch_file (e.g., .tpp includes). */
function formatPatchFile(node: SyntaxNode, ctx: FormatContext): string {
    const lines: string[] = [];
    let lastEndRow = -1;

    for (const child of node.children) {
        if (isComment(child)) {
            handleComment(lines, child, "", lastEndRow);
        } else if (isBodyContent(child.type)) {
            lines.push(formatNode(child, ctx, 0));
            lastEndRow = child.endPosition.row;
        }
    }

    return lines.join("\n");
}

/** Format inlined file. */
function formatInlinedFile(node: SyntaxNode, ctx: FormatContext, depth: number): string {
    const indent = ctx.indent.repeat(depth);
    // Preserve inlined file content exactly
    return indent + node.text.trim();
}

/** Format a simple node, splitting long lines with multiple string arguments. */
function formatSimpleNode(node: SyntaxNode, ctx: FormatContext, depth: number): string {
    const indent = ctx.indent.repeat(depth);
    const singleLine = indent + normalizeWhitespace(node.text);

    // Abort if this node looks like it should have specialized formatting
    // (contains BEGIN/END keywords but fell through to simple formatting)
    const hasBeginEnd = node.children.some((c) => c.text === "BEGIN" || c.text === "END");
    if (hasBeginEnd) {
        throwFormatError(
            `Unhandled block node type '${node.type}' - using simple formatting`,
            node.startPosition.row + 1,
            node.startPosition.column + 1,
        );
    }

    if (singleLine.length <= ctx.lineLimit) {
        return withNormalizedComment(singleLine);
    }

    // Find string children
    const stringChildren: SyntaxNode[] = [];
    for (const child of node.children) {
        if (child.type === SyntaxType.String) {
            stringChildren.push(child);
        }
    }

    // Only split if we have multiple string arguments
    if (stringChildren.length < 2) {
        return withNormalizedComment(singleLine);
    }

    // Extract prefix: everything before first string
    const firstString = stringChildren[0];
    if (!firstString) {
        return withNormalizedComment(singleLine);
    }
    const prefixEndOffset = firstString.startIndex - node.startIndex;
    const prefix = normalizeWhitespace(node.text.slice(0, prefixEndOffset));

    // Build split output, preserving text between strings (e.g., UNLESS, IF keywords)
    const argIndent = ctx.indent.repeat(depth + 1);
    const lines: string[] = [indent + prefix];
    let prevEndOffset = firstString.endIndex - node.startIndex;
    lines.push(argIndent + firstString.text);

    for (let i = 1; i < stringChildren.length; i++) {
        const strNode = stringChildren[i];
        if (!strNode) continue;
        // Get text between previous string and this string (may contain keywords like UNLESS)
        const betweenStart = prevEndOffset;
        const betweenEnd = strNode.startIndex - node.startIndex;
        const between = normalizeWhitespace(node.text.slice(betweenStart, betweenEnd));
        if (between) {
            lines.push(argIndent + between);
        }
        lines.push(argIndent + strNode.text);
        prevEndOffset = strNode.endIndex - node.startIndex;
    }

    // Append any remaining content after the last string (e.g., kit_say nodes in ADD_KIT)
    const lastString = stringChildren[stringChildren.length - 1];
    if (lastString) {
        const remainingStart = lastString.endIndex - node.startIndex;
        const remaining = normalizeWhitespace(node.text.slice(remainingStart));
        if (remaining) {
            // Split remaining content by lines and indent each
            for (const part of remaining.split(/\s+(?=SAY\b)/i)) {
                if (part.trim()) {
                    lines.push(argIndent + part.trim());
                }
            }
        }
    }

    return lines.join("\n");
}

// ============================================
// Main dispatcher
// ============================================

/** Format a node based on its type. */
function formatNode(node: SyntaxNode, ctx: FormatContext, depth: number): string {
    const type = node.type;

    // Inlined files - MUST be checked first to preserve content exactly
    if (type === NODE_INLINED_FILE) {
        return formatInlinedFile(node, ctx, depth);
    }

    // Top-level directives
    if (isTopLevelDirective(type)) {
        return formatDirective(node);
    }

    // Components (BEGIN blocks)
    if (type === NODE_COMPONENT) {
        return formatComponent(node, ctx);
    }

    // ALWAYS block
    if (type === NODE_ALWAYS_BLOCK) {
        return formatAlwaysBlock(node, ctx);
    }

    // Patch file (e.g., .tpp)
    if (type === NODE_PATCH_FILE) {
        return formatPatchFile(node, ctx);
    }

    // COPY-style actions
    if (isCopyAction(type)) {
        return formatCopyAction(node, ctx, depth, formatNode);
    }

    // Control flow (IF, FOR, MATCH, etc.)
    if (isControlFlow(type)) {
        return formatControlFlow(node, ctx, depth, formatNode);
    }

    // Match cases
    if (type === NODE_MATCH_CASE || type === NODE_ACTION_MATCH_CASE) {
        return formatMatchCase(node, ctx, depth, formatNode);
    }

    // Function/macro definitions
    if (isFunctionDef(type)) {
        return formatFunctionDef(node, ctx, depth, formatNode);
    }

    // Function/macro calls
    if (isFunctionCall(type)) {
        return formatFunctionCall(node, ctx, depth);
    }

    // REQUIRE_PREDICATE
    if (type === NODE_REQUIRE_PREDICATE_ACTION) {
        return formatPredicateAction(node, ctx, depth);
    }

    // INNER_ACTION
    if (type === NODE_INNER_ACTION) {
        return formatInnerAction(node, ctx, depth, formatNode);
    }

    // INNER_PATCH / INNER_PATCH_SAVE / INNER_PATCH_FILE
    if (type === NODE_INNER_PATCH || type === NODE_INNER_PATCH_SAVE || type === NODE_INNER_PATCH_FILE) {
        return formatInnerPatch(node, ctx, depth, formatNode);
    }

    // REPLACE_BCS_BLOCK / R_B_B
    if (type === NODE_REPLACE_BCS_BLOCK) {
        return formatReplaceBcsBlock(node, ctx, depth, formatNode);
    }

    // Simple nodes
    return formatSimpleNode(node, ctx, depth);
}

// ============================================
// Main entry point
// ============================================

/** Try to append an inline comment to the last result entry. */
function tryAppendTopLevelInlineComment(result: string[], child: SyntaxNode, lastEndRow: number): boolean {
    if (!isComment(child) || lastEndRow < 0 || child.startPosition.row !== lastEndRow) {
        return false;
    }
    if (result.length === 0) {
        return false;
    }

    const lastResult = result[result.length - 1];
    if (!lastResult) {
        return false;
    }
    const lastResultLines = lastResult.split("\n");
    const lastLine = lastResultLines[lastResultLines.length - 1];

    if (!lastLine || lastLine.includes("//")) {
        return false;
    }

    lastResultLines[lastResultLines.length - 1] = lastLine + INLINE_COMMENT_SPACING + normalizeComment(child.text);
    result[result.length - 1] = lastResultLines.join("\n");
    return true;
}

/** Check if a comment chain is attached to a following component. */
function isCommentAttachedToComponent(children: SyntaxNode[], idx: number, lastEndRow: number): boolean {
    const child = children[idx];
    if (!child || !isComment(child)) {
        return false;
    }

    const hasSeparationBefore = lastEndRow < 0 || child.startPosition.row > lastEndRow + 1;
    if (!hasSeparationBefore) {
        return false;
    }

    let nextIdx = idx + 1;
    let lastCommentEndRow = child.endPosition.row;
    while (nextIdx < children.length) {
        const nextChild = children[nextIdx];
        if (!nextChild || !isComment(nextChild)) {
            break;
        }
        lastCommentEndRow = nextChild.endPosition.row;
        nextIdx++;
    }

    const nextNonComment = children[nextIdx];
    if (nextNonComment && nextNonComment.type === SyntaxType.Component) {
        return nextNonComment.startPosition.row <= lastCommentEndRow + 1;
    }

    return false;
}

/** Format a TP2 document. */
export function formatDocument(root: SyntaxNode, options?: Partial<FormatOptions>): FormatResult {
    throwOnParseError(root);

    const opts = { ...DEFAULT_OPTIONS, ...options };
    const ctx: FormatContext = {
        indent: " ".repeat(opts.indentSize),
        lineLimit: opts.lineLimit,
        indentSize: opts.indentSize,
    };

    const result: string[] = [];
    let lastEndRow = -1;
    const children = root.children;
    let skipBlankBeforeComponent = false;

    for (let i = 0; i < children.length; i++) {
        const child = children[i];
        if (!child) continue;

        if (tryAppendTopLevelInlineComment(result, child, lastEndRow)) {
            continue;
        }

        const attachedToComponent = isCommentAttachedToComponent(children, i, lastEndRow);
        if (attachedToComponent) {
            skipBlankBeforeComponent = true;
        }

        if (lastEndRow >= 0 && child.startPosition.row > lastEndRow + 1) {
            result.push("");
        }

        const needsBlankBefore =
            attachedToComponent || (child.type === SyntaxType.Component && !skipBlankBeforeComponent);
        if (needsBlankBefore && result.length > 0 && result[result.length - 1] !== "") {
            result.push("");
        }

        if (child.type === SyntaxType.Component) {
            skipBlankBeforeComponent = false;
        }

        if (isComment(child)) {
            result.push(normalizeComment(child.text));
        } else {
            result.push(formatNode(child, ctx, 0));
        }

        lastEndRow = child.endPosition.row;
    }

    while (result.length > 0 && result[result.length - 1] === "") {
        result.pop();
    }

    return {
        text: result.join("\n").replace(/\r/g, "") + "\n",
    };
}
