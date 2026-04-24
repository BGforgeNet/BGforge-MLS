/**
 * Shared utilities for WeiDU TP2 variable symbol handling.
 * Used by both rename and go-to-definition features.
 */

import { Location, Position } from "vscode-languageserver/node";
import type { Node as SyntaxNode } from "web-tree-sitter";
import { makeRange } from "../core/position-utils";
import { parseWithCache, isInitialized } from "./parser";
import { ScopeKind, type ScopeKind as ScopeKindValue } from "./scope-kinds";
import { SyntaxType } from "./tree-sitter.d";
import {
    findIdentifier,
    findNodeAtPosition,
    findAncestorOfType,
    isSameNode,
    stripStringDelimiters,
    unwrapVariableRef,
} from "./tree-utils";
import type { Symbols } from "../core/symbol-index";

// ============================================
// Constants
// ============================================

/** Node types for variable assignments. */
export const VARIABLE_DECL_TYPES: ReadonlySet<SyntaxType> = new Set([
    SyntaxType.ActionOuterSet,
    SyntaxType.ActionOuterTextSprint,
    SyntaxType.ActionOuterSprint,
    SyntaxType.PatchSet,
    SyntaxType.PatchTextSprint,
    SyntaxType.PatchSprint,
    SyntaxType.PatchSprintf,
    SyntaxType.PatchAssignment,
    SyntaxType.IntVarDecl,
    SyntaxType.StrVarDecl,
    SyntaxType.RetDecl,
    SyntaxType.RetArrayDecl,
    // READ_* patches
    SyntaxType.PatchReadLong,
    SyntaxType.PatchReadShort,
    SyntaxType.PatchReadByte,
    SyntaxType.PatchReadAscii,
    SyntaxType.PatchReadStrref,
    SyntaxType.PatchRead_2daEntry,
    SyntaxType.PatchRead_2daEntryFormer,
    SyntaxType.PatchRead_2daEntriesNow,
    // Array definitions
    SyntaxType.ActionDefineArray,
    SyntaxType.ActionDefineAssociativeArray,
    SyntaxType.PatchDefineArray,
    SyntaxType.PatchDefineAssociativeArray,
    // Loop variables
    SyntaxType.ActionPhpEach,
    SyntaxType.PatchPhpEach,
    SyntaxType.ActionForEach,
    SyntaxType.PatchForEach,
]);

/** Node types for function parameter declarations (INT_VAR, STR_VAR, RET, RET_ARRAY). */
export const PARAM_DECL_TYPES: ReadonlySet<SyntaxType> = new Set([
    SyntaxType.IntVarDecl,
    SyntaxType.StrVarDecl,
    SyntaxType.RetDecl,
    SyntaxType.RetArrayDecl,
]);

/** Node types for string content that may contain %var% references. */
export const STRING_CONTENT_TYPES: ReadonlySet<SyntaxType> = new Set([
    SyntaxType.TildeContent,
    SyntaxType.DoubleContent,
    SyntaxType.FiveTildeContent,
]);

/** Node types for function/macro definitions. */
export const FUNCTION_DEF_TYPES: ReadonlySet<SyntaxType> = new Set([
    SyntaxType.ActionDefineFunction,
    SyntaxType.ActionDefinePatchFunction,
    SyntaxType.ActionDefineMacro,
    SyntaxType.ActionDefinePatchMacro,
]);

/** Node types for loops that introduce scoped variables. */
export const LOOP_TYPES: ReadonlySet<SyntaxType> = new Set([
    SyntaxType.ActionPhpEach,
    SyntaxType.PatchPhpEach,
    SyntaxType.ActionForEach,
    SyntaxType.PatchForEach,
]);

interface VariableScopeInfo {
    scope: ScopeKindValue;
    loopNode?: SyntaxNode;
    functionNode?: SyntaxNode;
}

interface VariableSymbolInfo extends VariableScopeInfo {
    name: string;
    kind: "variable";
    node: SyntaxNode;
}

// ============================================
// Scope utilities
// ============================================

/**
 * Find the function definition containing the given node.
 */
