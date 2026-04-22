/**
 * Function and macro call/definition detection for TP2 completion context.
 * Handles LAF/LPF/LAM/LPM calls, DEFINE_*_FUNCTION definitions,
 * parameter name/value position detection, and enriched FuncParamsContext storage.
 */

import type { Node as SyntaxNode } from "web-tree-sitter";
import { SyntaxType } from "../../tree-sitter.d";
import { stripStringDelimiters } from "../../tree-utils";
import { ParamSection, CompletionContext, type FuncParamsContext } from "../types";
import { findBeginEndBoundaries } from "./position";

// ============================================
// Enriched Context Storage
// ============================================

/**
 * Module-level storage for enriched function params context.
 * Set by detectFunctionCallContext when cursor is in funcParams context.
 * Retrieved by getFuncParamsContext() for parameter completion.
 *
 * Request-scoped memoisation: safe as module state because LSP callbacks are
 * sequential — a new completion request always overwrites this before it reads it.
 */
let lastFuncParamsContext: FuncParamsContext | null = null;

/**
 * Get the enriched function params context from the last completion request.
 * Returns null if context is not funcParams or if function info cannot be determined.
 */
export function getFuncParamsContext(): FuncParamsContext | null {
    return lastFuncParamsContext;
}

// ============================================
// Keyword Search
// ============================================

/**
 * Result of searching for section keyword nodes (INT_VAR, STR_VAR, RET, RET_ARRAY)
 * in a function call tree. Returns the last section keyword found before the cursor.
 */
interface KeywordSearchResult {
    sectionNode: SyntaxNode | null;
    sectionType: ParamSection | null;
    keywordPosition: number;
}

/**
 * Find the ancestor node of a given type for a keyword node.
 * Walks up the tree from the keyword's parent until it finds the expected ancestor type,
 * stopping at the boundary node to prevent escaping the function call.
 */
function findSectionAncestor(
    keywordNode: SyntaxNode,
    ancestorType: string,
    boundaryNode: SyntaxNode,
    fallbackType?: string
): SyntaxNode | null {
    let ancestor: SyntaxNode | null = keywordNode.parent;
    while (ancestor && ancestor !== boundaryNode && ancestor.type !== ancestorType) {
        ancestor = ancestor.parent;
    }
    if (ancestor && ancestor !== boundaryNode) {
        return ancestor;
    }
    // Fallback: try a different ancestor type (e.g., int_var_call when STR_VAR is misparsed inside it)
    if (fallbackType) {
        ancestor = keywordNode.parent;
        while (ancestor && ancestor !== boundaryNode && ancestor.type !== fallbackType) {
            ancestor = ancestor.parent;
        }
        if (ancestor && ancestor !== boundaryNode) {
            return ancestor;
        }
    }
    return null;
}

/**
 * Recursively search for section keyword nodes (INT_VAR, STR_VAR, RET, RET_ARRAY)
 * in a function call tree. Returns the last keyword found before the cursor.
 *
 * With incomplete/erroneous code, tree-sitter may parse keywords as identifiers nested inside
 * value nodes. We look for keyword text matching section names in any node type,
 * then find the appropriate ancestor to extract params from.
 */
function findKeywordNodes(funcCallNode: SyntaxNode, cursorOffset: number): KeywordSearchResult {
    return searchKeywordNodes(funcCallNode, cursorOffset, funcCallNode, {
        sectionNode: null, sectionType: null, keywordPosition: -1,
    });
}

/**
 * Recursive search for section keywords, threading accumulated result through return values
 * instead of mutating an outer variable.
 */
function searchKeywordNodes(
    searchNode: SyntaxNode,
    cursorOffset: number,
    funcCallNode: SyntaxNode,
    acc: KeywordSearchResult,
): KeywordSearchResult {
    let result = acc;

    // Check if this node looks like a keyword before the cursor
    if (searchNode.startIndex < cursorOffset) {
        const text = searchNode.text;
        const isKeywordText = text === "INT_VAR" || text === "STR_VAR" || text === "RET" || text === "RET_ARRAY";

        if (isKeywordText) {
            if (text === "INT_VAR") {
                result = {
                    sectionType: ParamSection.IntVar,
                    keywordPosition: searchNode.endIndex,
                    sectionNode: findSectionAncestor(searchNode, SyntaxType.IntVarCall, funcCallNode)
                        ?? acc.sectionNode,
                };
            } else if (text === "STR_VAR") {
                // Bug fix: With error recovery, STR_VAR might not have a str_var_call ancestor yet.
                // Fall back to int_var_call (which erroneously contains it).
                result = {
                    sectionType: ParamSection.StrVar,
                    keywordPosition: searchNode.endIndex,
                    sectionNode: findSectionAncestor(
                        searchNode, SyntaxType.StrVarCall, funcCallNode, SyntaxType.IntVarCall
                    ) ?? acc.sectionNode,
                };
            } else if (text === "RET") {
                result = {
                    sectionType: ParamSection.Ret,
                    keywordPosition: searchNode.endIndex,
                    sectionNode: findSectionAncestor(searchNode, SyntaxType.RetCall, funcCallNode)
                        ?? acc.sectionNode,
                };
            } else {
                result = {
                    sectionType: ParamSection.RetArray,
                    keywordPosition: searchNode.endIndex,
                    sectionNode: findSectionAncestor(searchNode, SyntaxType.RetArrayCall, funcCallNode)
                        ?? acc.sectionNode,
                };
            }
        }
    }

    // Recurse to children, threading result through each
    for (const child of searchNode.children) {
        result = searchKeywordNodes(child, cursorOffset, funcCallNode, result);
    }

    return result;
}

