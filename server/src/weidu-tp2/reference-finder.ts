/**
 * Reference finding for WeiDU TP2 rename and references operations.
 * Locates all occurrences (definitions and usages) of a given symbol
 * within the appropriate scope (file, function, or loop).
 */

import type { Position } from "vscode-languageserver/node";
import type { Node as SyntaxNode } from "web-tree-sitter";
import { ScopeKind } from "./scope-kinds";
import { SyntaxType } from "./tree-sitter.d";
import {
    VARIABLE_DECL_TYPES,
    STRING_CONTENT_TYPES,
    FUNCTION_DEF_TYPES,
    LOOP_TYPES,
    matchesSymbol,
} from "./variable-symbols";
import { FUNCTION_CALL_TYPES } from "./callable-symbols";
import { isSameNode, stripStringDelimiters } from "./tree-utils";
import {
    type SymbolInfo,
    type SyntheticPercentVarNode,
    isShadowedByInnerLoop,
    isVariableRefInDeclarationContext,
} from "./symbol-discovery";

// ============================================
// Types
// ============================================

interface SymbolOccurrence {
    node: SyntaxNode;
    isDefinition: boolean;
}

// ============================================
// Reference finding
// ============================================

/**
 * Find all references to the given symbol, including whether each is a definition.
 */
export function findAllReferences(root: SyntaxNode, symbolInfo: SymbolInfo): SymbolOccurrence[] {
    const occurrences: SymbolOccurrence[] = [];

    if (symbolInfo.kind === "variable") {
        findVariableReferences(root, symbolInfo, occurrences);
    } else {
        // symbolInfo.kind === "function"
        findFunctionReferences(root, symbolInfo, occurrences);
    }

    // Deduplicate by position (same start/end = same occurrence)
    const seen = new Set<string>();
    return occurrences.filter((occ) => {
        const key = `${occ.node.startPosition.row}:${occ.node.startPosition.column}-${occ.node.endPosition.row}:${occ.node.endPosition.column}`;
        if (seen.has(key)) {
            return false;
        }
        seen.add(key);
        return true;
    });
}

/**
 * Find all references to a variable.
 */