export function findContainingFunction(node: SyntaxNode): SyntaxNode | null {
    return findAncestorOfType(node, FUNCTION_DEF_TYPES);
}

/**
 * Find the loop containing the given node.
 */
export function findContainingLoop(node: SyntaxNode): SyntaxNode | null {
    return findAncestorOfType(node, LOOP_TYPES);
}

/**
 * Determine the scope for a variable reference.
 * Checks if the variable is a loop variable, function-local variable, or file-scoped variable.
 */
function determineVariableScope(varName: string, node: SyntaxNode): VariableScopeInfo {
    // Check if we're inside a loop and the variable is a loop variable
    const loopNode = findContainingLoop(node);
    if (loopNode) {
        // Check if this variable is declared by the loop
        const isLoopVar = isLoopVariable(loopNode, varName);
        if (isLoopVar) {
            return { scope: ScopeKind.Loop, loopNode };
        }
    }

    // Check if we're inside a function
    const functionNode = findContainingFunction(node);
    if (functionNode) {
        return { scope: ScopeKind.Function, functionNode };
    }

    return { scope: ScopeKind.File };
}

/**
 * Check if a variable name is declared by a loop (as a key_var, value_var, or var).
 */
export function isLoopVariable(loopNode: SyntaxNode, varName: string): boolean {
    const keyVarNode = loopNode.childForFieldName("key_var");
    const valueVarNode = loopNode.childForFieldName("value_var");
    const forEachVarNode = loopNode.childForFieldName("var");

    // Check each loop variable field for a match
    for (const fieldNode of [keyVarNode, valueVarNode, forEachVarNode]) {
        if (!fieldNode) continue;
        const identNode = unwrapVariableRef(fieldNode);
        if (identNode.type === SyntaxType.Identifier && matchesSymbol(identNode.text, varName)) {
            return true;
        }
    }

    return false;
}

/**
 * Collect all loop variable names from a PHP_EACH or FOR_EACH node.
 * PHP_EACH: key_var and value_var fields (direct identifiers).
 * FOR_EACH: var field (value > simple_value > variable_ref > identifier chain).
 */
export function collectLoopVarNames(loopNode: SyntaxNode): ReadonlySet<string> {
    const names = new Set<string>();

    for (const fieldName of ["key_var", "value_var", "var"]) {
        const fieldNode = loopNode.childForFieldName(fieldName);
        if (!fieldNode) {
            continue;
        }
        const identNode = findIdentifier(fieldNode);
        if (identNode) {
            names.add(identNode.text);
        }
    }

    return names;
}

/**
 * Find a variable reference (%var%) at the given position within string content.
 * Returns the variable name (without %) if found at the position.
 */
function findVariableInStringContent(node: SyntaxNode, position: Position): string | null {
    const text = node.text;

    // Convert cursor position to byte offset within the node's text
    const cursorOffset = positionToByteOffset(text, position, node.startPosition);
    if (cursorOffset < 0 || cursorOffset > text.length) {
        return null;
    }

    // Find all %var% patterns in the text
    const varPattern = /%([a-zA-Z_][a-zA-Z0-9_]*)%/g;
    let match: RegExpExecArray | null;

    while ((match = varPattern.exec(text)) !== null) {
        const matchStart = match.index;
        const matchEnd = match.index + match[0].length;

        // Check if the cursor is within this %var% pattern
        if (cursorOffset >= matchStart && cursorOffset <= matchEnd) {
            return match[1] ?? null; // Return the variable name without %
        }
    }

    return null;
}

/**
 * Convert a Position to a byte offset within text, given the text's base position.
 * Handles multiline strings correctly. Returns -1 if position is before base.
 */
