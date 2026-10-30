/**
 * Function and macro formatting: definitions (DEFINE_*) and calls (LAF/LPF/LAM/LPM).
 * Handles parameter declarations with aligned assignments.
 */

import type { Node as SyntaxNode } from "web-tree-sitter";
import {
    type FormatContext,
    type CollectedItem,
    CollectedItemType,
    KW_BEGIN,
    KW_END,
    KW_LPF,
    KW_LAF,
    KW_LPM,
    KW_LAM,
    INLINE_COMMENT_SPACING,
    throwFormatError,
} from "./types";
import {
    isComment,
    isKeyword,
    isBodyContent,
    isParamKeyword,
    normalizeComment,
    hasWeiduLineComment,
    normalizeWhitespace,
    handleComment,
    outputAlignedAssignments,
    pushBlankIfGap,
    assignmentParts,
    commentItemsAbove,
} from "./utils";
import { SyntaxType } from "@bgforge/shared/syntax-types/weidu-tp2";

// ============================================
// Assignment parsing
// ============================================

const CALL_ITEM_TYPES: ReadonlySet<string> = new Set([
    SyntaxType.IntVarCallItem,
    SyntaxType.StrVarCallItem,
    SyntaxType.RetCallItem,
    SyntaxType.RetArrayCallItem,
]);

/** The name and value of an assignment, and its line comments, which the caller writes after it. */
interface ParsedAssignment {
    name: string;
    value: string;
    lineComments: SyntaxNode[];
}

/** Parse assignment: name = value (handles assignment, binary_expr, ternary_expr, *_call_item nodes) */
function parseAssignment(node: SyntaxNode): ParsedAssignment | null {
    // A call item's name can span several children (`EVAL ~name~`, with EVAL outside the name field), so it is
    // everything before `=`.
    if (CALL_ITEM_TYPES.has(node.type)) {
        const equals = node.children.findIndex((child) => !child.isNamed && child.text === "=");
        const destination = equals === -1 ? node.children : node.children.slice(0, equals);
        const value = node.childForFieldName("value");
        const after = equals === -1 ? [] : node.children.slice(equals + 1);
        const parts = assignmentParts(
            destination,
            (child) => child.text,
            after.filter((child) => child.id === value?.id || isComment(child)),
            (child) => normalizeWhitespace(child.text),
        );
        return { ...parts, value: value ? parts.value : "" };
    }

    // Try standard assignment fields first
    let nameNode = node.childForFieldName("name") ?? node.childForFieldName("var");
    let valueNode = node.childForFieldName("value");

    // Fallback to binary_expr fields (left/right)
    if (!nameNode) {
        nameNode = node.childForFieldName("left");
        valueNode = node.childForFieldName("right");
    }

    // Handle ternary_expr: "name = condition ? then : else"
    // Parse textually since the name is embedded in the condition
    if (!nameNode && node.type === SyntaxType.TernaryExpr) {
        const text = node.text;
        const eqIdx = text.indexOf("=");
        if (eqIdx > 0) {
            const name = text.slice(0, eqIdx).trim();
            const value = text.slice(eqIdx + 1).trim();
            return { name, value: normalizeWhitespace(value), lineComments: [] };
        }
    }

    if (!nameNode) return null;

    // The comments before the operator stay with the name, the ones after it with the value.
    const nameAt = node.children.findIndex((child) => child.id === nameNode.id);
    const valueAt = valueNode ? node.children.findIndex((child) => child.id === valueNode.id) : node.children.length;
    const operatorAt = node.children.findIndex((child, i) => i > nameAt && i < valueAt && !isComment(child));
    const boundary = operatorAt === -1 ? valueAt : operatorAt;
    const parts = assignmentParts(
        node.children.filter((child, i) => i < boundary && (child.id === nameNode.id || isComment(child))),
        (child) => child.text,
        node.children.filter((child, i) => i > boundary && (child.id === valueNode?.id || isComment(child))),
        (child) => normalizeWhitespace(child.text),
    );
    return { ...parts, value: valueNode ? parts.value : "" };
}

// ============================================
// Parameter declaration formatting
// ============================================