function findVariableReferences(root: SyntaxNode, symbolInfo: SymbolInfo, occurrences: SymbolOccurrence[]): void {
    // Determine search scope: loop > function > file
    let searchScope: SyntaxNode = root;
    if (symbolInfo.scope === ScopeKind.Loop && symbolInfo.loopNode) {
        searchScope = symbolInfo.loopNode;
    } else if (symbolInfo.scope === ScopeKind.Function && symbolInfo.functionNode) {
        searchScope = symbolInfo.functionNode;
    }

    function visit(node: SyntaxNode): void {
        // Check percent_content nodes inside %var% syntax
        if (node.type === SyntaxType.PercentContent) {
            const name = node.text; // Already without the % delimiters
            if (name && matchesSymbol(name, symbolInfo.name)) {
                // For loop-scoped variables, check if this reference is shadowed by an inner loop
                if (symbolInfo.loopNode && isShadowedByInnerLoop(node, symbolInfo.name, symbolInfo.loopNode)) {
                    return; // Skip shadowed reference
                }
                // Push the parent percent_string node for proper range
                // This is always a reference, not a definition
                if (node.parent && node.parent.type === SyntaxType.PercentString) {
                    occurrences.push({ node: node.parent, isDefinition: false });
                }
            }
        }

        // Check string content nodes for %var% patterns
        if (STRING_CONTENT_TYPES.has(node.type as SyntaxType)) {
            const varRefs = findAllVariableReferencesInStringContent(node, symbolInfo.name);
            // These are always references, not definitions
            // For loop-scoped variables, filter out shadowed references
            const filteredRefs = symbolInfo.loopNode
                ? varRefs.filter((n) => !isShadowedByInnerLoop(n, symbolInfo.name, symbolInfo.loopNode!))
                : varRefs;
            occurrences.push(...filteredRefs.map((n) => ({ node: n, isDefinition: false })));
        }

        // Check variable_ref nodes (bare identifiers in expressions)
        if (node.type === SyntaxType.VariableRef) {
            const identNode = node.child(0);
            const name = identNode?.text;
            if (name && matchesSymbol(name, symbolInfo.name)) {
                // Check if this variable_ref is part of a declaration context
                // If so, skip it here - it will be handled by the declaration-specific code below
                const isPartOfDeclaration = isVariableRefInDeclarationContext(node);
                if (!isPartOfDeclaration) {
                    // For loop-scoped variables, check if this reference is shadowed by an inner loop
                    if (symbolInfo.loopNode && isShadowedByInnerLoop(node, symbolInfo.name, symbolInfo.loopNode)) {
                        return; // Skip shadowed reference
                    }
                    // Push the identifier node, not the variable_ref wrapper
                    // This is always a reference, not a definition
                    occurrences.push({ node: identNode, isDefinition: false });
                }
            }
        }

        // Workaround for grammar bug: FOR_EACH loops are sometimes parsed as patch_assignment
        // Grammar incorrectly parses "FOR_EACH item IN items" as two separate assignments:
        // "FOR_EACH = item" and "IN = items"
        if (node.type === SyntaxType.PatchAssignment) {
            // patch_assignment has structure: identifier = value
            const identNode = node.child(0);
            if (identNode && identNode.type === SyntaxType.Identifier) {
                const identText = identNode.text;
                if (identText === "FOR_EACH") {
                    // This is a FOR_EACH loop variable declaration
                    // The value field contains the loop variable
                    const valueNode = node.child(2); // child(0) = identifier, child(1) = =, child(2) = value
                    if (valueNode) {
                        let varNode: SyntaxNode | null = valueNode;
                        // value wraps variable_ref, which wraps identifier
                        if (varNode.type === SyntaxType.Value) {
                            varNode = varNode.child(0);
                        }
                        if (varNode && varNode.type === SyntaxType.VariableRef) {
                            varNode = varNode.child(0);
                        }
                        if (
                            varNode &&
                            varNode.type === SyntaxType.Identifier &&
                            matchesSymbol(varNode.text, symbolInfo.name)
                        ) {
                            // This is a definition
                            occurrences.push({ node: varNode, isDefinition: true });
                        }
                    }
                }
            }
        }

        // Check identifiers in variable declarations/assignments
        // Cast to SyntaxType because tree-sitter node.type is string
        if (VARIABLE_DECL_TYPES.has(node.type as SyntaxType)) {
            // For SET/TEXT_SPRINT statements, field is "var"
            // But skip loop types - they are handled separately below
            const isLoop = LOOP_TYPES.has(node.type as SyntaxType);
            if (!isLoop) {
                const varNode = node.childForFieldName("var");
                if (varNode && matchesSymbol(stripStringDelimiters(varNode.text), symbolInfo.name)) {
                    // This is a definition
                    occurrences.push({ node: varNode, isDefinition: true });
                }
            }

            // For READ_* patches, field is "varNodes" (array of var targets)
            // Tree-sitter exposes array fields via childrenForFieldName
            const varNodes = node.childrenForFieldName("var");
            for (const vn of varNodes) {
                if (vn.type === SyntaxType.Identifier && matchesSymbol(vn.text, symbolInfo.name)) {
                    // This is a definition
                    occurrences.push({ node: vn, isDefinition: true });
                }
            }

            // For DEFINE_ARRAY etc., field is "name"
            // The name field is a value/simple_value node, which wraps the actual expression
            const nameNode = node.childForFieldName("name");
            if (nameNode) {
                // The name field is value/simple_value, which is a wrapper. Get the actual expression child.
                // value node has one child: the actual expression (variable_ref, string, number, etc.)
                let exprNode = nameNode.child(0);

                // If it's a variable_ref, unwrap to get the identifier
                if (exprNode && exprNode.type === SyntaxType.VariableRef) {
                    exprNode = exprNode.child(0);
                }

                if (
                    exprNode &&
                    exprNode.type === SyntaxType.Identifier &&
                    matchesSymbol(exprNode.text, symbolInfo.name)
                ) {
                    // This is a definition - push the identifier node
                    occurrences.push({ node: exprNode, isDefinition: true });
                }
            }

            // For PHP_EACH loops, handle key_var, value_var, and array fields
            if (node.type === SyntaxType.ActionPhpEach || node.type === SyntaxType.PatchPhpEach) {
                // If this is a loop-scoped variable, only process this loop's declaration if it's the target loop
                const isTargetLoop = !symbolInfo.loopNode || isSameNode(symbolInfo.loopNode, node);

                const keyVarNode = node.childForFieldName("key_var");
                if (keyVarNode) {
                    let identNode: SyntaxNode | null = keyVarNode;
                    if (keyVarNode.type === SyntaxType.VariableRef) {
                        identNode = keyVarNode.child(0);
                    }
                    if (
                        identNode &&
                        identNode.type === SyntaxType.Identifier &&
                        matchesSymbol(identNode.text, symbolInfo.name)
                    ) {
                        // This is a definition only if it's from the target loop
                        if (isTargetLoop) {
                            occurrences.push({ node: identNode, isDefinition: true });
                        }
                    }
                }

                const valueVarNode = node.childForFieldName("value_var");
                if (valueVarNode) {
                    let identNode: SyntaxNode | null = valueVarNode;
                    if (valueVarNode.type === SyntaxType.VariableRef) {
                        identNode = valueVarNode.child(0);
                    }
                    if (
                        identNode &&
                        identNode.type === SyntaxType.Identifier &&
                        matchesSymbol(identNode.text, symbolInfo.name)
                    ) {
                        // This is a definition only if it's from the target loop
                        if (isTargetLoop) {
                            occurrences.push({ node: identNode, isDefinition: true });
                        }
                    }
                }

                const arrayNode = node.childForFieldName("array");
                if (arrayNode) {
                    let identNode: SyntaxNode | null = arrayNode;
                    if (arrayNode.type === SyntaxType.VariableRef) {
                        identNode = arrayNode.child(0);
                    }
                    if (
                        identNode &&
                        identNode.type === SyntaxType.Identifier &&
                        matchesSymbol(identNode.text, symbolInfo.name)
                    ) {
                        // Array reference in PHP_EACH is a usage, not a definition
                        occurrences.push({ node: identNode, isDefinition: false });
                    }
                }
            }

            // For FOR_EACH loops, handle var field
            if (node.type === SyntaxType.ActionForEach || node.type === SyntaxType.PatchForEach) {
                // If this is a loop-scoped variable, only process this loop's declaration if it's the target loop
                const isTargetLoop = !symbolInfo.loopNode || isSameNode(symbolInfo.loopNode, node);

                const forEachVarNode = node.childForFieldName("var");
                if (forEachVarNode) {
                    // The var field is a value node, get its first child (variable_ref or identifier)
                    let identNode: SyntaxNode | null = forEachVarNode.child(0);
                    if (identNode && identNode.type === SyntaxType.VariableRef) {
                        identNode = identNode.child(0);
                    }
                    if (
                        identNode &&
                        identNode.type === SyntaxType.Identifier &&
                        matchesSymbol(identNode.text, symbolInfo.name)
                    ) {
                        // This is a definition only if it's from the target loop
                        if (isTargetLoop) {
                            occurrences.push({ node: identNode, isDefinition: true });
                        }
                    }
                }
            }

            // For parameter declarations, identifiers are direct children
            if (
                node.type === SyntaxType.IntVarDecl ||
                node.type === SyntaxType.StrVarDecl ||
                node.type === SyntaxType.RetDecl ||
                node.type === SyntaxType.RetArrayDecl
            ) {
                for (const child of node.children) {
                    if (child.type === SyntaxType.Identifier && matchesSymbol(child.text, symbolInfo.name)) {
                        // This is a definition
                        occurrences.push({ node: child, isDefinition: true });
                    }
                }
            }
        }

        // Check array access nodes ($array_name(index))
        if (node.type === SyntaxType.ArrayAccess) {
            const nameNode = node.childForFieldName("name");
            if (nameNode && nameNode.type === SyntaxType.Identifier && matchesSymbol(nameNode.text, symbolInfo.name)) {
                // This is a reference, not a definition
                occurrences.push({ node: nameNode, isDefinition: false });
            }
        }

        // Recurse to children
        for (const child of node.children) {
            visit(child);
        }
    }

    visit(searchScope);
}

