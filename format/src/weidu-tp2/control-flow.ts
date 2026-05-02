/**
 * Control flow formatting: IF, MATCH, TRY, WHILE, and condition splitting.
 * Loop formatting (FOR, FOR_EACH, associative arrays) is in format-loops.ts.
 */

import type { Node as SyntaxNode } from "web-tree-sitter";
import {
    type FormatContext,
    type ConditionOperand,
    KW_BEGIN,
    KW_END,
    KW_ELSE,
    KW_THEN,
    KW_WITH,
    KW_DEFAULT,
    KW_PATCH_IF,
    KW_ACTION_IF,
    KW_PATCH_TRY,
    KW_ACTION_TRY,
    INLINE_COMMENT_SPACING,
    throwFormatError,
    NODE_PATCH_TRY,
    NODE_ACTION_TRY,
} from "./types";
import {
    isComment,
    isKeyword,
    isForEach,
    isAssociativeArrayDef,
    isBodyContent,
    normalizeComment,
    normalizeWhitespace,
    handleComment,
    tryAppendInlineComment,
    outputHeaderLines,
    lastElement,
    isControlFlowBodyContent,
    pushBlankIfGap,
} from "./utils";
import { SyntaxType } from "../../../server/src/weidu-tp2/tree-sitter.d";
import { formatForLoopHeader, formatForLoop, formatForEach, formatAssociativeArray } from "./format-loops";

// ============================================
// Types
// ============================================

/** State for control flow formatting - tracks where we are in the structure. */
interface ControlFlowParseState {
    /** Accumulated output lines */
    lines: string[];
    /** Header parts being collected (before BEGIN) */
    headerParts: string[];
    /** Whether we're inside the body (after BEGIN) */
    inBody: boolean;
    /** Whether we just saw ELSE keyword */
    afterElse: boolean;
    /** Row number of last content (for inline comments) */
    lastContentRow: number;
    /** Row number of BEGIN (for inline comments on same line) */
    beginRow: number;
    /** Row number of last header element (keyword/condition) */
    lastHeaderRow: number;
    /** Inline comment on same row as header (preserved through conditionNode path) */
    headerComment: string;
    /** Whether THEN keyword was seen (for IF statements) */
    hasThen: boolean;
    /** Condition node for IF statements (for special formatting) */
    conditionNode: SyntaxNode | null;
    /** Keyword for condition (ACTION_IF/PATCH_IF) */
    conditionKeyword: string;
}

function createControlFlowState(): ControlFlowParseState {
    return {
        lines: [],
        headerParts: [],
        inBody: false,
        afterElse: false,
        lastContentRow: -1,
        beginRow: -1,
        lastHeaderRow: -1,
        headerComment: "",
        hasThen: false,
        conditionNode: null,
        conditionKeyword: "",
    };
}

// ============================================
// Condition formatting (OR/AND splitting)
// ============================================

/**
 * Flatten a binary_expr tree with OR/AND into a list of operands.
 * Returns null if the expression doesn't use OR/AND at top level.
 */
function flattenOrAndExpr(node: SyntaxNode): ConditionOperand[] | null {
    const op = node.childForFieldName("op");
    if (!op) return null;

    const opText = op.text;
    if (opText !== "OR" && opText !== "AND") {
        return null;
    }

    const left = node.childForFieldName("left");
    const right = node.childForFieldName("right");
    if (!left || !right) return null;

    const result: ConditionOperand[] = [];

    // Recursively flatten left side (for chained OR/AND)
    if (left.type === SyntaxType.BinaryExpr) {
        const leftFlat = flattenOrAndExpr(left);
        if (leftFlat) {
            result.push(...leftFlat);
        } else {
            result.push({ operator: null, text: normalizeWhitespace(left.text) });
        }
    } else {
        result.push({ operator: null, text: normalizeWhitespace(left.text) });
    }

    // Add right side with the operator
    result.push({ operator: op.text, text: normalizeWhitespace(right.text) });

    return result;
}

