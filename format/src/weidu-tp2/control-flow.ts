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
    NODE_INNER_ACTION,
} from "./types";
import {
    isComment,
    isKeyword,
    isForEach,
    isAssociativeArrayDef,
    isBodyContent,
    normalizeComment,
    hasWeiduLineComment,
    normalizeWhitespace,
    handleComment,
    tryAppendInlineComment,
    outputHeaderLines,
    lastElement,
    isControlFlowBodyContent,
    pushBlankIfGap,
} from "./utils";
import { SyntaxType } from "@bgforge/shared/syntax-types/weidu-tp2";
import { weave, type WovenItem } from "../format-utils";
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
    /** Whether the condition node was reached (comments before it sit between the keyword and the condition) */
    conditionSeen: boolean;
    /** Comments between the IF keyword and its condition */
    preConditionComments: SyntaxNode[];
    /** Comments after the condition, on rows below it, ahead of BEGIN */
    afterConditionComments: string[];
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
        conditionSeen: false,
        preConditionComments: [],
        afterConditionComments: [],
        hasThen: false,
        conditionNode: null,
        conditionKeyword: "",
    };
}

// ============================================
// Condition formatting (OR/AND splitting)
// ============================================

/** Every comment written inside a condition, with the row it sits on. */
function collectComments(node: SyntaxNode, skip: ReadonlySet<number>): { row: number; column: number; text: string }[] {
    const found: { row: number; column: number; text: string }[] = [];
    const walk = (n: SyntaxNode): void => {
        if (isComment(n) && skip.has(n.id)) return;
        if (isComment(n)) {
            found.push({ row: n.startPosition.row, column: n.startPosition.column, text: normalizeComment(n.text) });
            return;
        }
        n.children.forEach((child) => walk(child));
    };
    walk(node);
    return found;
}

/** The operand `node` of a condition, joined to the previous one by `operator`. */
function conditionOperand(operator: string | null, node: SyntaxNode): ConditionOperand {
    return {
        operator,
        text: normalizeWhitespace(node.text),
        startRow: node.startPosition.row,
        startColumn: node.startPosition.column,
        endRow: node.endPosition.row,
        endColumn: node.endPosition.column,
    };
}

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
            result.push(conditionOperand(null, left));
        }
    } else {
        result.push(conditionOperand(null, left));
    }

    // Add right side with the operator
    result.push(conditionOperand(op.text, right));

    return result;
}

/** Node types whose text is content: blanks and parentheses inside them are not the formatter's to touch. */
const LITERAL_TYPES: ReadonlySet<string> = new Set([
    SyntaxType.String,
    SyntaxType.TildeString,
    SyntaxType.FiveTildeString,
    SyntaxType.DoubleString,
    SyntaxType.PercentString,
    SyntaxType.Comment,
    SyntaxType.LineComment,
]);

/** Drop the blanks after each `(` and before each `)` of code text. */
function tightenCode(code: string): string {
    // A blank run is taken whole and kept unless a `)` follows: `/\s+\)/` would retry from every blank of a long run.
    return code
        .replaceAll(/\(\s+/g, "(")
        .replaceAll(/(\s+)(\)?)/g, (_run, blanks: string, close: string) => (close === "" ? blanks : close));
}

/**
 * The condition's text with the blanks inside its parentheses dropped, strings and comments left as written.
 * Works from the condition's tree: only the stretches between string and comment nodes are tightened.
 */
function tightenParens(node: SyntaxNode, skip: ReadonlySet<number>): string {
    const literals: SyntaxNode[] = [];
    const walk = (n: SyntaxNode): void => {
        if (LITERAL_TYPES.has(n.type)) {
            literals.push(n);
            return;
        }
        n.children.forEach((child) => walk(child));
    };
    walk(node);

    const text = node.text;
    let result = "";
    let pos = 0;
    let afterLineComment = false;
    const pushCode = (code: string): void => {
        // The newline ending a line comment stays, or the `)` after it would move into the comment.
        if (afterLineComment && code.startsWith("\n")) {
            result += "\n" + tightenCode(code.slice(1));
        } else {
            result += tightenCode(code);
        }
    };
    for (const literal of literals) {
        const start = literal.startIndex - node.startIndex;
        pushCode(text.slice(pos, start));
        // A skipped comment is written elsewhere: nothing of it stays here, nor the blank that stood before it.
        result += skip.has(literal.id) ? "" : literal.text;
        pos = start + literal.text.length;
        afterLineComment = literal.type === SyntaxType.LineComment;
    }
    pushCode(text.slice(pos));
    if (skip.size > 0 && result.endsWith(")")) result = result.slice(0, -1).trimEnd() + ")";
    return result;
}

