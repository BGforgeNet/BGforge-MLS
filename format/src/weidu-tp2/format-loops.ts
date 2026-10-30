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
    hasWeiduLineComment,
    normalizeWhitespace,
    handleComment,
    tryAppendInlineComment,
    outputAlignedAssignments,
    pushBlankIfGap,
    assignmentParts,
    commentItemsAbove,
} from "./utils";
import { SyntaxType } from "@bgforge/shared/syntax-types/weidu-tp2";
import { commentItem, itemsOf, layoutRowParts, weave, type Piece, type RowPart, type WovenItem } from "../format-utils";

/** An item or comment node as a part of a list laid out by layoutRowParts, written as `text`. */
function rowPart(node: SyntaxNode, text: string): RowPart {
    return {
        text,
        isItem: !isComment(node),
        isLineComment: node.type === SyntaxType.LineComment,
        startRow: node.startPosition.row,
        endRow: node.endPosition.row,
    };
}

// ============================================
// FOR loop formatting
// ============================================

/**
 * Format FOR loop header: FOR (init; condition; increment). The items of a section are joined with a blank and the
 * sections with "; ", as an empty one still takes its place. A comment stays where it was written; a `//` one ends
 * its line, and what follows starts the next at `indent`.
 */
export function formatForLoopHeader(node: SyntaxNode, indent: string): string | null {
    if (node.type !== SyntaxType.PatchFor && node.type !== SyntaxType.OuterFor) {
        return null;
    }

    let inParens = false;
    // The index of the section the next item belongs to: init patches, condition, step patches
    let sectionIdx = 0;
    let sectionHasItem = false;
    // The header stops at BEGIN; the comments past it belong to the body.
    const begin = node.children.findIndex((child) => isKeyword(child, KW_BEGIN));
    const headerChildren = begin === -1 ? node.children : node.children.slice(0, begin);
    const items = itemsOf(headerChildren, (child): Piece | null => {
        if (child.text === KW_FOR || child.text === KW_OUTER_FOR) return { text: child.text, sep: "" };
        if (child.text === "(" && !inParens) {
            inParens = true;
            return { text: "(", sep: " " };
        }
        if (child.text === ")" && inParens) {
            inParens = false;
            return { text: ")", sep: "" };
        }
        if (isKeyword(child, KW_BEGIN)) return null;
        if (!inParens) return null;
        if (child.text === ";") {
            // An empty section keeps its place: `a; ; c`
            const sep = sectionIdx > 0 && !sectionHasItem ? " " : "";
            sectionIdx++;
            sectionHasItem = false;
            return { text: ";", sep };
        }
        if (sectionIdx >= 3) return null;
        const sep = sectionHasItem || sectionIdx > 0 ? " " : "";
        sectionHasItem = true;
        return { text: normalizeWhitespace(child.text), sep };
    });
    return weave(items, indent);
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
    // A `//` comment ending the header would take BEGIN into itself.
    const lastHeaderLine = header.slice(header.lastIndexOf("\n") + 1);
    const lines: string[] = hasWeiduLineComment(lastHeaderLine)
        ? [indent + header, indent + KW_BEGIN]
        : [indent + header + " " + KW_BEGIN];
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

    // Collect header parts before BEGIN: the words up to and including IN, with the comments among them, then the items
    const headerItems: WovenItem[] = [];
    const itemsAfterIN: string[] = [];
    // The items after IN with the comments among them, and the row IN is on, for when there are comments.
    const listParts: RowPart[] = [];
    let inRow = node.startPosition.row;
    let seenIN = false;

    for (const child of node.children) {
        if (isKeyword(child, KW_BEGIN)) {
            break;
        }
        if (isKeyword(child, KW_IN)) {
            seenIN = true;
            inRow = child.endPosition.row;
            headerItems.push({ text: KW_IN, sep: " " });
            continue;
        }
        if (isComment(child)) {
            if (seenIN) listParts.push(rowPart(child, normalizeComment(child.text)));
            else headerItems.push(commentItem(child));
            continue;
        }
        if (seenIN) {
            itemsAfterIN.push(child.text);
            listParts.push(rowPart(child, child.text));
        } else {
            headerItems.push({ text: child.text, sep: " " });
        }
    }
    // A `//` comment before IN ends its line, and the rest of the header continues on the next, one level in.
    const headerText = weave(headerItems, bodyIndent);

    // Build header lines
    const headerLines: string[] = [];
    const allItemsLength = itemsAfterIN.join(" ").length;
    const headerLength = indent.length + headerText.length + 1 + allItemsLength;
    const oneItemPerLine = itemsAfterIN.length > 1 && headerLength > ctx.lineLimit;

    if (listParts.some((part) => !part.isItem)) {
        // A comment among the items: they go one to a line, each comment where it was written, and BEGIN on a line
        // of its own, which a `//` comment ending the list would otherwise swallow.
        const lines = layoutRowParts(indent + headerText, inRow, listParts, {
            firstItemInline: false,
            spaceAfterHead: true,
        });
        headerLines.push(lines[0] ?? "", ...lines.slice(1).map((line) => bodyIndent + line), indent + KW_BEGIN);
    } else if (oneItemPerLine) {
        headerLines.push(indent + headerText);
        for (const item of itemsAfterIN) {
            headerLines.push(bodyIndent + item);
        }
        headerLines.push(indent + KW_BEGIN);
    } else {
        // One join over both groups, not two joined with a separator: the loops that have no IN clause
        // (BASH_FOR, PHP_EACH) leave itemsAfterIN empty, and a separator added unconditionally then lands
        // as a stray double space before BEGIN.
        const fullHeader = [headerText, ...itemsAfterIN].join(" ");
        // A `//` comment ending the header would take BEGIN into itself.
        const beginSep = hasWeiduLineComment(fullHeader.slice(fullHeader.lastIndexOf("\n") + 1)) ? "\n" + indent : " ";
        headerLines.push(indent + fullHeader + beginSep + KW_BEGIN);
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
                if (lastLine && !hasWeiduLineComment(lastLine)) {
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
function parseAssocEntry(node: SyntaxNode): { name: string; value: string; lineComments: SyntaxNode[] } | null {
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

    return assignmentParts(
        node.children.slice(0, arrowIdx),
        (child) => child.text,
        node.children.slice(arrowIdx + 1),
        (child) => child.text,
    );
}

/** Format associative array with aligned => operators. */
export function formatAssociativeArray(node: SyntaxNode, ctx: FormatContext, depth: number): string {
    const indent = ctx.indent.repeat(depth);
    const bodyIndent = ctx.indent.repeat(depth + 1);
    const lines: string[] = [];

    const headerItems: WovenItem[] = [];
    const items: CollectedItem[] = [];
    let inBody = false;
    let beginRow = -1;

    for (const child of node.children) {
        if (isKeyword(child, KW_BEGIN)) {
            // A `//` comment ending the header would take BEGIN into itself.
            const header = weave(headerItems, bodyIndent);
            const beginSep = hasWeiduLineComment(header.slice(header.lastIndexOf("\n") + 1)) ? "\n" + indent : " ";
            lines.push(indent + header + beginSep + KW_BEGIN);
            inBody = true;
            beginRow = child.startPosition.row;
            continue;
        }

        if (isKeyword(child, KW_END)) {
            break;
        }

        if (!inBody) {
            headerItems.push(isComment(child) ? commentItem(child) : { text: child.text, sep: " " });
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
                items.push(...commentItemsAbove(parsed.lineComments), {
                    type: CollectedItemType.Assignment,
                    name: parsed.name,
                    value: parsed.value,
                    endRow: child.endPosition.row,
                });
            }
        }
    }

    const entryLines = outputAlignedAssignments(items, "", indent, bodyIndent, " => ");
    lines.push(...entryLines, indent + KW_END);

    return lines.join("\n");
}