/**
 * Find all references to a function/macro.
 */
function findFunctionReferences(root: SyntaxNode, symbolInfo: SymbolInfo, occurrences: SymbolOccurrence[]): void {
    function visit(node: SyntaxNode): void {
        // Check function definitions
        // Cast to SyntaxType because tree-sitter node.type is string
        if (FUNCTION_DEF_TYPES.has(node.type as SyntaxType)) {
            const nameNode = node.childForFieldName("name");
            if (nameNode) {
                const name = stripStringDelimiters(nameNode.text);
                if (matchesSymbol(name, symbolInfo.name)) {
                    // This is a definition
                    occurrences.push({ node: nameNode, isDefinition: true });
                }
            }
        }

        // Check function calls
        // Cast to SyntaxType because tree-sitter node.type is string
        if (FUNCTION_CALL_TYPES.has(node.type as SyntaxType)) {
            const nameNode = node.childForFieldName("name");
            if (nameNode) {
                const name = stripStringDelimiters(nameNode.text);
                if (matchesSymbol(name, symbolInfo.name)) {
                    // This is a reference
                    occurrences.push({ node: nameNode, isDefinition: false });
                }
            }
        }

        // Recurse to children
        for (const child of node.children) {
            visit(child);
        }
    }

    visit(root);
}