/**
 * Extract enriched context from a function call node (LAF/LPF).
 * Determines parameter section, used params, and function name.
 * Stores result in module-level lastFuncParamsContext.
 */
function extractFuncParamsContext(node: SyntaxNode, cursorOffset: number): void {
    // Clear previous context
    lastFuncParamsContext = null;

    // Get function name from "name" field
    const nameNode = node.childForFieldName("name");
    if (!nameNode) {
        return;
    }

    // Strip WeiDU string delimiters (tildes, quotes, percent signs)
    const functionName = stripStringDelimiters(nameNode.text);

    // Find the last section keyword that starts before the cursor
    // Bug fix: With incomplete code (e.g., "bonus =" without value), tree-sitter error recovery
    // can extend INT_VAR section node bounds past STR_VAR, merging both into one int_var_call node.
    // Instead of using node bounds, we recursively search for actual keyword nodes ("INT_VAR",
    // "STR_VAR", etc.) and track the last one before cursor, which correctly identifies the current section.
    const { sectionType, sectionNode, keywordPosition } = findKeywordNodes(node, cursorOffset);

    if (sectionType !== null && sectionNode !== null) {
        // Extract params, filtering by keyword position if needed
        // Bug fix: When STR_VAR is inside int_var_call (error recovery), we need to extract
        // only params that appear after the STR_VAR keyword position
        const usedParams = extractUsedParamsAfter(sectionNode, keywordPosition);
        lastFuncParamsContext = {
            functionName,
            paramSection: sectionType,
            usedParams,
        };
    }
}

/**
 * Extract parameter names that appear after a given position in a section node.
 * Used when keywords are misparsed due to error recovery.
 */
function extractUsedParamsAfter(sectionNode: SyntaxNode, afterPosition: number): string[] {
    const params: string[] = [];

    for (const child of sectionNode.children) {
        // Only consider children that start after the keyword position
        if (child.startIndex <= afterPosition) {
            continue;
        }

        const type = child.type;

        // INT_VAR/STR_VAR have call_item children
        if (type === SyntaxType.IntVarCallItem || type === SyntaxType.StrVarCallItem) {
            const firstChild = child.children[0];
            if (firstChild && (firstChild.type === SyntaxType.Identifier || firstChild.type === SyntaxType.String)) {
                params.push(firstChild.text);
            }
        }
        // RET/RET_ARRAY have direct identifier children
        else if (type === SyntaxType.Identifier) {
            params.push(child.text);
        }
        // Also check for RET_CALL_ITEM and RET_ARRAY_CALL_ITEM
        else if (type === SyntaxType.RetCallItem || type === SyntaxType.RetArrayCallItem) {
            const firstChild = child.children[0];
            if (firstChild && firstChild.type === SyntaxType.Identifier) {
                params.push(firstChild.text);
            }
        }
    }

    return params;
}

/**
 * Recursively search for the "=" token in a node tree.
 * Returns the byte offset of the "=" token, or -1 if not found.
 */
function findEqualsPosition(node: SyntaxNode): number {
    if (node.text === "=" && node.type === "=") {
        return node.startIndex;
    }
    for (const child of node.children) {
        const pos = findEqualsPosition(child);
        if (pos >= 0) return pos;
    }
    return -1;
}

/**
 * Determine if cursor is in parameter name or value position within a call_item.
 * Returns "funcParamName" if left of = or no =, "funcParamValue" if right of =.
 *
 * Logic:
 * 1. If no = in call_item -> funcParamName (implicit parameter)
 * 2. If cursor is left of = -> funcParamName (typing parameter name)
 * 3. If cursor is right of = -> funcParamValue (typing value)
 * 4. If uncertain, prefer funcParamName
 */