/**
 * Format a condition expression, splitting at OR/AND boundaries if too long.
 */
function formatCondition(
    conditionNode: SyntaxNode | null,
    prefix: string,
    indent: string,
    contIndent: string,
    lineLimit: number,
): string[] {
    if (!conditionNode) {
        return [indent + prefix];
    }

    // Normalize whitespace and strip spaces inside parentheses to match what
    // the split output produces (AST node texts don't have those spaces)
    const condText = normalizeWhitespace(conditionNode.text).replace(/\(\s+/g, "(").replace(/\s+\)/g, ")");
    const fullLine = indent + prefix + " " + condText;

    if (fullLine.length <= lineLimit) {
        return [fullLine];
    }

    // Find the actual expression to split - may be wrapped in value, unary_expr, or paren_expr
    let exprNode = conditionNode;
    let hasOuterParens = false;
    let unaryPrefix = "";

    // Unwrap value node to get to the actual expression
    if (exprNode.type === SyntaxType.Value && exprNode.children.length > 0) {
        for (const child of exprNode.children) {
            if (
                child.type === SyntaxType.BinaryExpr ||
                child.type === SyntaxType.ParenExpr ||
                child.type === SyntaxType.UnaryExpr
            ) {
                exprNode = child;
                break;
            }
        }
    }

    // Unwrap unary_expr (e.g. NOT (...)) - preserve the operator as prefix
    if (exprNode.type === SyntaxType.UnaryExpr) {
        const opNode = exprNode.childForFieldName("op");
        const operandNode = exprNode.childForFieldName("operand");
        if (opNode && operandNode) {
            unaryPrefix = opNode.text + " ";
            exprNode = operandNode;
        }
    }

    // Unwrap paren_expr to get to binary_expr
    if (exprNode.type === SyntaxType.ParenExpr && exprNode.children.length > 0) {
        for (const child of exprNode.children) {
            if (child.type === SyntaxType.BinaryExpr) {
                exprNode = child;
                hasOuterParens = true;
                break;
            }
        }
    }

    // Try to flatten OR/AND expressions
    if (exprNode.type === SyntaxType.BinaryExpr) {
        const operands = flattenOrAndExpr(exprNode);
        if (operands && operands.length > 1) {
            const lines: string[] = [];
            const openParen = hasOuterParens ? "(" : "";
            const closeParen = hasOuterParens ? ")" : "";
            for (let i = 0; i < operands.length; i++) {
                const op = operands[i];
                if (!op) continue;
                if (i === 0) {
                    lines.push(indent + prefix + " " + unaryPrefix + openParen + op.text);
                } else if (i === operands.length - 1) {
                    lines.push(contIndent + op.operator + " " + op.text + closeParen);
                } else {
                    lines.push(contIndent + op.operator + " " + op.text);
                }
            }
            return lines;
        }
    }

    return [fullLine];
}

// ============================================
// Main control flow formatting
// ============================================