/** Format parameter declaration block (INT_VAR, STR_VAR, RET in definitions). */
function formatParamDecl(node: SyntaxNode, indent: string, ctx: FormatContext): string[] {
    const assignIndent = indent + ctx.indent;
    const items: CollectedItem[] = [];

    // Extract keyword from first child (INT_VAR, STR_VAR, RET, etc.)
    const keyword = node.firstChild?.text ?? "";

    // Use all children to detect "=" tokens between name and value
    // Grammar: seq("INT_VAR", repeat(seq(identifier|string, optional(seq("=", value)))))
    const children = node.children;

    for (let i = 0; i < children.length; i++) {
        const child = children[i];
        if (!child) continue;

        if (isComment(child)) {
            items.push({
                type: CollectedItemType.Comment,
                text: normalizeComment(child.text),
                startRow: child.startPosition.row,
                endRow: child.endPosition.row,
            });
        } else if (child.type === SyntaxType.PatchAssignment) {
            const parsed = parseAssignment(child);
            if (parsed) {
                items.push(...commentItemsAbove(parsed.lineComments), {
                    type: CollectedItemType.Assignment,
                    name: parsed.name,
                    value: parsed.value,
                    endRow: child.endPosition.row,
                });
            }
        } else if (
            child.type === SyntaxType.VariableRef ||
            child.type === SyntaxType.Identifier ||
            child.type === SyntaxType.String ||
            child.type === SyntaxType.VarNameNumeric
        ) {
            // The `=` after the name and the value after that, with the comments written between them.
            let equalsAt = i + 1;
            while (children[equalsAt] && isComment(children[equalsAt]!)) equalsAt++;
            const nextChild = children[equalsAt];
            if (nextChild && nextChild.text === "=") {
                // name = value pattern - get the value after "="
                let valueAt = equalsAt + 1;
                while (children[valueAt] && isComment(children[valueAt]!)) valueAt++;
                const valueChild = children[valueAt];
                if (valueChild) {
                    const parts = assignmentParts(
                        children.slice(i, equalsAt),
                        (word) => word.text,
                        children.slice(equalsAt + 1, valueAt + 1),
                        (word) => normalizeWhitespace(word.text),
                    );
                    items.push(...commentItemsAbove(parts.lineComments), {
                        type: CollectedItemType.Assignment,
                        name: parts.name,
                        value: parts.value,
                        endRow: valueChild.endPosition.row,
                    });
                    i = valueAt; // Skip "=", the comments and the value
                } else {
                    // "=" without value - handle gracefully
                    items.push({
                        type: CollectedItemType.Assignment,
                        name: child.text,
                        value: "",
                        endRow: child.endPosition.row,
                    });
                    i = equalsAt; // Skip the comments before "=", and "="
                }
            } else {
                // No "=" - name without value
                items.push({
                    type: CollectedItemType.Assignment,
                    name: child.text,
                    value: "",
                    endRow: child.endPosition.row,
                });
            }
        }
    }

    return outputAlignedAssignments(items, keyword, indent, assignIndent);
}

// ============================================
// Parameter call formatting
// ============================================

/** Format parameter call block (INT_VAR, STR_VAR, RET in calls). */
function formatParamCall(node: SyntaxNode, indent: string, ctx: FormatContext): string[] {
    const assignIndent = indent + ctx.indent;
    const items: CollectedItem[] = [];
    let keyword = "";

    for (const child of node.children) {
        if (isParamKeyword(child.text)) {
            keyword = child.text;
        } else if (isComment(child)) {
            items.push({
                type: CollectedItemType.Comment,
                text: normalizeComment(child.text),
                startRow: child.startPosition.row,
                endRow: child.endPosition.row,
            });
        } else if (
            child.type === SyntaxType.IntVarCallItem ||
            child.type === SyntaxType.StrVarCallItem ||
            child.type === SyntaxType.RetCallItem ||
            child.type === SyntaxType.RetArrayCallItem ||
            child.type === SyntaxType.BinaryExpr ||
            child.type === SyntaxType.TernaryExpr
        ) {
            const parsed = parseAssignment(child);
            if (parsed) {
                items.push(...commentItemsAbove(parsed.lineComments), {
                    type: CollectedItemType.Assignment,
                    name: parsed.name,
                    value: parsed.value,
                    endRow: child.endPosition.row,
                });
            }
        } else if (child.type === SyntaxType.VariableRef || child.type === SyntaxType.Identifier) {
            items.push({
                type: CollectedItemType.Assignment,
                name: child.text,
                value: "",
                endRow: child.endPosition.row,
            });
        }
    }

    return outputAlignedAssignments(items, keyword, indent, assignIndent);
}

