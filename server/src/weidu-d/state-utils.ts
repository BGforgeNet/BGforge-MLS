/**
 * Shared state label utilities for WeiDU D files.
 * Used by definition, references, rename, and hover features.
 *
 * Core concept: state labels are scoped to a dialog file.
 * A label "state1" in BEGIN ~DIALOG_A~ is separate from "state1" in BEGIN ~DIALOG_B~.
 * The unique key is (dialogFile, labelName).
 */

import { Position } from "vscode-languageserver/node";
import type { Node as SyntaxNode } from "web-tree-sitter";
import { SyntaxType } from "./tree-sitter.d";

/** Strip ~ or " delimiters from a string node text. */
function stripDelimiters(text: string): string {
    if ((text.startsWith("~") && text.endsWith("~")) || (text.startsWith('"') && text.endsWith('"'))) {
        return text.slice(1, -1);
    }
    return text;
}

/** Normalize a dialog file name for comparison (strip delimiters, lowercase). */
export function normalizeDialogFile(text: string): string {
    return stripDelimiters(text).toLowerCase();
}

/**
 * Walk up ancestors from a node to find the enclosing begin_action or append_action.
 * Returns the scope node and its dialog file name, or null if not inside one.
 */
function findScopeBlock(node: SyntaxNode): { scopeNode: SyntaxNode; dialogFile: string } | null {
    let current: SyntaxNode | null = node;
    while (current) {
        if (current.type === SyntaxType.BeginAction || current.type === SyntaxType.AppendAction) {
            const fileNode = current.childForFieldName("file");
            if (fileNode) {
                return { scopeNode: current, dialogFile: normalizeDialogFile(fileNode.text) };
            }
        }
        current = current.parent;
    }
    return null;
}

/** A state definition found in the AST. */
interface StateInfo {
    readonly name: string;
    readonly labelNode: SyntaxNode;
    readonly stateNode: SyntaxNode;
}

/** Find all state definitions within a scope node (begin_action or append_action). */
function findStateDefinitions(scopeNode: SyntaxNode): readonly StateInfo[] {
    const results: StateInfo[] = [];
    function visit(node: SyntaxNode): void {
        if (node.type === SyntaxType.State) {
            const label = node.childForFieldName("label");
            if (label) {
                results.push({ name: label.text, labelNode: label, stateNode: node });
            }
        }
        for (const child of node.children) {
            visit(child);
        }
    }
    visit(scopeNode);
    return results;
}

/** Result of finding a label node at a cursor position. */
interface LabelAtPosition {
    readonly labelNode: SyntaxNode;
    readonly dialogFile: string;
}

/**
 * Types of top-level actions that have file + state/label fields.
 * Used to detect when the cursor is on a state label in a top-level action.
 */
const TOP_LEVEL_ACTION_TYPES_WITH_STATE = new Set([
    SyntaxType.ExtendAction,
    SyntaxType.AddStateTrigger,
    SyntaxType.AddTransTrigger,
    SyntaxType.ReplaceSay,
    SyntaxType.ReplaceStateTrigger,
    SyntaxType.SetWeight,
]);

const TOP_LEVEL_ACTION_TYPES_WITH_LABEL = new Set([
    SyntaxType.ChainAction,
    SyntaxType.InterjectAction,
    SyntaxType.InterjectCopyTrans,
]);

/**
 * Find the state label node at the given cursor position.
 * Returns the label node and the dialog file it belongs to.
 *
 * Handles three contexts:
 * 1. Inside begin/append: State definitions, GOTO, ShortGoto, ExternNext
 * 2. Top-level actions with file+state/label fields
 * 3. ChainEpilogue with file+label fields
 */