/** Output BEGIN and transition to body state. */
function outputBeginAndEnterBody(
    state: ControlFlowParseState,
    child: SyntaxNode,
    indent: string,
    contIndent: string,
    lineLimit: number,
): void {
    // Handle ELSE BEGIN case
    if (state.afterElse && state.lines.length > 0) {
        const lastLine = lastElement(state.lines);
        if (lastLine && lastLine.trimEnd().endsWith(KW_ELSE)) {
            state.lines[state.lines.length - 1] = lastLine + " " + KW_BEGIN;
            state.headerParts = [];
            state.conditionNode = null;
            state.conditionKeyword = "";
            state.inBody = true;
            state.afterElse = false;
            state.beginRow = child.startPosition.row;
            return;
        }
    }
    state.afterElse = false;

    // Handle IF with condition
    if (state.conditionNode && state.conditionKeyword) {
        const condLines = formatCondition(state.conditionNode, state.conditionKeyword, indent, contIndent, lineLimit);
        state.lines.push(...condLines);
        const thenKeyword = state.hasThen ? KW_THEN + " " : "";
        // Inline comment on condition line forces BEGIN to next line
        if (state.headerComment) {
            const lastIdx = state.lines.length - 1;
            if (lastIdx >= 0) {
                state.lines[lastIdx] += INLINE_COMMENT_SPACING + state.headerComment;
            }
            state.lines.push(indent + thenKeyword + KW_BEGIN);
            state.headerComment = "";
        } else if (condLines.length > 1) {
            state.lines.push(indent + thenKeyword + KW_BEGIN);
        } else {
            const lastIdx = state.lines.length - 1;
            if (lastIdx >= 0) {
                state.lines[lastIdx] += " " + thenKeyword + KW_BEGIN;
            }
        }
        state.headerParts = [];
        state.conditionNode = null;
        state.conditionKeyword = "";
        state.hasThen = false;
        state.inBody = true;
        state.beginRow = child.startPosition.row;
        return;
    }

    // Output collected header parts
    const hasMultipleLines = state.headerParts.some((p) => p.includes("//"));
    outputHeaderLines([state.headerParts], state.lines, indent, contIndent);

    const lastLine = lastElement(state.lines) ?? "";
    const endsWithComment = lastLine.includes("//");

    if (hasMultipleLines || state.headerParts.length === 0 || endsWithComment) {
        state.lines.push(indent + KW_BEGIN);
    } else {
        const lastIdx = state.lines.length - 1;
        if (lastIdx >= 0) {
            state.lines[lastIdx] += " " + KW_BEGIN;
        } else {
            state.lines.push(indent + KW_BEGIN);
        }
    }
    state.headerParts = [];
    state.inBody = true;
    state.beginRow = child.startPosition.row;
}

/** Handle comment in control flow context. */
function handleControlFlowComment(
    child: SyntaxNode,
    state: ControlFlowParseState,
    indent: string,
    bodyIndent: string,
): void {
    if (state.inBody) {
        const rowToCheck = state.beginRow >= 0 ? state.beginRow : state.lastContentRow;
        if (tryAppendInlineComment(state.lines, child, rowToCheck)) {
            state.beginRow = -1;
            return;
        }
        state.lines.push(bodyIndent + normalizeComment(child.text));
        // Track the comment row so a body item that follows on the next source row
        // doesn't appear to have a gap (the comment occupies a row otherwise unseen).
        state.lastContentRow = child.endPosition.row;
        state.beginRow = -1;
    } else if (state.afterElse) {
        state.lines.push(indent + normalizeComment(child.text));
    } else if (state.lastHeaderRow >= 0 && child.startPosition.row === state.lastHeaderRow) {
        // Inline comment on same row as IF keyword or condition
        state.headerComment = normalizeComment(child.text);
    } else {
        state.headerParts.push(normalizeComment(child.text));
    }
}

// ============================================
// TRY block formatting (no BEGIN keyword)
// ============================================

/**
 * Format TRY blocks (PATCH_TRY, ACTION_TRY).
 * Structure: KEYWORD <body> WITH [DEFAULT] <default_body> END
 * Note: TRY blocks have no BEGIN keyword - body starts immediately.
 */