function detectParamNameOrValue(node: SyntaxNode, cursorOffset: number): CompletionContext {
    // Look for = token in the node and its children
    const equalsPosition = findEqualsPosition(node);

    // No = found -> funcParamName (implicit parameter)
    if (equalsPosition < 0) {
        return CompletionContext.FuncParamName;
    }

    // Cursor is left of or at = -> funcParamName
    if (cursorOffset <= equalsPosition) {
        return CompletionContext.FuncParamName;
    }

    // Cursor is right of = -> funcParamValue
    return CompletionContext.FuncParamValue;
}

/**
 * Find the call_item or parameter declaration node that contains the cursor.
 * Returns the node if found, null otherwise.
 *
 * Handles both function calls (call_item nodes) and function definitions (decl nodes).
 *
 * Boundary handling: Cursor AT the endIndex (right after the last character) is considered
 * inside the node ONLY if the next character is NOT whitespace. This allows:
 * - "= s|" (next char is newline/space) -> inside node (still typing value)
 * - "= 5| " (next char is space, cursor in whitespace) -> NOT inside (starting new param)
 * - "= 5|\n" (next char is newline, cursor at EOL) -> NOT inside (starting new param)
 */
function findCallItemAtCursor(funcCallNode: SyntaxNode, cursorOffset: number): SyntaxNode | null {
    // Search through all descendants for call_item or decl nodes
    function search(node: SyntaxNode): SyntaxNode | null {
        const type = node.type;

        // Check if this is a call_item or decl type
        const isParamNode = type === SyntaxType.IntVarCallItem || type === SyntaxType.StrVarCallItem ||
            type === SyntaxType.RetCallItem || type === SyntaxType.RetArrayCallItem ||
            type === SyntaxType.IntVarDecl || type === SyntaxType.StrVarDecl ||
            type === SyntaxType.RetDecl || type === SyntaxType.RetArrayDecl;

        if (isParamNode) {
            // Check if cursor is within this node (inclusive of endIndex boundary)
            // At endIndex, cursor is right after the last char - still in value context
            if (cursorOffset >= node.startIndex && cursorOffset <= node.endIndex) {
                return node;
            }
            // Param nodes that don't contain the cursor can't have relevant children
            return null;
        }

        // Recurse to children
        for (const child of node.children) {
            const result = search(child);
            if (result) return result;
        }

        return null;
    }

    return search(funcCallNode);
}

/**
 * Check if cursor is at function call name position (LAF/LPF).
 * Returns context array if detected, null otherwise.
 */
export function detectFunctionCallContext(node: SyntaxNode, cursorOffset: number): CompletionContext[] | null {
    const type = node.type;

    // Action function call (LAF)
    if (type === SyntaxType.ActionLaunchFunction) {
        if (isAtFunctionName(cursorOffset, node)) {
            return [CompletionContext.LafName];
        }
        // After function name -> check for funcParamName vs funcParamValue
        extractFuncParamsContext(node, cursorOffset);

        const callItem = findCallItemAtCursor(node, cursorOffset);
        if (callItem) {
            return [detectParamNameOrValue(callItem, cursorOffset)];
        }

        return [CompletionContext.FuncParamName];
    }

    // Action macro call (LAM)
    if (type === SyntaxType.ActionLaunchMacro) {
        if (isAtMacroName(cursorOffset, node)) {
            return [CompletionContext.LamName];
        }
        // LAM has no parameters beyond the macro name
        return null;
    }

    // Patch macro call (LPM)
    if (type === SyntaxType.PatchLaunchMacro) {
        if (isAtMacroName(cursorOffset, node)) {
            return [CompletionContext.LpmName];
        }
        // LPM has no parameters beyond the macro name
        return null;
    }

    // Patch function call (LPF)
    if (type === SyntaxType.PatchLaunchFunction) {
        if (isAtFunctionName(cursorOffset, node)) {
            return [CompletionContext.LpfName];
        }
        // After function name -> check for funcParamName vs funcParamValue
        // LPF is valid inside patches blocks
        // Extract enriched context for parameter completion
        extractFuncParamsContext(node, cursorOffset);

        // Check if cursor is in a call_item to determine name vs value context
        const callItem = findCallItemAtCursor(node, cursorOffset);
        if (callItem) {
            return [detectParamNameOrValue(callItem, cursorOffset)];
        }

        // Not in a call_item yet -> funcParamName (typing new parameter)
        return [CompletionContext.FuncParamName];
    }

    return null;
}