export function findLabelNodeAtPosition(root: SyntaxNode, position: Position): LabelAtPosition | null {
    function visit(node: SyntaxNode): LabelAtPosition | null {
        if (!isPositionInNode(position, node)) {
            return null;
        }

        // State definition label
        if (node.type === SyntaxType.State) {
            const label = node.childForFieldName("label");
            if (label && isPositionInNode(position, label)) {
                const scope = findScopeBlock(node);
                if (scope) {
                    return { labelNode: label, dialogFile: scope.dialogFile };
                }
            }
        }

        // GOTO target
        if (node.type === SyntaxType.GotoNext || node.type === SyntaxType.ShortGoto) {
            const label = node.childForFieldName("label");
            if (label && isPositionInNode(position, label)) {
                const scope = findScopeBlock(node);
                if (scope) {
                    return { labelNode: label, dialogFile: scope.dialogFile };
                }
            }
        }

        // EXTERN target — has its own file field
        if (node.type === SyntaxType.ExternNext) {
            const label = node.childForFieldName("label");
            if (label && isPositionInNode(position, label)) {
                const fileNode = node.childForFieldName("file");
                if (fileNode) {
                    return { labelNode: label, dialogFile: normalizeDialogFile(fileNode.text) };
                }
            }
        }

        // COPY_TRANS in transitions — has its own file field
        if (node.type === SyntaxType.CopyTrans) {
            const stateNode = node.childForFieldName("state");
            if (stateNode && isPositionInNode(position, stateNode)) {
                const fileNode = node.childForFieldName("file");
                if (fileNode) {
                    return { labelNode: stateNode, dialogFile: normalizeDialogFile(fileNode.text) };
                }
            }
        }

        // ChainEpilogue with file+label (after grammar change)
        if (node.type === SyntaxType.ChainEpilogue) {
            const label = node.childForFieldName("label");
            if (label && isPositionInNode(position, label)) {
                const fileNode = node.childForFieldName("file");
                if (fileNode) {
                    return { labelNode: label, dialogFile: normalizeDialogFile(fileNode.text) };
                }
            }
        }

        // Top-level actions with "state" field
        // SyntaxNode.type is string in web-tree-sitter; cast is safe since SyntaxType extends string
        if (TOP_LEVEL_ACTION_TYPES_WITH_STATE.has(node.type as SyntaxType)) {
            // ExtendAction uses "states" (array), others use "state"
            if (node.type === SyntaxType.ExtendAction) {
                const statesNodes = node.childrenForFieldName("states");
                for (const stateNode of statesNodes) {
                    if (isPositionInNode(position, stateNode)) {
                        const fileNode = node.childForFieldName("file");
                        if (fileNode) {
                            return { labelNode: stateNode, dialogFile: normalizeDialogFile(fileNode.text) };
                        }
                    }
                }
            } else {
                const stateNode = node.childForFieldName("state");
                if (stateNode && isPositionInNode(position, stateNode)) {
                    const fileNode = node.childForFieldName("file");
                    if (fileNode) {
                        return { labelNode: stateNode, dialogFile: normalizeDialogFile(fileNode.text) };
                    }
                }
            }
        }

        // Top-level actions with "label" field (CHAIN, INTERJECT, INTERJECT_COPY_TRANS)
        // SyntaxNode.type is string in web-tree-sitter; cast is safe since SyntaxType extends string
        if (TOP_LEVEL_ACTION_TYPES_WITH_LABEL.has(node.type as SyntaxType)) {
            const label = node.childForFieldName("label");
            if (label && isPositionInNode(position, label)) {
                const fileNode = node.childForFieldName("file");
                if (fileNode) {
                    return { labelNode: label, dialogFile: normalizeDialogFile(fileNode.text) };
                }
            }
        }

        // Recurse into children
        for (const child of node.children) {
            const result = visit(child);
            if (result) return result;
        }

        return null;
    }

    return visit(root);
}

/**
 * Find a state definition matching (dialogFile, labelName) across the entire tree.
 * Searches all begin_action and append_action blocks.
 * Returns the full StateInfo (callers pick the field they need: labelNode or stateNode).
 */
export function findStateInDialog(root: SyntaxNode, dialogFile: string, labelName: string): StateInfo | null {
    function visit(node: SyntaxNode): StateInfo | null {
        if (node.type === SyntaxType.BeginAction || node.type === SyntaxType.AppendAction) {
            const fileNode = node.childForFieldName("file");
            if (fileNode && normalizeDialogFile(fileNode.text) === dialogFile) {
                const match = findStateDefinitions(node).find((s) => s.name === labelName);
                if (match) {
                    return match;
                }
            }
        }
        for (const child of node.children) {
            const result = visit(child);
            if (result) return result;
        }
        return null;
    }
    return visit(root);
}

/** Check if a position falls within a node's range. */
function isPositionInNode(position: Position, node: SyntaxNode): boolean {
    const { row: startRow, column: startCol } = node.startPosition;
    const { row: endRow, column: endCol } = node.endPosition;
    return (
        (position.line > startRow || (position.line === startRow && position.character >= startCol)) &&
        (position.line < endRow || (position.line === endRow && position.character <= endCol))
    );
}