function formatTryBlock(
    node: SyntaxNode,
    ctx: FormatContext,
    depth: number,
    formatNode: (node: SyntaxNode, ctx: FormatContext, depth: number) => string,
): string {
    const indent = ctx.indent.repeat(depth);
    const bodyIndent = ctx.indent.repeat(depth + 1);
    const lines: string[] = [];
    let lastEndRow = -1;

    for (const child of node.children) {
        // TRY keyword (PATCH_TRY or ACTION_TRY)
        if (child.text === KW_PATCH_TRY || child.text === KW_ACTION_TRY) {
            lines.push(indent + child.text);
            continue;
        }

        // WITH keyword - switch to default section
        if (isKeyword(child, KW_WITH)) {
            lines.push(indent + KW_WITH);
            // Reset gap reference: a fresh body section shouldn't measure gap against
            // the previous section's last content row.
            lastEndRow = child.startPosition.row;
            continue;
        }

        // DEFAULT keyword
        if (isKeyword(child, KW_DEFAULT)) {
            // Append DEFAULT to WITH line if it's the last line
            const lastLine = lastElement(lines);
            if (lastLine && lastLine.trimEnd().endsWith(KW_WITH)) {
                lines[lines.length - 1] = lastLine + " " + KW_DEFAULT;
            } else {
                lines.push(indent + KW_DEFAULT);
            }
            lastEndRow = child.startPosition.row;
            continue;
        }

        // END keyword
        if (isKeyword(child, KW_END)) {
            lines.push(indent + KW_END);
            continue;
        }

        // Comments
        if (isComment(child)) {
            lastEndRow = handleComment(lines, child, bodyIndent, lastEndRow);
            continue;
        }

        // Body content (both main body and default body)
        if (isBodyContent(child.type)) {
            pushBlankIfGap(lines, child, lastEndRow);
            lines.push(formatNode(child, ctx, depth + 1));
            lastEndRow = child.endPosition.row;
        }
    }

    return lines.join("\n");
}

/**
 * Format control flow constructs (IF, MATCH, TRY, FOR, WHILE, array definitions).
 */
export function formatControlFlow(
    node: SyntaxNode,
    ctx: FormatContext,
    depth: number,
    formatNode: (node: SyntaxNode, ctx: FormatContext, depth: number) => string,
): string {
    // Report if control flow node has no children (malformed)
    if (node.children.length === 0) {
        throwFormatError(
            `Empty control flow node '${node.type}'`,
            node.startPosition.row + 1,
            node.startPosition.column + 1,
        );
    }
    // Handle FOR loops specially
    const forHeader = formatForLoopHeader(node);
    if (forHeader !== null) {
        return formatForLoop(node, ctx, depth, forHeader, formatNode);
    }

    // Handle FOR_EACH loops
    if (isForEach(node.type)) {
        return formatForEach(node, ctx, depth, formatNode);
    }

    // Handle associative arrays
    if (isAssociativeArrayDef(node.type)) {
        return formatAssociativeArray(node, ctx, depth);
    }

    // Handle TRY blocks (no BEGIN keyword - body starts immediately)
    if (node.type === NODE_PATCH_TRY || node.type === NODE_ACTION_TRY) {
        return formatTryBlock(node, ctx, depth, formatNode);
    }

    const indent = ctx.indent.repeat(depth);
    const contIndent = indent + ctx.indent;
    const bodyIndent = ctx.indent.repeat(depth + 1);

    const state = createControlFlowState();

    for (const child of node.children) {
        // BEGIN keyword
        if (isKeyword(child, KW_BEGIN)) {
            outputBeginAndEnterBody(state, child, indent, contIndent, ctx.lineLimit);
            continue;
        }

        // END keyword
        if (isKeyword(child, KW_END)) {
            state.inBody = false;
            state.lines.push(indent + KW_END);
            continue;
        }

        // ELSE keyword
        if (isKeyword(child, KW_ELSE)) {
            const lastLine = lastElement(state.lines);
            if (lastLine && lastLine.trimEnd().endsWith(KW_END)) {
                state.lines[state.lines.length - 1] = lastLine + " " + KW_ELSE;
            } else {
                state.lines.push(indent + KW_ELSE);
            }
            state.afterElse = true;
            continue;
        }

        // THEN keyword
        if (isKeyword(child, KW_THEN)) {
            state.hasThen = true;
            state.headerParts.push(KW_THEN);
            continue;
        }

        // WITH keyword (MATCH statements)
        if (isKeyword(child, KW_WITH)) {
            outputHeaderLines([state.headerParts], state.lines, indent, contIndent);
            state.headerParts = [];
            state.lines.push(indent + KW_WITH);
            state.inBody = true;
            state.beginRow = child.startPosition.row;
            continue;
        }

        // DEFAULT keyword
        if (isKeyword(child, KW_DEFAULT)) {
            state.lines.push(indent + KW_DEFAULT);
            state.beginRow = child.startPosition.row;
            continue;
        }

        // ELSE IF chaining: join first line of nested IF onto the "END ELSE" line
        if (state.afterElse && (child.type === SyntaxType.ActionIf || child.type === SyntaxType.PatchIf)) {
            const nestedLines = formatNode(child, ctx, depth).split("\n");
            const firstLine = nestedLines[0]?.trimStart() ?? "";
            const lastLine = lastElement(state.lines);
            if (lastLine && firstLine) {
                state.lines[state.lines.length - 1] = lastLine + " " + firstLine;
            }
            for (let i = 1; i < nestedLines.length; i++) {
                state.lines.push(nestedLines[i] ?? "");
            }
            state.afterElse = false;
            continue;
        }

        // Comments
        if (isComment(child)) {
            handleControlFlowComment(child, state, indent, bodyIndent);
            continue;
        }

        // Body content
        if (state.inBody) {
            if (isControlFlowBodyContent(child.type)) {
                // Reference row for gap detection: BEGIN row when available (first body
                // item after BEGIN), else the previous body item's row. This matters for
                // ELSE BEGIN — a fresh body shouldn't measure gap against the previous
                // branch's last content.
                const rowToCheck = state.beginRow >= 0 ? state.beginRow : state.lastContentRow;
                pushBlankIfGap(state.lines, child, rowToCheck);
                state.lines.push(formatNode(child, ctx, depth + 1));
                state.lastContentRow = child.endPosition.row;
                state.beginRow = -1;
            }
        } else {
            // Header collection
            if (child.text === KW_PATCH_IF || child.text === KW_ACTION_IF) {
                state.conditionKeyword = child.text;
                state.conditionNode = node.childForFieldName("condition") ?? null;
                state.lastHeaderRow = child.endPosition.row;
                continue;
            }
            if (state.conditionNode && child === state.conditionNode) {
                state.lastHeaderRow = child.endPosition.row;
                continue;
            }
            state.lastHeaderRow = child.endPosition.row;
            state.headerParts.push(child.text);
        }
    }

    // Output any remaining header parts
    outputHeaderLines([state.headerParts], state.lines, indent, contIndent);

    return state.lines.join("\n");
}

