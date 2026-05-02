/**
 * Loop formatting: FOR, FOR_EACH, and associative array definitions.
 * Extracted from control-flow.ts for file size management.
 */

import type { Node as SyntaxNode } from "web-tree-sitter";
import {
    type FormatContext,
    type CollectedItem,
    CollectedItemType,
    KW_BEGIN,
    KW_END,
    KW_IN,
    KW_FOR,
    KW_OUTER_FOR,
    INLINE_COMMENT_SPACING,
} from "./types";
import {
    isComment,
    isKeyword,
    isBodyContent,
    normalizeComment,
    normalizeWhitespace,
    handleComment,
    tryAppendInlineComment,
    outputAlignedAssignments,
    pushBlankIfGap,
} from "./utils";
import { SyntaxType } from "../../../server/src/weidu-tp2/tree-sitter.d";

// ============================================
// FOR loop formatting
// ============================================

/** Format FOR loop header: FOR (init; condition; increment) */
export function formatForLoopHeader(node: SyntaxNode): string | null {
    if (node.type !== "patch_for" && node.type !== "outer_for") {
        return null;
    }

    const parts: string[] = [];
    let inParens = false;
    // Three sections: init patches, condition, step patches
    const sections: string[][] = [[], [], []];
    let sectionIdx = 0;

    for (const child of node.children) {
        if (child.text === KW_FOR || child.text === KW_OUTER_FOR) {
            parts.push(child.text);
            continue;
        }
        if (child.text === "(") {
            inParens = true;
            continue;
        }
        if (child.text === ")") {
            inParens = false;
            // Join items within each section with space, sections with "; "
            const formattedSections = sections.map((s) => s.join(" "));
            parts.push("(" + formattedSections.join("; ") + ")");
            continue;
        }
        if (isKeyword(child, KW_BEGIN)) {
            break;
        }
        if (inParens) {
            if (child.text === ";") {
                sectionIdx++;
                continue;
            }
            if (!isComment(child) && sectionIdx < 3) {
                sections[sectionIdx]?.push(normalizeWhitespace(child.text));
            }
        }
    }

    return parts.join(" ");
}

/** Format FOR loop with pre-formatted header. */
export function formatForLoop(
    node: SyntaxNode,
    ctx: FormatContext,
    depth: number,
    header: string,
    formatNode: (node: SyntaxNode, ctx: FormatContext, depth: number) => string,
): string {
    const indent = ctx.indent.repeat(depth);
    const bodyIndent = ctx.indent.repeat(depth + 1);
    const lines: string[] = [indent + header + " " + KW_BEGIN];
    let lastEndRow = -1;

    let inBody = false;
    for (const child of node.children) {
        if (isKeyword(child, KW_BEGIN)) {
            inBody = true;
            lastEndRow = child.startPosition.row;
            continue;
        }
        if (isKeyword(child, KW_END)) {
            break;
        }
        if (!inBody) continue;

        if (isComment(child)) {
            lastEndRow = handleComment(lines, child, bodyIndent, lastEndRow);
        } else if (isBodyContent(child.type)) {
            pushBlankIfGap(lines, child, lastEndRow);
            lines.push(formatNode(child, ctx, depth + 1));
            lastEndRow = child.endPosition.row;
        }
    }

    lines.push(indent + KW_END);
    return lines.join("\n");
}

// ============================================
// FOR_EACH formatting
// ============================================

