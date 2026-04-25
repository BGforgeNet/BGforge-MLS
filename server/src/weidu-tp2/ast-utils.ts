/**
 * AST utility functions for WeiDU TP2 language.
 * Provides local variable extraction and position-based analysis.
 */

import { CompletionItemKind, Position } from "vscode-languageserver/node";
import { createIsInsideComment } from "../shared/comment-check";
import { CompletionCategory, type Tp2CompletionItem } from "./completion/types";
import { parseWithCache, isInitialized } from "../../../shared/parsers/weidu-tp2";
import { SyntaxType } from "./tree-sitter.d";
import {
    findNodeAtPosition,
    isPhantomAssignment,
    looksLikeConstant,
    stripStringDelimiters,
    unwrapVariableRef,
} from "./tree-utils";
import { VARIABLE_DECL_TYPES } from "./variable-symbols";

/**
 * Extract all local variables from the current file for completion.
 * Parses the file with tree-sitter and collects all variable names from VARIABLE_DECL_TYPES nodes.
 */
export function localCompletion(text: string): Tp2CompletionItem[] {
    if (!isInitialized()) {
        return [];
    }

    const tree = parseWithCache(text);
    if (!tree) {
        return [];
    }

    const variableNames = new Set<string>();

    function visit(node: import("web-tree-sitter").Node): void {
        // Check if this node declares a variable
        if (VARIABLE_DECL_TYPES.has(node.type as SyntaxType) && !isPhantomAssignment(node)) {
            // Extract variable name from various declaration types
            const varNode = node.childForFieldName("var");
            if (varNode) {
                variableNames.add(stripStringDelimiters(varNode.text));
            }

            // For READ_* patches that can have multiple vars
            const varNodes = node.childrenForFieldName("var");
            for (const vn of varNodes) {
                if (vn.type === SyntaxType.Identifier) {
                    variableNames.add(vn.text);
                }
            }

            // For DEFINE_ARRAY etc., field is "name"
            const nameNode = node.childForFieldName("name");
            if (nameNode) {
                const exprNode = nameNode.child(0);
                if (exprNode) {
                    const identNode = unwrapVariableRef(exprNode);
                    if (identNode.type === SyntaxType.Identifier) {
                        variableNames.add(identNode.text);
                    }
                }
            }

            // For parameter declarations (INT_VAR, STR_VAR, RET, RET_ARRAY)
            const paramDeclTypes: ReadonlySet<SyntaxType> = new Set([
                SyntaxType.IntVarDecl,
                SyntaxType.StrVarDecl,
                SyntaxType.RetDecl,
                SyntaxType.RetArrayDecl,
            ]);
            if (paramDeclTypes.has(node.type as SyntaxType)) {
                for (const child of node.children) {
                    if (child.type === SyntaxType.Identifier) {
                        variableNames.add(child.text);
                    }
                }
            }

            // For loop variables (key_var, value_var)
            for (const fieldNode of [node.childForFieldName("key_var"), node.childForFieldName("value_var")]) {
                if (!fieldNode) continue;
                const identNode = unwrapVariableRef(fieldNode);
                if (identNode.type === SyntaxType.Identifier) {
                    variableNames.add(identNode.text);
                }
            }
        }

        // Recurse to children
        for (const child of node.children) {
            visit(child);
        }
    }

    visit(tree.rootNode);

    // Convert to CompletionItem[] with "vars" category for filtering
    return Array.from(variableNames).map(
        (name): Tp2CompletionItem => ({
            label: name,
            kind: looksLikeConstant(name) ? CompletionItemKind.Constant : CompletionItemKind.Variable,
            category: CompletionCategory.Vars,
        }),
    );
}

/** Comment node types in the TP2 grammar. */
const TP2_COMMENT_TYPES: ReadonlySet<string> = new Set([SyntaxType.Comment, SyntaxType.LineComment]);

/**
 * Check if the given position is inside a comment node using tree-sitter.
 */
export const isInsideComment = createIsInsideComment(isInitialized, parseWithCache, TP2_COMMENT_TYPES);

/** Loop node types that bind variables (PHP_EACH, FOR_EACH). */
const LOOP_BINDING_TYPES = new Set([
    SyntaxType.ActionPhpEach,
    SyntaxType.PatchPhpEach,
    SyntaxType.ActionForEach,
    SyntaxType.PatchForEach,
]);

/** Field names that represent variable bindings in loop nodes. */
const LOOP_VARIABLE_FIELDS = new Set(["key_var", "value_var", "var"]);

/**
 * Check if the cursor is on a loop variable binding (e.g., AS opcode in PHP_EACH).
 * These are definition sites and should not show unrelated indexed variable data.
 */
export function isOnLoopVariableBinding(root: import("web-tree-sitter").Node, position: Position): boolean {
    const node = findNodeAtPosition(root, position);
    if (!node) {
        return false;
    }

    // Walk up from the node looking for a loop parent
    let current: import("web-tree-sitter").Node | null = node;
    while (current) {
        if (LOOP_BINDING_TYPES.has(current.type as SyntaxType)) {
            // Found a loop node — check if the cursor is on a variable binding field
            for (const fieldName of LOOP_VARIABLE_FIELDS) {
                const fieldNode = current.childForFieldName(fieldName);
                if (fieldNode && node.startIndex >= fieldNode.startIndex && node.endIndex <= fieldNode.endIndex) {
                    return true;
                }
            }
            return false;
        }
        current = current.parent;
    }

    return false;
}