// ============================================
// Match case formatting
// ============================================

/** Format match_case: values BEGIN body END */
export function formatMatchCase(
    node: SyntaxNode,
    ctx: FormatContext,
    depth: number,
    formatNode: (node: SyntaxNode, ctx: FormatContext, depth: number) => string,
): string {
    const indent = ctx.indent.repeat(depth);
    const bodyIndent = ctx.indent.repeat(depth + 1);
    const lines: string[] = [];

    const headerParts: string[] = [];
    let inBody = false;
    let lastEndRow = -1;

    for (const child of node.children) {
        if (isKeyword(child, KW_BEGIN)) {
            const header = normalizeWhitespace(headerParts.join(" "));
            if (header.includes("//")) {
                lines.push(indent + header);
                lines.push(indent + KW_BEGIN);
            } else {
                lines.push(indent + header + " " + KW_BEGIN);
            }
            inBody = true;
            lastEndRow = child.startPosition.row;
            continue;
        }

        if (isKeyword(child, KW_END)) {
            lines.push(indent + KW_END);
            inBody = false;
            continue;
        }

        if (isComment(child)) {
            if (inBody) {
                lastEndRow = handleComment(lines, child, bodyIndent, lastEndRow);
            } else {
                headerParts.push(normalizeComment(child.text));
            }
            continue;
        }

        if (inBody) {
            if (isBodyContent(child.type)) {
                pushBlankIfGap(lines, child, lastEndRow);
                lines.push(formatNode(child, ctx, depth + 1));
                lastEndRow = child.endPosition.row;
            }
        } else {
            headerParts.push(child.text);
        }
    }

    return lines.join("\n");
}

// Re-export formatCondition for use in predicate formatting
export { formatCondition };