/** Format FOR_EACH style loop. */
export function formatForEach(
    node: SyntaxNode,
    ctx: FormatContext,
    depth: number,
    formatNode: (node: SyntaxNode, ctx: FormatContext, depth: number) => string,
): string {
    const indent = ctx.indent.repeat(depth);
    const bodyIndent = ctx.indent.repeat(depth + 1);

    // Collect header parts before BEGIN
    const headerParts: string[] = [];
    const itemsAfterIN: string[] = [];
    let seenIN = false;

    for (const child of node.children) {
        if (isKeyword(child, KW_BEGIN)) {
            break;
        }
        if (isKeyword(child, KW_IN)) {
            seenIN = true;
            headerParts.push(KW_IN);
            continue;
        }
        if (isComment(child)) {
            continue;
        }
        if (seenIN) {
            itemsAfterIN.push(child.text);
        } else {
            headerParts.push(child.text);
        }
    }

    // Build header lines
    const headerLines: string[] = [];
    const allItemsLength = itemsAfterIN.join(" ").length;
    const headerLength = indent.length + headerParts.join(" ").length + 1 + allItemsLength;
    const oneItemPerLine = itemsAfterIN.length > 1 && headerLength > ctx.lineLimit;

    if (oneItemPerLine) {
        headerLines.push(indent + headerParts.join(" "));
        for (const item of itemsAfterIN) {
            headerLines.push(bodyIndent + item);
        }
        headerLines.push(indent + KW_BEGIN);
    } else {
        const fullHeader = headerParts.join(" ") + " " + itemsAfterIN.join(" ");
        headerLines.push(indent + fullHeader + " " + KW_BEGIN);
    }

    // Format body
    const bodyLines: string[] = [];
    let inBody = false;
    let lastEndRow = -1;
    let beginRow = -1;

    for (const child of node.children) {
        if (isKeyword(child, KW_BEGIN)) {
            inBody = true;
            beginRow = child.startPosition.row;
            continue;
        }
        if (isKeyword(child, KW_END)) {
            break;
        }
        if (!inBody) continue;

        if (isComment(child)) {
            // Inline comment on the BEGIN line - append to last header line
            if (beginRow >= 0 && child.startPosition.row === beginRow) {
                const lastLine = headerLines[headerLines.length - 1];
                if (lastLine && !lastLine.includes("//")) {
                    headerLines[headerLines.length - 1] =
                        lastLine + INLINE_COMMENT_SPACING + normalizeComment(child.text);
                    beginRow = -1;
                    continue;
                }
            }
            beginRow = -1;
            lastEndRow = handleComment(bodyLines, child, bodyIndent, lastEndRow);
        } else if (isBodyContent(child.type)) {
            beginRow = -1;
            pushBlankIfGap(bodyLines, child, lastEndRow);
            bodyLines.push(formatNode(child, ctx, depth + 1));
            lastEndRow = child.endPosition.row;
        }
    }

    return [...headerLines, ...bodyLines, indent + KW_END].join("\n");
}

// ============================================
// Associative array formatting
// ============================================

/** Parse associative array entry for alignment. */
function parseAssocEntry(node: SyntaxNode): { name: string; value: string } | null {
    let arrowIdx = -1;
    for (let i = 0; i < node.children.length; i++) {
        const child = node.children[i];
        if (child && child.text === "=>") {
            arrowIdx = i;
            break;
        }
    }

    if (arrowIdx < 0 || arrowIdx >= node.children.length - 1) {
        return null;
    }

    const keyParts: string[] = [];
    for (let i = 0; i < arrowIdx; i++) {
        const child = node.children[i];
        if (child) {
            keyParts.push(child.text);
        }
    }

    const valueParts: string[] = [];
    for (let i = arrowIdx + 1; i < node.children.length; i++) {
        const child = node.children[i];
        if (child) {
            valueParts.push(child.text);
        }
    }

    return {
        name: keyParts.join(" "),
        value: valueParts.join(" "),
    };
}

/** Format associative array with aligned => operators. */
export function formatAssociativeArray(node: SyntaxNode, ctx: FormatContext, depth: number): string {
    const indent = ctx.indent.repeat(depth);
    const bodyIndent = ctx.indent.repeat(depth + 1);
    const lines: string[] = [];

    const headerParts: string[] = [];
    const items: CollectedItem[] = [];
    let inBody = false;
    let beginRow = -1;

    for (const child of node.children) {
        if (isKeyword(child, KW_BEGIN)) {
            lines.push(indent + headerParts.join(" ") + " " + KW_BEGIN);
            inBody = true;
            beginRow = child.startPosition.row;
            continue;
        }

        if (isKeyword(child, KW_END)) {
            break;
        }

        if (!inBody) {
            headerParts.push(child.text);
            continue;
        }

        if (isComment(child)) {
            // Inline comment on the BEGIN line - append to header
            if (tryAppendInlineComment(lines, child, beginRow)) {
                beginRow = -1;
                continue;
            }
            beginRow = -1;
            items.push({
                type: CollectedItemType.Comment,
                text: normalizeComment(child.text),
                startRow: child.startPosition.row,
                endRow: child.endPosition.row,
            });
            continue;
        }
        beginRow = -1;

        if (child.type === SyntaxType.AssocEntry) {
            const parsed = parseAssocEntry(child);
            if (parsed) {
                items.push({
                    type: CollectedItemType.Assignment,
                    name: parsed.name,
                    value: parsed.value,
                    endRow: child.endPosition.row,
                });
            }
        }
    }

    const entryLines = outputAlignedAssignments(items, "", indent, bodyIndent, " => ");
    lines.push(...entryLines);
    lines.push(indent + KW_END);

    return lines.join("\n");
}
