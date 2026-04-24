/**
 * Shared tree-sitter utilities for WeiDU TP2 files.
 * Common functions used across rename, definition, and variable-symbols features.
 */

import { Position } from "vscode-languageserver/node";
import type { Node as SyntaxNode } from "web-tree-sitter";
import { SyntaxType } from "./tree-sitter.d";

// ============================================
// Tree traversal utilities
// ============================================

/**
 * Find the deepest node at the given position.
 */
export function findNodeAtPosition(root: SyntaxNode, position: Position): SyntaxNode | null {
    function visit(node: SyntaxNode): SyntaxNode | null {
        const startRow = node.startPosition.row;
        const endRow = node.endPosition.row;
        const startCol = node.startPosition.column;
        const endCol = node.endPosition.column;

        const inRange =
            (position.line > startRow || (position.line === startRow && position.character >= startCol)) &&
            (position.line < endRow || (position.line === endRow && position.character <= endCol));

        if (!inRange) {
            return null;
        }

        // Try to find a more specific child
        for (const child of node.children) {
            const result = visit(child);
            if (result) {
                return result;
            }
        }

        return node;
    }

    return visit(root);
}

/**
 * Find an ancestor node matching one of the given types.
 * Accepts ReadonlySet<SyntaxType> - SyntaxType enum values are strings, matching node.type.
 */
export function findAncestorOfType(node: SyntaxNode, types: ReadonlySet<SyntaxType | string>): SyntaxNode | null {
    let current: SyntaxNode | null = node;
    while (current) {
        if (types.has(current.type as SyntaxType)) {
            return current;
        }
        current = current.parent;
    }
    return null;
}

/**
 * Check if two nodes represent the same position in the source.
 * Tree-sitter may return different object references for the same node.
 */
export function isSameNode(node1: SyntaxNode, node2: SyntaxNode): boolean {
    return (
        node1.startPosition.row === node2.startPosition.row &&
        node1.startPosition.column === node2.startPosition.column &&
        node1.endPosition.row === node2.endPosition.row &&
        node1.endPosition.column === node2.endPosition.column &&
        node1.text === node2.text
    );
}

// ============================================
// Node unwrapping utilities
// ============================================

/**
 * Unwrap a variable_ref node to get the inner identifier.
 * WeiDU wraps variable references in a variable_ref node; this extracts the identifier.
 * Returns the original node if it's not a variable_ref or has no children.
 */
export function unwrapVariableRef(node: SyntaxNode): SyntaxNode {
    if (node.type === SyntaxType.VariableRef) {
        return node.child(0) ?? node;
    }
    return node;
}

/**
 * Find the first Identifier descendant of a node.
 * Handles arbitrarily nested wrappers like value > simple_value > variable_ref > identifier.
 */
export function findIdentifier(node: SyntaxNode): SyntaxNode | null {
    if (node.type === SyntaxType.Identifier) {
        return node;
    }
    for (const child of node.children) {
        const found = findIdentifier(child);
        if (found) {
            return found;
        }
    }
    return null;
}

// ============================================
// Assignment validation
// ============================================

/** Node types for assignment nodes that can be phantom (tree-sitter error recovery). */
const ASSIGNMENT_NODE_TYPES: ReadonlySet<string> = new Set([SyntaxType.PatchAssignment]);

/**
 * Assignment operators from the grammar's `_assign_op` rule.
 * Mirrors `grammars/weidu-tp2/grammar.js` line:
 *   _assign_op: ($) => choice("=", "+=", "-=", "*=", "/=", "|=", "&=", "||=", "&&=")
 *
 * Using a Set rather than hardcoded if-chain so that adding an operator to the grammar
 * only requires adding it here. If a new operator is missed, the function falls through
 * to "no operator found" and returns true (phantom) — this is the safe direction
 * (rejects a real assignment rather than accepting a phantom one).
 */
const ASSIGN_OPS: ReadonlySet<string> = new Set(["=", "+=", "-=", "*=", "/=", "|=", "&=", "||=", "&&="]);

/**
 * Check if an assignment node is a phantom created by tree-sitter error recovery.
 *
 * When tree-sitter can't parse a keyword (e.g. partially typed "COPY_EXISTN"),
 * error recovery may create a patch_assignment with a zero-width "=" operator
 * that doesn't exist in the source text.
 * These phantom assignments produce spurious variable completions.
 *
 * Detection: assignment nodes where the "=" child has zero width (startIndex === endIndex).
 * Only applies to bare assignment nodes (PatchAssignment),
 * not keyword-based declarations (OUTER_SET, SPRINT, etc.) which have explicit keywords.
 *
 * Design limitation: This relies on tree-sitter error recovery producing zero-width
 * operator tokens for phantom assignments. This is observed behavior (tested across
 * many broken inputs), not a documented tree-sitter guarantee. A tree-sitter version
 * update could change error recovery heuristics. The self-completion exclusion in
 * provider.ts (excludeWord in the general completion path) provides a second layer
 * of defense if this check is ever bypassed.
 *
 * Alternative considered: removing PatchAssignment from VARIABLE_TYPES entirely
 * (option 3). This would be foolproof but would miss legitimate bare assignments
 * (`foo = 5`) in .tpp patch-only files. The pragmatic choice is to keep them
 * and validate structurally.
 */
export function isPhantomAssignment(node: SyntaxNode): boolean {
    if (!ASSIGNMENT_NODE_TYPES.has(node.type)) {
        return false;
    }

    for (const child of node.children) {
        if (ASSIGN_OPS.has(child.type)) {
            // Zero-width operator = phantom inserted by error recovery,
            // not present in the source text
            return child.startIndex === child.endIndex;
        }
    }

    // No operator child found at all — also phantom
    return true;
}

// ============================================
// Naming heuristics
// ============================================

/**
 * Check if a variable name looks like a constant based on WeiDU naming convention.
 * Returns true if the first word (before `_` or end of string) is all uppercase.
 * Examples: `OPCODE_overlay_grease` → true, `over_exists` → false, `FOO` → true.
 *
 * WeiDU has no `const` keyword, so this is a heuristic. Used to assign
 * CompletionItemKind.Constant vs Variable for better icon differentiation.
 *
 * Same heuristic is used in:
 * - symbol.ts:varSymbolKind (outline icons)
 * - hover.ts:buildVariableHover (show value for constants)
 * - weidu-tp2.tmLanguage.yml:set-sprint-constant-vars (syntax highlighting)
 * - weidu-tp2.tmLanguage.yml:vars-declaration (syntax highlighting)
 */
export function looksLikeConstant(name: string): boolean {
    const firstWord = name.split("_", 1)[0];
    return (
        firstWord !== undefined &&
        firstWord.length > 0 &&
        firstWord === firstWord.toUpperCase() &&
        /[A-Z]/.test(firstWord)
    );
}

// ============================================
// String utilities
// ============================================

/**
 * Strip WeiDU string delimiters from a string.
 * WeiDU uses ~, ", %, and ~ ~...~ ~ for strings.
 * This is the most complete version, supporting all delimiter types.
 */
export function stripStringDelimiters(text: string): string {
    if (text.length < 2) {
        return text;
    }
    const first = text[0];
    const last = text[text.length - 1];
    if ((first === "~" && last === "~") || (first === '"' && last === '"') || (first === "%" && last === "%")) {
        return text.slice(1, -1);
    }
    return text;
}