/**
 * Check if cursor is inside a function definition (DEFINE_*_FUNCTION).
 * Returns context array if detected, null otherwise.
 */
export function detectFunctionDefContext(node: SyntaxNode, cursorOffset: number): CompletionContext[] | null {
    const type = node.type;

    // Function/macro definitions: detect param context only
    if (type === SyntaxType.ActionDefinePatchFunction || type === SyntaxType.ActionDefinePatchMacro ||
        type === SyntaxType.ActionDefineFunction || type === SyntaxType.ActionDefineMacro) {
        return detectFunctionDefinitionContext(node, cursorOffset);
    }

    return null;
}

/**
 * Detect context inside a function definition (action or patch).
 * Only detects funcParam contexts (parameter declarations between name and BEGIN).
 * Function body returns null (no filtering).
 *
 * @param node Function definition node
 * @param cursorOffset Byte offset of cursor
 * @returns Context array if cursor is in param position, null otherwise
 */
function detectFunctionDefinitionContext(
    node: SyntaxNode,
    cursorOffset: number,
): CompletionContext[] | null {
    const boundaries = findBeginEndBoundaries(node, true);
    const { beginEnd, functionNameEnd } = boundaries;

    // If cursor is AFTER function name but BEFORE BEGIN -> funcParamName/funcParamValue context
    if (functionNameEnd && functionNameEnd > 0 && cursorOffset > functionNameEnd && (beginEnd < 0 || cursorOffset < beginEnd)) {
        const callItem = findCallItemAtCursor(node, cursorOffset);
        if (callItem) {
            return [detectParamNameOrValue(callItem, cursorOffset)];
        }
        return [CompletionContext.FuncParamName];
    }

    // Function body or header: no filtering needed
    return null;
}

/**
 * Check if cursor is at the function name position in a function call.
 * Uses positional heuristics for incomplete code where identifier may not exist.
 */
function isAtFunctionName(cursorOffset: number, funcCall: SyntaxNode): boolean {
    let keywordEnd = -1;
    let firstArgStart = -1;

    for (const child of funcCall.children) {
        const text = child.text.toUpperCase();

        // Track keyword position (LAF, LPF, LAUNCH_ACTION_FUNCTION, LAUNCH_PATCH_FUNCTION)
        if (text === "LAF" || text === "LPF" || text === "LAUNCH_ACTION_FUNCTION" || text === "LAUNCH_PATCH_FUNCTION") {
            keywordEnd = child.endIndex;
            continue;
        }

        // If cursor is within an identifier (the function name), return true
        if (child.type === SyntaxType.Identifier) {
            if (cursorOffset >= child.startIndex && cursorOffset <= child.endIndex) {
                return true;
            }
            // Past the identifier - not at function name position
            if (cursorOffset > child.endIndex) {
                return false;
            }
        }

        // Track first argument keyword (INT_VAR, STR_VAR, RET, END)
        if (text === "INT_VAR" || text === "STR_VAR" || text === "RET" || text === "RET_ARRAY" || text === "END") {
            if (firstArgStart < 0) {
                firstArgStart = child.startIndex;
            }
        }
    }

    // Positional heuristic: cursor is after keyword but before any arguments
    if (keywordEnd > 0 && cursorOffset > keywordEnd) {
        if (firstArgStart < 0 || cursorOffset < firstArgStart) {
            return true;
        }
    }

    return false;
}

/**
 * Check if cursor is at the macro name position in a macro call (LAM/LPM).
 * Macros have simpler syntax than functions: just keyword + name, no parameters.
 */
function isAtMacroName(cursorOffset: number, macroCall: SyntaxNode): boolean {
    let keywordEnd = -1;

    for (const child of macroCall.children) {
        const text = child.text.toUpperCase();

        // Track keyword position (LAM, LPM, LAUNCH_ACTION_MACRO, LAUNCH_PATCH_MACRO)
        if (text === "LAM" || text === "LPM" || text === "LAUNCH_ACTION_MACRO" || text === "LAUNCH_PATCH_MACRO") {
            keywordEnd = child.endIndex;
            continue;
        }

        // If cursor is within an identifier (the macro name), return true
        if (child.type === SyntaxType.Identifier || child.type === SyntaxType.String) {
            if (cursorOffset >= child.startIndex && cursorOffset <= child.endIndex) {
                return true;
            }
            // Past the identifier — not at macro name position
            if (cursorOffset > child.endIndex) {
                return false;
            }
        }
    }

    // Positional heuristic: cursor is after keyword (typing macro name)
    if (keywordEnd > 0 && cursorOffset > keywordEnd) {
        return true;
    }

    return false;
}