/**
 * The comments written just before the `)` that closes a condition which is one parenthesised expression. They are
 * written after the `)` instead, where the same comments are read again: the condition stays on one line when it fits,
 * and a second pass leaves it as it is.
 */
function closingComments(condition: SyntaxNode | null): SyntaxNode[] {
    if (!condition) return [];
    const paren =
        condition.type === SyntaxType.ParenExpr
            ? condition
            : condition
                  .descendantsOfType(SyntaxType.ParenExpr)
                  .find((p) => p.startIndex === condition.startIndex && p.endIndex === condition.endIndex);
    // Only an OR/AND chain is split by operand, which is where the comment's place differs between two passes; any
    // other condition keeps the comment and the `)` on the line after it.
    const inner = paren?.children.find((c) => c.type === SyntaxType.BinaryExpr);
    if (!paren || !inner || flattenOrAndExpr(inner) === null) return [];
    const close = paren.children.findLastIndex((c) => c.type === ")");
    const found: SyntaxNode[] = [];
    for (let i = close - 1; i >= 0 && isComment(paren.children[i]!); i--) found.unshift(paren.children[i]!);
    return found;
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
    skip: ReadonlySet<number> = new Set(),
): string[] {
    if (!conditionNode) {
        return [indent + prefix];
    }

    // Comments written between the operands rule out the one-line form: joining would put everything after the
    // first `//` inside that comment. Splitting unconditionally also makes the output idempotent - the one-line
    // form's width check cannot see the ` BEGIN` and trailing comment the caller appends afterwards, so a
    // commented condition would otherwise split on one pass and rejoin on the next.
    const comments = collectComments(conditionNode, skip);

    // Normalize whitespace and strip spaces inside parentheses to match what
    // the split output produces (AST node texts don't have those spaces)
    const condText = normalizeWhitespace(tightenParens(conditionNode, skip));
    // No prefix when a line comment after the keyword has already ended the line it sat on.
    const head = prefix === "" ? "" : prefix + " ";
    const fullLine = indent + head + condText;

    if (comments.length === 0 && fullLine.length <= lineLimit) {
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
            // A comment inside an operand's span is already in its text. Every other comment follows the last operand
            // that ends before it, or the first one when none does, on that operand's line and in source order.
            const endsBefore = (operand: ConditionOperand, cm: { row: number; column: number }): boolean =>
                operand.endRow < cm.row || (operand.endRow === cm.row && operand.endColumn <= cm.column);
            const startsBefore = (operand: ConditionOperand, cm: { row: number; column: number }): boolean =>
                operand.startRow < cm.row || (operand.startRow === cm.row && operand.startColumn <= cm.column);
            const trailing: string[][] = operands.map(() => []);
            for (const cm of comments) {
                if (operands.some((operand) => startsBefore(operand, cm) && !endsBefore(operand, cm))) continue;
                const after = operands.findLastIndex((operand) => endsBefore(operand, cm));
                trailing[Math.max(after, 0)]?.push(cm.text);
            }
            for (let i = 0; i < operands.length; i++) {
                const op = operands[i];
                if (!op) continue;
                let line: string;
                if (i === 0) {
                    line = indent + head + unaryPrefix + openParen + op.text;
                } else if (i === operands.length - 1) {
                    line = contIndent + op.operator + " " + op.text + closeParen;
                } else {
                    line = contIndent + op.operator + " " + op.text;
                }
                for (const text of trailing[i] ?? []) line += INLINE_COMMENT_SPACING + text;
                lines.push(line);
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
        // The comments between the keyword and the condition stay there; a `//` one ends the line, so the condition
        // starts the next.
        const prefix = weave(
            [
                { text: state.conditionKeyword, sep: "" },
                ...state.preConditionComments.map((comment): WovenItem => ({
                    comment: comment.text,
                    endsLine: comment.type === SyntaxType.LineComment,
                })),
            ],
            contIndent,
        );
        const prefixEndsLine = state.preConditionComments.at(-1)?.type === SyntaxType.LineComment;
        if (prefixEndsLine) state.lines.push(indent + prefix);
        const closing = closingComments(state.conditionNode);
        const skip = new Set(closing.map((comment) => comment.id));
        const condLines = prefixEndsLine
            ? formatCondition(state.conditionNode, "", contIndent, contIndent, lineLimit, skip)
            : formatCondition(state.conditionNode, prefix, indent, contIndent, lineLimit, skip);
        // The comments before the closing `)` follow it, ahead of the ones written after it.
        if (closing.length > 0) {
            const text = closing.map((comment) => normalizeComment(comment.text)).join(" ");
            state.headerComment = state.headerComment === "" ? text : text + " " + state.headerComment;
        }
        state.lines.push(...condLines);
        const thenKeyword = state.hasThen ? KW_THEN + " " : "";
        // Comments after the condition, on rows below it, keep their lines ahead of THEN and BEGIN
        const afterCondition = state.afterConditionComments.map((comment) => contIndent + comment);
        state.afterConditionComments = [];
        // Inline comment on condition line forces BEGIN to next line
        if (state.headerComment) {
            const lastIdx = state.lines.length - 1;
            if (lastIdx >= 0) {
                state.lines[lastIdx] += INLINE_COMMENT_SPACING + state.headerComment;
            }
            state.lines.push(...afterCondition, indent + thenKeyword + KW_BEGIN);
            state.headerComment = "";
        } else if (afterCondition.length > 0) {
            state.lines.push(...afterCondition, indent + thenKeyword + KW_BEGIN);
        } else if (condLines.length > 1 || prefixEndsLine) {
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
        state.conditionSeen = false;
        state.preConditionComments = [];
        state.hasThen = false;
        state.inBody = true;
        state.beginRow = child.startPosition.row;
        return;
    }

    // Output collected header parts
    const hasMultipleLines = state.headerParts.some(hasWeiduLineComment);
    outputHeaderLines([state.headerParts], state.lines, indent, contIndent);

    const lastLine = lastElement(state.lines) ?? "";
    const endsWithComment = hasWeiduLineComment(lastLine);

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
            // The next comment on this row joins it, and none below it sees a gap.
            state.lastContentRow = child.endPosition.row;
            return;
        }
        // A blank line above a comment stays, as one above any other body item does.
        pushBlankIfGap(state.lines, child, rowToCheck);
        state.lines.push(bodyIndent + normalizeComment(child.text));
        // Track the comment row so a body item that follows on the next source row
        // doesn't appear to have a gap (the comment occupies a row otherwise unseen).
        state.lastContentRow = child.endPosition.row;
        state.beginRow = -1;
    } else if (state.afterElse || state.lines.length > 0) {
        // After an ELSE, or after a body's END (the header is out by the first BEGIN): a line of its own. Joined
        // into the header parts, comments written between END and ELSE ran together into one.
        state.lines.push(indent + normalizeComment(child.text));
    } else if (state.conditionNode !== null && !state.conditionSeen) {
        // Between the IF keyword and its condition
        state.preConditionComments.push(child);
    } else if (
        state.conditionNode !== null &&
        state.lastHeaderRow >= 0 &&
        child.startPosition.row === state.lastHeaderRow
    ) {
        // Inline comment on same row as the condition
        const text = normalizeComment(child.text);
        state.headerComment = state.headerComment === "" ? text : state.headerComment + " " + text;
    } else if (state.conditionNode !== null) {
        // After the condition, on a row of its own
        state.afterConditionComments.push(normalizeComment(child.text));
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
    const forHeader = formatForLoopHeader(node, ctx.indent.repeat(depth + 1));
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

        // ELSE IF chaining: join first line of nested IF (or of an INNER_ACTION block) onto the "END ELSE" line
        if (
            state.afterElse &&
            (child.type === SyntaxType.ActionIf ||
                child.type === SyntaxType.PatchIf ||
                child.type === NODE_INNER_ACTION)
        ) {
            const nestedLines = formatNode(child, ctx, depth).split("\n");
            const firstLine = nestedLines[0]?.trimStart() ?? "";
            const lastLine = lastElement(state.lines);
            // Not onto a line that ends in a line comment, which would take the IF into itself, nor when the nested
            // text opens with a comment of its own: it stays a line of its own, as the IF below it does.
            const joinable = lastLine && firstLine && !hasWeiduLineComment(lastLine) && !/^\/[/*]/.test(firstLine);
            if (joinable) {
                state.lines[state.lines.length - 1] = lastLine + " " + firstLine;
            }
            for (let i = joinable ? 1 : 0; i < nestedLines.length; i++) {
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
                // ELSE BEGIN - a fresh body shouldn't measure gap against the previous
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
            // By id: two reads of one node are different objects, so `===` never finds the condition.
            if (state.conditionNode && child.id === state.conditionNode.id) {
                state.lastHeaderRow = child.endPosition.row;
                state.conditionSeen = true;
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
            // A line comment ends its line: what follows it, a case value included, would otherwise join it.
            const header = normalizeWhitespace(
                headerParts.map((part) => part + (part.startsWith("//") ? "\n" : " ")).join(""),
            );
            const headerLines = header.split("\n").map((line) => indent + line);
            const lastHeaderLine = headerLines.pop() ?? indent;
            if (hasWeiduLineComment(lastHeaderLine)) {
                lines.push(...headerLines, lastHeaderLine, indent + KW_BEGIN);
            } else {
                lines.push(...headerLines, lastHeaderLine + " " + KW_BEGIN);
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