// ============================================
// Function definition formatting
// ============================================

/**
 * Format function/macro definition (DEFINE_ACTION_FUNCTION, DEFINE_PATCH_MACRO, etc.).
 *
 * Structure: DEFINE_X name [INT_VAR...] [STR_VAR...] [RET...] BEGIN body END
 */
export function formatFunctionDef(
    node: SyntaxNode,
    ctx: FormatContext,
    depth: number,
    formatNode: (node: SyntaxNode, ctx: FormatContext, depth: number) => string,
): string {
    const indent = ctx.indent.repeat(depth);
    const bodyIndent = ctx.indent.repeat(depth + 1);
    const lines: string[] = [];

    let defLine = "";
    let inBody = false;
    let lastEndRow = -1;
    let lastDefRow = -1;
    let hasBegin = false;
    let hasEnd = false;
    // Macros (DEFINE_*_MACRO) take no parameter declarations and their `BEGIN` belongs on
    // the header line. Functions with INT_VAR/STR_VAR/RET blocks have already flushed the
    // header before BEGIN, so `BEGIN` lands on its own line (the desired layout).
    // An inline comment appended to the header forces BEGIN onto its own line because the
    // comment terminates the source line.
    let paramDeclsEmitted = false;
    let defLineHasInlineComment = false;

    for (const child of node.children) {
        if (isKeyword(child, KW_BEGIN)) hasBegin = true;
        if (isKeyword(child, KW_END)) hasEnd = true;
        if (isKeyword(child, KW_BEGIN)) {
            if (defLine && !paramDeclsEmitted && !defLineHasInlineComment) {
                lines.push(indent + defLine + " " + KW_BEGIN);
                defLine = "";
            } else {
                if (defLine) {
                    lines.push(indent + defLine);
                    defLine = "";
                }
                lines.push(indent + KW_BEGIN);
            }
            inBody = true;
            lastEndRow = child.startPosition.row;
            continue;
        }

        if (isKeyword(child, KW_END)) {
            inBody = false;
            lines.push(indent + KW_END);
            continue;
        }

        if (isComment(child)) {
            if (inBody) {
                lastEndRow = handleComment(lines, child, bodyIndent, lastEndRow);
            } else if (defLine && lastDefRow >= 0 && child.startPosition.row === lastDefRow) {
                // Inline comment on same line as DEFINE_* header
                defLine += INLINE_COMMENT_SPACING + normalizeComment(child.text);
                defLineHasInlineComment = true;
            } else {
                if (defLine) {
                    lines.push(indent + defLine);
                    defLine = "";
                    defLineHasInlineComment = false;
                }
                lines.push(indent + normalizeComment(child.text));
            }
            continue;
        }

        if (inBody) {
            // Handle standard body content and macro-specific LOCAL_SET/LOCAL_SPRINT
            if (
                isBodyContent(child.type) ||
                child.type === SyntaxType.LocalSet ||
                child.type === SyntaxType.LocalSprint
            ) {
                pushBlankIfGap(lines, child, lastEndRow);
                lines.push(formatNode(child, ctx, depth + 1));
                lastEndRow = child.endPosition.row;
            }
        } else {
            if (
                child.type.endsWith("_var_decl") ||
                child.type === SyntaxType.RetDecl ||
                child.type === SyntaxType.RetArrayDecl
            ) {
                if (defLine) {
                    lines.push(indent + defLine);
                    defLine = "";
                    defLineHasInlineComment = false;
                }
                // Parameter declarations are indented one level from the function definition
                lines.push(...formatParamDecl(child, bodyIndent, ctx));
                paramDeclsEmitted = true;
            } else if (child.text.startsWith("DEFINE_")) {
                defLine = child.text;
                lastDefRow = child.endPosition.row;
            } else if (
                child.type === SyntaxType.Identifier ||
                child.type === SyntaxType.String ||
                child.type === SyntaxType.VarNameNumeric
            ) {
                if (defLine && hasWeiduLineComment(defLine)) {
                    // A `//` comment ended the header line: the name goes on the next, one level in, or it would
                    // become part of the comment.
                    lines.push(indent + defLine);
                    defLine = ctx.indent + child.text;
                    defLineHasInlineComment = false;
                } else {
                    defLine = defLine ? defLine + " " + child.text : child.text;
                }
                lastDefRow = child.endPosition.row;
            }
        }
    }

    if (defLine) {
        lines.push(indent + defLine);
    }

    // Report structural issues
    if (!hasBegin) {
        throwFormatError(
            `Function definition missing BEGIN`,
            node.startPosition.row + 1,
            node.startPosition.column + 1,
        );
    }
    if (!hasEnd) {
        throwFormatError(`Function definition missing END`, node.startPosition.row + 1, node.startPosition.column + 1);
    }

    return lines.join("\n");
}