function positionToByteOffset(text: string, position: Position, basePosition: { row: number; column: number }): number {
    // If cursor is before the node, return -1
    if (position.line < basePosition.row) {
        return -1;
    }
    if (position.line === basePosition.row && position.character < basePosition.column) {
        return -1;
    }

    let offset = 0;
    let currentLine = basePosition.row;
    let currentCol = basePosition.column;

    // Traverse the text to find the offset
    for (let i = 0; i < text.length; i++) {
        // Check if we've reached the target position
        if (currentLine === position.line && currentCol === position.character) {
            return offset;
        }

        // Advance to next character
        if (text[i] === "\n") {
            currentLine++;
            currentCol = 0;
        } else {
            currentCol++;
        }
        offset++;
    }

    // Check if position is at the very end
    if (currentLine === position.line && currentCol === position.character) {
        return offset;
    }

    // Position is beyond the text
    return -1;
}

/**
 * Check if two symbol names match (case-sensitive).
 */
export function matchesSymbol(name1: string, name2: string): boolean {
    return name1 === name2;
}

// ============================================
// Variable definition finding
// ============================================

/**
 * Find the definition location of a variable at the given position.
 * Returns null if no variable is found at the position or if the variable has no definition.
 *
 * Lookup order for file-scoped variables:
 * 1. Header definition (from workspace index) - authoritative for OUTER_SET/OUTER_SPRINT/OUTER_TEXT_SPRINT
 * 2. Local declaration (first declaration in current file)
 *
 * Loop/function-scoped variables always use local definitions only.
 */
export function findVariableDefinition(
    text: string,
    uri: string,
    position: Position,
    symbols?: Symbols,
): Location | null {
    if (!isInitialized()) {
        return null;
    }

    const tree = parseWithCache(text);
    if (!tree) {
        return null;
    }

    const symbolInfo = getVariableSymbolAtPosition(tree.rootNode, position);
    if (!symbolInfo) {
        return null;
    }

    // For file-scope variables, check unified symbol storage first (header definition is authoritative)
    if (symbolInfo.scope === ScopeKind.File) {
        const location = symbols?.lookupDefinition(symbolInfo.name);
        if (location) {
            return location;
        }
    }

    const defNode = findVariableDefinitionNode(tree.rootNode, symbolInfo);
    if (!defNode) {
        return null;
    }

    return {
        uri,
        range: makeRange(defNode),
    };
}

/**
 * Get variable symbol info at the given position.
 */
export function getVariableSymbolAtPosition(root: SyntaxNode, position: Position): VariableSymbolInfo | null {
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

    // Check if it's a percent_string or percent_content node inside %var% syntax
    if (node.type === SyntaxType.PercentString) {
        // Grammar: percent_string = "%" content "%", child(1) is the content
        // Note: grammar doesn't expose named fields, so index-based access is required
        const contentNode = node.child(1);
        if (contentNode && contentNode.type === SyntaxType.PercentContent) {
            const name = contentNode.text;
            if (!name) {
                return null;
            }
            return {
                name,
                kind: "variable",
                ...determineVariableScope(name, node),
                node,
            };
        }
    }

    if (node.type === SyntaxType.PercentContent) {
        const name = node.text;
        if (!name) {
            return null;
        }
        return {
            name,
            kind: "variable",
            ...determineVariableScope(name, node),
            node: node.parent && node.parent.type === SyntaxType.PercentString ? node.parent : node,
        };
    }

    // String content nodes can contain %var% variable references
    if (STRING_CONTENT_TYPES.has(node.type as SyntaxType)) {
        const name = findVariableInStringContent(node, position);
        if (name) {
            return {
                name,
                kind: "variable",
                ...determineVariableScope(name, node),
                node,
            };
        }
    }

    // Check if it's a variable_ref node (bare identifier in expression)
    if (node.type === SyntaxType.VariableRef) {
        // Grammar: variable_ref = identifier, child(0) is the identifier
        // Note: grammar doesn't expose named fields, so index-based access is required
        const identNode = node.child(0);
        const name = identNode?.text;
        if (!name) {
            return null;
        }
        return {
            name,
            kind: "variable",
            ...determineVariableScope(name, node),
            node: identNode,
        };
    }

    // Check if it's an identifier
    if (node.type === SyntaxType.Identifier) {
        // Could be a variable name in declaration or usage
        const name = node.text;
        return {
            name,
            kind: "variable",
            ...determineVariableScope(name, node),
            node,
        };
    }

    return null;
}

