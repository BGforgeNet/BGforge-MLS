/**
 * Go to Definition for WeiDU TP2 files.
 * Handles:
 * - Variables (OUTER_SET, SET, INT_VAR, loop variables, etc.)
 * - Function/macro call to definition (LAF, LAM, LPF, LPM)
 * - INCLUDE directive to file
 */

import { Location, Position } from "vscode-languageserver/node";
import type { Node as SyntaxNode } from "web-tree-sitter";
import * as path from "path";
import * as fs from "fs";
import { parseWithCache, isInitialized } from "./parser";
import { pathToUri, uriToPath } from "../common";
import { SyntaxType } from "./tree-sitter.d";
import { FUNCTION_CALL_TYPES, getCallableSymbolAtPosition } from "./callable-symbols";
import { findLocalCallableDefinition } from "./callable-definitions";
import { findVariableDefinition } from "./variable-symbols";
import { findNodeAtPosition, findAncestorOfType, stripStringDelimiters } from "./tree-utils";
import type { Symbols } from "../core/symbol-index";

/** Node types for INCLUDE directives. */
const INCLUDE_TYPES = new Set([SyntaxType.ActionInclude]);

// ============================================
// Main entry point
// ============================================

/**
 * Get definition location for the symbol at the given position.
 */
export function getDefinition(text: string, uri: string, position: Position, symbols?: Symbols): Location | null {
    if (!isInitialized()) {
        return null;
    }

    const tree = parseWithCache(text);
    if (!tree) {
        return null;
    }

    // Find the node at cursor position
    const targetNode = findNodeAtPosition(tree.rootNode, position);
    if (!targetNode) {
        return null;
    }

    // Check if cursor is on a function call parameter name
    // If so, navigate to the function definition instead of treating it as a variable
    const callParamResult = tryFunctionCallParamDefinition(targetNode, text, uri, symbols);
    if (callParamResult) {
        return callParamResult;
    }

    // Check if cursor is on a variable, but not if we're on a function call param name
    // (even if the function isn't indexed - we shouldn't fall through to variable lookup)
    if (!isOnFunctionCallParamName(tree.rootNode, position)) {
        const varResult = findVariableDefinition(text, uri, position, symbols);
        if (varResult) {
            return varResult;
        }
    }

    // Check if cursor is on a function/macro call
    const callResult = tryFunctionCallDefinition(targetNode, text, uri, symbols);
    if (callResult) {
        return callResult;
    }

    // Check if cursor is on an INCLUDE path
    const includeResult = tryIncludeDefinition(targetNode, uri);
    if (includeResult) {
        return includeResult;
    }

    return null;
}

// ============================================
// Function/macro call handling
// ============================================

/**
 * Check if the node at cursor is a function call parameter name (left of = in a call item).
 * Returns true if cursor is on a parameter name, false otherwise.
 */
export function isOnFunctionCallParamName(root: SyntaxNode, position: Position): boolean {
    const node = findNodeAtPosition(root, position);
    if (!node) {
        return false;
    }

    // Check if we're inside a function call
    const callNode = findAncestorOfType(node, FUNCTION_CALL_TYPES);
    if (!callNode) {
        return false;
    }

    // Check if we're specifically inside a parameter item node (not the function name or other parts)
    // by walking up from the node to the call and looking for parameter item types
    let current: SyntaxNode | null = node;
    let isParamItem = false;

    while (current && current !== callNode) {
        if (
            current.type === SyntaxType.IntVarCallItem ||
            current.type === SyntaxType.StrVarCallItem ||
            current.type === SyntaxType.RetCallItem ||
            current.type === SyntaxType.RetArrayCallItem
        ) {
            isParamItem = true;
            break;
        }
        current = current.parent;
    }

    // Only return true if cursor is on the param name (first child of call item),
    // not on the value part. Grammar: call_item = name [= value]
    if (!isParamItem || !current) {
        return false;
    }
    const paramNameNode = current.children[0];
    if (!paramNameNode || node.startIndex < paramNameNode.startIndex || node.endIndex > paramNameNode.endIndex) {
        return false;
    }

    return true;
}