// ============================================
// Function call formatting
// ============================================

/**
 * Format function/macro call (LAF, LPF, LAM, LPM).
 *
 * Structure: LXX name [INT_VAR...] [STR_VAR...] [RET...] END
 */
export function formatFunctionCall(node: SyntaxNode, ctx: FormatContext, depth: number): string {
    const indent = ctx.indent.repeat(depth);
    const paramIndent = ctx.indent.repeat(depth + 1);
    const lines: string[] = [];

    let callLine = "";
    let hasEnd = false;
    let callKeyword = "";
    let lastChildEndRow = -1;

    for (const child of node.children) {
        if (isKeyword(child, KW_END)) {
            hasEnd = true;
            if (callLine) {
                lines.push(indent + callLine);
                callLine = "";
            }
            lines.push(indent + KW_END);
            lastChildEndRow = child.endPosition.row;
            continue;
        }

        if (isComment(child)) {
            if (callLine) {
                lines.push(indent + callLine);
                callLine = "";
            }
            // Check if comment is on same line as previous content - append inline
            if (lastChildEndRow >= 0 && child.startPosition.row === lastChildEndRow && lines.length > 0) {
                const lastLine = lines[lines.length - 1];
                if (lastLine !== undefined && !hasWeiduLineComment(lastLine)) {
                    lines[lines.length - 1] = lastLine + INLINE_COMMENT_SPACING + normalizeComment(child.text);
                    continue;
                }
            }
            lines.push(indent + normalizeComment(child.text));
            continue;
        }

        if (
            child.type === SyntaxType.IntVarCall ||
            child.type === SyntaxType.StrVarCall ||
            child.type === SyntaxType.RetCall ||
            child.type === SyntaxType.RetArrayCall
        ) {
            if (callLine) {
                lines.push(indent + callLine);
                callLine = "";
            }
            const paramLines = formatParamCall(child, paramIndent, ctx);
            lines.push(...paramLines);
            lastChildEndRow = child.endPosition.row;
        } else if (
            isKeyword(child, KW_LPF) ||
            isKeyword(child, KW_LAF) ||
            isKeyword(child, KW_LPM) ||
            isKeyword(child, KW_LAM)
        ) {
            callLine = child.text;
            callKeyword = child.text;
        } else if (child.type === SyntaxType.Identifier) {
            callLine = callLine ? callLine + " " + child.text : child.text;
        } else {
            const normalized = normalizeWhitespace(child.text);
            callLine = callLine ? callLine + " " + normalized : normalized;
        }
    }

    if (callLine) {
        lines.push(indent + callLine);
    }

    // Report structural issues (launch macros don't have END, only launch functions do)
    const isMacro = node.type === SyntaxType.ActionLaunchMacro || node.type === SyntaxType.PatchLaunchMacro;
    if (!hasEnd && !isMacro) {
        throwFormatError(
            `Function call '${callKeyword}' missing END`,
            node.startPosition.row + 1,
            node.startPosition.column + 1,
        );
    }

    return lines.join("\n");
}