/**
 * Find the first declaration of a variable in the given scope.
 */
export function findVariableDefinitionNode(root: SyntaxNode, symbolInfo: VariableSymbolInfo): SyntaxNode | null {
    let searchScope: SyntaxNode = root;
    if (symbolInfo.scope === ScopeKind.Loop && symbolInfo.loopNode) {
        searchScope = symbolInfo.loopNode;
    } else if (symbolInfo.scope === ScopeKind.Function && symbolInfo.functionNode) {
        searchScope = symbolInfo.functionNode;
    }

    return findFirstDeclaration(searchScope, symbolInfo.name, symbolInfo);
}

function findFirstDeclaration(scopeNode: SyntaxNode, varName: string, scopeInfo: VariableScopeInfo): SyntaxNode | null {
    let firstDecl: SyntaxNode | null = null;

    function visit(node: SyntaxNode): void {
        // Stop searching if we already found a declaration
        if (firstDecl) {
            return;
        }

        // Check if this node is a variable declaration
        if (VARIABLE_DECL_TYPES.has(node.type as SyntaxType)) {
            // For loop variables, check if this is the target loop
            if (LOOP_TYPES.has(node.type as SyntaxType)) {
                const isTargetLoop = !scopeInfo.loopNode || isSameNode(scopeInfo.loopNode, node);
                if (isTargetLoop) {
                    // Check loop variable declarations
                    const keyVarNode = node.childForFieldName("key_var");
                    const valueVarNode = node.childForFieldName("value_var");
                    const forEachVarNode = node.childForFieldName("var");

                    for (const fieldNode of [keyVarNode, valueVarNode, forEachVarNode]) {
                        if (!fieldNode) continue;
                        const identNode = unwrapVariableRef(fieldNode);
                        if (identNode.type === SyntaxType.Identifier && matchesSymbol(identNode.text, varName)) {
                            firstDecl = identNode;
                            return;
                        }
                    }
                }
                // Only skip loop body traversal if searching for loop-scoped variables.
                // For file/function-scoped variables, we need to find declarations inside loops.
                if (scopeInfo.scope === ScopeKind.Loop) {
                    return;
                }
            }

            // For SET/TEXT_SPRINT statements, field is "var"
            const varNode = node.childForFieldName("var");
            if (varNode && matchesSymbol(stripStringDelimiters(varNode.text), varName)) {
                firstDecl = varNode;
                return;
            }

            // For READ_* patches, field is "varNodes" (array of var targets)
            const varNodes = node.childrenForFieldName("var");
            for (const vn of varNodes) {
                if (vn.type === SyntaxType.Identifier && matchesSymbol(vn.text, varName)) {
                    firstDecl = vn;
                    return;
                }
            }

            // For DEFINE_ARRAY etc., field is "name"
            const nameNode = node.childForFieldName("name");
            if (nameNode) {
                const exprNode = nameNode.child(0);
                if (exprNode) {
                    const identNode = unwrapVariableRef(exprNode);
                    if (identNode.type === SyntaxType.Identifier && matchesSymbol(identNode.text, varName)) {
                        firstDecl = identNode;
                        return;
                    }
                }
            }

            // For parameter declarations (INT_VAR, STR_VAR, RET, RET_ARRAY)
            if (
                node.type === SyntaxType.IntVarDecl ||
                node.type === SyntaxType.StrVarDecl ||
                node.type === SyntaxType.RetDecl ||
                node.type === SyntaxType.RetArrayDecl
            ) {
                for (const child of node.children) {
                    if (child.type === SyntaxType.Identifier && matchesSymbol(child.text, varName)) {
                        firstDecl = child;
                        return;
                    }
                }
            }
        }

        // Recurse to children
        for (const child of node.children) {
            visit(child);
            // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition, @typescript-eslint/strict-boolean-expressions -- TS doesn't track mutations through the visit closure
            if (firstDecl) {
                return;
            }
        }
    }

    visit(scopeNode);
    return firstDecl;
}
