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
    normalizeWhitespace,
    handleComment,
    outputAlignedAssignments,
} from "./utils";
import { SyntaxType } from "../../../server/src/weidu-tp2/tree-sitter.d";

// ============================================
// Assignment parsing
// ============================================

/** Parse assignment: name = value (handles assignment, binary_expr, ternary_expr, *_call_item nodes) */
function parseAssignment(node: SyntaxNode): { name: string; value: string } | null {
    // Try standard assignment fields first
    let nameNode = node.childForFieldName("name") ?? node.childForFieldName("var");
    let valueNode = node.childForFieldName("value");

    // Fallback to binary_expr fields (left/right)
    if (!nameNode) {
        nameNode = node.childForFieldName("left");
        valueNode = node.childForFieldName("right");
    }

    // Handle *_call_item nodes: identifier/string [= value]
    // web-tree-sitter includes anonymous tokens in children, so structure is:
    // [identifier/string] or [identifier/string, "=", value]
    if (!nameNode && node.type.endsWith("_call_item")) {
        const children = node.children;
        const first = children[0];
        // First child is identifier or string (the name)
        if (first && (first.type === SyntaxType.Identifier || first.type === SyntaxType.String)) {
            nameNode = first;
            // If there's an "=" token, value is the third child
            const second = children[1];
            const third = children[2];
            if (second && second.text === "=" && third) {
                valueNode = third;
            }
        }
    }

    // Handle ternary_expr: "name = condition ? then : else"
    // Parse textually since the name is embedded in the condition
    if (!nameNode && node.type === SyntaxType.TernaryExpr) {
        const text = node.text;
        const eqIdx = text.indexOf("=");
        if (eqIdx > 0) {
            const name = text.slice(0, eqIdx).trim();
            const value = text.slice(eqIdx + 1).trim();
            return { name, value: normalizeWhitespace(value) };
        }
    }

    if (!nameNode) return null;

    return {
        name: nameNode.text,
        value: valueNode ? normalizeWhitespace(valueNode.text) : "",
    };
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
                items.push({
                    type: CollectedItemType.Assignment,
                    name: parsed.name,
                    value: parsed.value,
                    endRow: child.endPosition.row,
                });
            }
        } else if (
            child.type === SyntaxType.VariableRef ||
            child.type === SyntaxType.Identifier ||
            child.type === SyntaxType.String
        ) {
            // Check if next child is "=" token indicating an assignment
            const nextChild = children[i + 1];
            if (nextChild && nextChild.text === "=") {
                // name = value pattern - get the value after "="
                const valueChild = children[i + 2];
                if (valueChild && !isComment(valueChild)) {
                    items.push({
                        type: CollectedItemType.Assignment,
                        name: child.text,
                        value: normalizeWhitespace(valueChild.text),
                        endRow: valueChild.endPosition.row,
                    });
                    i += 2; // Skip "=" and value
                } else {
                    // "=" without value - handle gracefully
                    items.push({
                        type: CollectedItemType.Assignment,
                        name: child.text,
                        value: "",
                        endRow: child.endPosition.row,
                    });
                    i++; // Skip "="
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
                items.push({
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

    for (const child of node.children) {
        if (isKeyword(child, KW_BEGIN)) hasBegin = true;
        if (isKeyword(child, KW_END)) hasEnd = true;
        if (isKeyword(child, KW_BEGIN)) {
            if (defLine) {
                lines.push(indent + defLine);
                defLine = "";
            }
            lines.push(indent + KW_BEGIN);
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
                handleComment(lines, child, bodyIndent, lastEndRow);
            } else if (defLine && lastDefRow >= 0 && child.startPosition.row === lastDefRow) {
                // Inline comment on same line as DEFINE_* header
                defLine += INLINE_COMMENT_SPACING + normalizeComment(child.text);
            } else {
                if (defLine) {
                    lines.push(indent + defLine);
                    defLine = "";
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
                }
                // Parameter declarations are indented one level from the function definition
                lines.push(...formatParamDecl(child, bodyIndent, ctx));
            } else if (child.text.startsWith("DEFINE_")) {
                defLine = child.text;
                lastDefRow = child.endPosition.row;
            } else if (child.type === SyntaxType.Identifier || child.type === SyntaxType.String) {
                defLine = defLine ? defLine + " " + child.text : child.text;
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
                if (lastLine !== undefined && !lastLine.includes("//")) {
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
    const isMacro = node.type === "action_launch_macro" || node.type === "patch_launch_macro";
    if (!hasEnd && !isMacro) {
        throwFormatError(
            `Function call '${callKeyword}' missing END`,
            node.startPosition.row + 1,
            node.startPosition.column + 1,
        );
    }

    return lines.join("\n");
}