// ============================================
// Utilities
// ============================================

/**
 * Convert a byte offset within text to a Position relative to basePosition.
 * Handles multiline strings correctly.
 */
function byteOffsetToPosition(text: string, offset: number, basePosition: { row: number; column: number }): Position {
    let currentLine = basePosition.row;
    let currentCol = basePosition.column;

    for (let i = 0; i < offset; i++) {
        if (text[i] === "\n") {
            currentLine++;
            currentCol = 0;
        } else {
            currentCol++;
        }
    }

    return { line: currentLine, character: currentCol };
}

/**
 * Find all references to a specific variable within string content.
 * Returns synthetic nodes representing each %var% occurrence.
 */
function findAllVariableReferencesInStringContent(node: SyntaxNode, varName: string): SyntaxNode[] {
    const text = node.text;
    const references: SyntaxNode[] = [];

    // Find all %varName% patterns (case-insensitive)
    const varPattern = /%([a-zA-Z_][a-zA-Z0-9_]*)%/g;
    let match: RegExpExecArray | null;

    while ((match = varPattern.exec(text)) !== null) {
        const foundVarName = match[1];
        if (foundVarName !== undefined && matchesSymbol(foundVarName, varName)) {
            // Create a synthetic node for this %var% reference
            const matchStart = match.index;
            const matchEnd = match.index + match[0].length;

            // Calculate absolute position by converting byte offset to (line, column)
            // String content can be multiline (e.g., five-tilde strings), so we need to
            // traverse the text to find the correct line and column for the match
            const startPos = byteOffsetToPosition(text, matchStart, node.startPosition);
            const endPos = byteOffsetToPosition(text, matchEnd, node.startPosition);

            // Create a synthetic node-like object
            // Type assertion is required because we're creating a custom node structure
            // that mimics SyntaxNode but isn't actually from the tree-sitter parser.
            const syntheticNode: SyntheticPercentVarNode = {
                type: "synthetic_percent_var",
                text: match[0], // The full %var% including %
                startPosition: { row: startPos.line, column: startPos.character },
                endPosition: { row: endPos.line, column: endPos.character },
                children: [],
                parent: node,
            };

            // Cast to SyntaxNode for compatibility with the rest of the codebase
            references.push(syntheticNode as unknown as SyntaxNode);
        }
    }

    return references;
}