/**
 * Try to find definition for a function call parameter name.
 * When cursor is on a parameter name in a function call (e.g., `LAF my_func INT_VAR foo = 1 END`),
 * navigate to the function definition instead of treating it as a variable.
 */
function tryFunctionCallParamDefinition(
    node: SyntaxNode,
    text: string,
    uri: string,
    symbols?: Symbols,
): Location | null {
    // Reuse the guard to check if we're on a parameter name
    // Note: node.tree exists but isn't in the type definitions, so we walk up to root
    let root = node;
    while (root.parent) {
        root = root.parent;
    }

    // Extract position from node's start
    const position: Position = {
        line: node.startPosition.row,
        character: node.startPosition.column,
    };

    if (!isOnFunctionCallParamName(root, position)) {
        return null;
    }

    // Find the call node to get the function name
    const callNode = findAncestorOfType(node, FUNCTION_CALL_TYPES);
    if (!callNode) {
        return null;
    }

    // Get the function name from the call
    const nameNode = callNode.childForFieldName("name");
    if (!nameNode) {
        return null;
    }

    const funcName = nameNode.text;

    // Look for the function definition
    const localDef = findLocalCallableDefinition(text, uri, funcName);
    if (localDef) {
        return localDef.location;
    }

    // Then check the unified symbol storage
    const location = symbols?.lookupDefinition(funcName);
    if (location) {
        return location;
    }

    return null;
}

/**
 * Try to find definition for a function/macro call.
 */
function tryFunctionCallDefinition(node: SyntaxNode, text: string, uri: string, symbols?: Symbols): Location | null {
    let root = node;
    while (root.parent) {
        root = root.parent;
    }

    const position: Position = {
        line: node.startPosition.row,
        character: node.startPosition.column,
    };

    const callableSymbol = getCallableSymbolAtPosition(root, position);
    if (!callableSymbol) {
        return null;
    }

    // First, look in the current file
    const localDef = findLocalCallableDefinition(text, uri, callableSymbol.name);
    if (localDef) {
        return localDef.location;
    }

    // Then, look in the unified symbol storage
    const location = symbols?.lookupDefinition(callableSymbol.name);
    if (location) {
        return location;
    }

    return null;
}

// ============================================
// INCLUDE handling
// ============================================

/**
 * Try to find definition for an INCLUDE directive.
 */
function tryIncludeDefinition(node: SyntaxNode, uri: string): Location | null {
    // Check if we're in an INCLUDE context
    const includeNode = findAncestorOfType(node, INCLUDE_TYPES);
    if (!includeNode) {
        return null;
    }

    // Find the path string node
    const pathNode = findPathInInclude(includeNode);
    if (!pathNode) {
        return null;
    }

    // Get the include path (strip quotes/tildes)
    const includePath = stripStringDelimiters(pathNode.text);
    if (!includePath) {
        return null;
    }

    // Resolve the path relative to the current file
    const currentFilePath = uriToPath(uri);
    const currentDir = path.dirname(currentFilePath);
    const resolvedPath = path.resolve(currentDir, includePath);

    // Check if the file exists
    if (!fs.existsSync(resolvedPath)) {
        return null;
    }

    // Return location pointing to the start of the file
    return {
        uri: pathToUri(resolvedPath),
        range: {
            start: { line: 0, character: 0 },
            end: { line: 0, character: 0 },
        },
    };
}

/**
 * Find the path node in an INCLUDE directive.
 */
function findPathInInclude(node: SyntaxNode): SyntaxNode | null {
    // Use the "file" field if available
    const fileNode = node.childForFieldName("file");
    if (fileNode) {
        return fileNode;
    }
    // Fallback to finding any string child
    for (const child of node.children) {
        if (child.type === SyntaxType.String) {
            return child;
        }
    }
    return null;
}
