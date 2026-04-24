/**
 * Symbol discovery for WeiDU TP2 rename operations.
 * Identifies what symbol is at a given cursor position and determines
 * whether it's a variable, function/macro name, and its scope.
 */

import type { Position } from "vscode-languageserver/node";
import type { Node as SyntaxNode } from "web-tree-sitter";
import { ScopeKind, type ScopeKind as ScopeKindValue } from "./scope-kinds";
import { SyntaxType } from "./tree-sitter.d";
import { FUNCTION_CALL_TYPES, getCallableSymbolAtPosition } from "./callable-symbols";
import {
    VARIABLE_DECL_TYPES,
    STRING_CONTENT_TYPES,
    LOOP_TYPES,
    findContainingFunction,
    findContainingLoop,
    getVariableSymbolAtPosition,
    isLoopVariable,
} from "./variable-symbols";
import { findNodeAtPosition, findAncestorOfType, isSameNode } from "./tree-utils";

// ============================================
// Constants
// ============================================

/** Automatic variables that should not be renamed. */
const AUTOMATIC_VARIABLES: ReadonlySet<string> = new Set([
    "SOURCE_FILE",
    "SOURCE_RES",
    "SOURCE_EXT",
    "SOURCE_DIRECTORY",
    "DEST_FILE",
    "DEST_RES",
    "DEST_EXT",
    "DEST_DIRECTORY",
    "COMPONENT_NUMBER",
    "TP2_FILE_NAME",
    "TP2_BASE_NAME",
    "LANGUAGE",
]);

// ============================================
// Types
// ============================================

export interface SymbolInfo {
    name: string;
    kind: "variable" | "function";
    scope: ScopeKindValue;
    functionNode?: SyntaxNode; // For function-scoped variables
    loopNode?: SyntaxNode; // For loop-scoped variables (PHP_EACH, FOR_EACH)
    node: SyntaxNode; // The node where the symbol was found
}

/**
 * Synthetic node created for %var% references found in string content.
 * These are not part of the grammar but are created programmatically
 * to represent variable references within strings for rename operations.
 */
export interface SyntheticPercentVarNode {
    type: "synthetic_percent_var";
    text: string;
    startPosition: { row: number; column: number };
    endPosition: { row: number; column: number };
    children: [];
    parent: SyntaxNode;
}

// ============================================
// Symbol finding
// ============================================

/**
 * Get symbol information at the given position.
 */
export function getSymbolAtPosition(root: SyntaxNode, position: Position): SymbolInfo | null {
    // Find the node at the position
    let node = findNodeAtPosition(root, position);
    if (!node) {
        return null;
    }

    // If we found a % token, check if it's part of a percent_string
    // This happens when cursor is right on the % delimiter
    // Note: "%" is a terminal token in the grammar, not a SyntaxType enum value
    const PERCENT_TOKEN = "%";
    if (node.type === PERCENT_TOKEN) {
        const parent = node.parent;
        if (parent && parent.type === SyntaxType.PercentString) {
            node = parent;
        }
    }

    // String content nodes (tilde_content, double_content, etc.) can contain either:
    // 1. %var% variable references - handled here, returns early if found
    // 2. Function/macro names like ~my_macro~ - handled in the second STRING_CONTENT_TYPES check below
    if (STRING_CONTENT_TYPES.has(node.type as SyntaxType)) {
        const variableSymbol = getVariableSymbolAtPosition(root, position);
        if (variableSymbol) {
            return variableSymbol;
        }
        // No %var% found at cursor - fall through to check for function/macro names below
    }

    if (
        node.type === SyntaxType.PercentString ||
        node.type === SyntaxType.PercentContent ||
        node.type === SyntaxType.VariableRef
    ) {
        return getVariableSymbolAtPosition(root, position);
    }

    // String content that's a function/macro name (e.g., ~my_macro~ in DEFINE_PATCH_MACRO ~my_macro~)
    // Only reached if the earlier STRING_CONTENT_TYPES check found no %var% at cursor
    if (STRING_CONTENT_TYPES.has(node.type as SyntaxType)) {
        const callableSymbol = getCallableSymbolAtPosition(root, position);
        if (callableSymbol) {
            return callableSymbol;
        }
    }

    // Check if it's an identifier or string (strings are used for macro names)
    if (node.type === SyntaxType.Identifier || node.type === SyntaxType.String) {
        // Check if it's part of a function definition or call
        const callableSymbol = getCallableSymbolAtPosition(root, position);
        if (callableSymbol) {
            return callableSymbol;
        }

        const name = node.text;

        // Check if it's a variable in declaration
        const varDecl = findAncestorOfType(node, VARIABLE_DECL_TYPES);
        if (varDecl) {
            // Reject if this is a parameter name inside a function CALL (not definition)
            // Function calls use INT_VAR/STR_VAR to specify argument values, but the parameter
            // names in the call are not renameable - they refer to the function definition's params
            const callAncestor = findAncestorOfType(node, FUNCTION_CALL_TYPES);
            if (callAncestor) {
                return null; // Function call arguments cannot be renamed
            }

            // Check if this is a loop variable declaration
            if (LOOP_TYPES.has(varDecl.type as SyntaxType)) {
                // Check if node is the loop variable (key_var, value_var for PHP_EACH, or var for FOR_EACH)
                const keyVarNode = varDecl.childForFieldName("key_var");
                const valueVarNode = varDecl.childForFieldName("value_var");
                const forEachVarNode = varDecl.childForFieldName("var");

                const isLoopVar =
                    (keyVarNode && isSameNode(keyVarNode, node)) ||
                    (valueVarNode && isSameNode(valueVarNode, node)) ||
                    (forEachVarNode && isSameNode(forEachVarNode, node));

                if (isLoopVar) {
                    return {
                        name,
                        kind: "variable",
                        scope: ScopeKind.Loop,
                        loopNode: varDecl,
                        node,
                    };
                }
            }

            // Find the containing function (if any)
            const functionNode = findContainingFunction(node);
            const scope = functionNode ? ScopeKind.Function : ScopeKind.File;

            return {
                name,
                kind: "variable",
                scope,
                functionNode: functionNode ?? undefined,
                node,
            };
        }

        // Check if it's an array name in $array(index) access
        const arrayAccess = findAncestorOfType(node, new Set([SyntaxType.ArrayAccess]));
        if (arrayAccess) {
            const nameNode = arrayAccess.childForFieldName("name");
            if (nameNode && isSameNode(nameNode, node)) {
                return getVariableSymbolAtPosition(root, position);
            }
        }

        // Fallback: identifier used as variable reference in expression (e.g., `c == archer_column`)
        // This handles identifiers that aren't in declarations, function names, or array accesses
        if (node.type === SyntaxType.Identifier) {
            // Reject if this is a parameter name inside a function CALL
            // Function calls use INT_VAR/STR_VAR to specify which parameters to pass values to,
            // but these parameter names are not renameable - they refer to the function's definition
            const callAncestor = findAncestorOfType(node, FUNCTION_CALL_TYPES);
            if (callAncestor) {
                // Check if we're inside an int_var_call_item or similar param specification
                // by checking if a parent up to the call node is one of the call param types
                let current: SyntaxNode | null = node.parent;
                while (current && !isSameNode(current, callAncestor)) {
                    // int_var_call_item, str_var_call_item, ret_call_item, ret_array_call_item
                    // contain the parameter names in function calls
                    if (
                        current.type === SyntaxType.IntVarCallItem ||
                        current.type === SyntaxType.StrVarCallItem ||
                        current.type === SyntaxType.RetCallItem ||
                        current.type === SyntaxType.RetArrayCallItem
                    ) {
                        // Only reject if cursor is on the param name (first child),
                        // not on the value part. Grammar: call_item = name [= value]
                        const paramNameNode = current.children[0];
                        if (
                            paramNameNode &&
                            node.startIndex >= paramNameNode.startIndex &&
                            node.endIndex <= paramNameNode.endIndex
                        ) {
                            return null; // Function call parameter names cannot be renamed
                        }
                        break;
                    }
                    current = current.parent;
                }
            }

            return getVariableSymbolAtPosition(root, position);
        }
    }

    return null;
}

/**
 * Check if a node's variable reference is shadowed by an inner loop within the target loop scope.
 * This is used to exclude references that are shadowed by nested loops from rename operations.
 */
export function isShadowedByInnerLoop(node: SyntaxNode, varName: string, targetLoopNode: SyntaxNode): boolean {
    // Find the containing loop for this reference
    const containingLoop = findContainingLoop(node);
    if (!containingLoop) {
        return false;
    }

    // If the containing loop is the target loop, it's not shadowed
    if (isSameNode(containingLoop, targetLoopNode)) {
        return false;
    }

    // Check if the containing loop is nested within the target loop
    // and if it declares a variable with the same name
    let current: SyntaxNode | null = containingLoop;
    while (current) {
        if (isSameNode(current, targetLoopNode)) {
            // We're inside the target loop, check if the immediate containing loop shadows the variable
            if (isLoopVariable(containingLoop, varName)) {
                return true; // Shadowed by inner loop
            }
            return false;
        }
        current = current.parent;
    }

    // Not inside the target loop at all
    return false;
}

/**
 * Check if a variable_ref node is part of a declaration context.
 * This includes FOR_EACH loop variables, PHP_EACH loop variables, etc.
 */
export function isVariableRefInDeclarationContext(varRefNode: SyntaxNode): boolean {
    // Check if parent is a FOR_EACH with this as the var field
    const parent = varRefNode.parent;
    if (!parent) {
        return false;
    }

    // For FOR_EACH, the var field is a value node that contains the variable_ref
    // So we need to check the grandparent
    const grandparent = parent.parent;
    if (
        grandparent &&
        (grandparent.type === SyntaxType.ActionForEach || grandparent.type === SyntaxType.PatchForEach)
    ) {
        const varField = grandparent.childForFieldName("var");
        // Check if the var field (value node) contains this variable_ref
        if (varField && varField === parent) {
            return true;
        }
    }

    if (parent.type === SyntaxType.ActionPhpEach || parent.type === SyntaxType.PatchPhpEach) {
        const keyVarField = parent.childForFieldName("key_var");
        const valueVarField = parent.childForFieldName("value_var");
        if (
            (keyVarField && isSameNode(keyVarField, varRefNode)) ||
            (valueVarField && isSameNode(valueVarField, varRefNode))
        ) {
            return true;
        }
    }

    return false;
}

/**
 * Check if a symbol can be renamed.
 */
export function isRenameableSymbol(symbolInfo: SymbolInfo): boolean {
    // Reject automatic variables
    if (AUTOMATIC_VARIABLES.has(symbolInfo.name)) {
        return false;
    }

    return true;
}
