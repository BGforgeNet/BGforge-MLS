/**
 * Reference finding for WeiDU D state labels.
 * Locates all occurrences (definitions and references) of a state label
 * scoped to a dialog file.
 *
 * Extracted from rename.ts to support both rename and findReferences features.
 *
 * NOTE: file-parser.ts has structurally similar AST traversal (same node types)
 * but collects ALL refs for cross-file indexing rather than filtering by a
 * specific (dialogFile, labelName) pair. If new node types are added to the
 * grammar, both files must be updated.
 */

import type { Node as SyntaxNode } from "web-tree-sitter";
import { SyntaxType } from "./tree-sitter.d";
import { normalizeDialogFile } from "./state-utils";

/** A reference to a state label in the AST. */
export interface LabelRef {
    readonly node: SyntaxNode;
    readonly isDefinition: boolean;
}

/**
 * Find all references to (dialogFile, labelName) in the entire tree.
 *
 * Group A — inside begin_action/append_action with matching fileNode:
 *   State.label (definition), GotoNext.label, ShortGoto.label
 *
 * Group B — top-level actions with matching file field:
 *   ExternNext, ChainAction, InterjectAction, InterjectCopyTrans,
 *   ExtendAction, AddStateTrigger, AddTransTrigger, CopyTrans,
 *   ReplaceSay, ReplaceStateTrigger, SetWeight, ChainEpilogue
 */
export function findAllDialogLabelRefs(root: SyntaxNode, dialogFile: string, labelName: string): readonly LabelRef[] {
    const refs: LabelRef[] = [];

    function visit(node: SyntaxNode): void {
        // Group A: begin_action or append_action scope
        if (node.type === SyntaxType.BeginAction || node.type === SyntaxType.AppendAction) {
            const fileNode = node.childForFieldName("file");
            if (fileNode && normalizeDialogFile(fileNode.text) === dialogFile) {
                collectRefsInScope(node, dialogFile, labelName, refs);
            }
            // Don't recurse — collectRefsInScope handles children
            return;
        }

        // Group B: top-level actions with file + state/label fields
        // collectTopLevelRefs handles the node AND its children (e.g., chain_epilogue
        // inside chain_action), so return early to avoid double-counting.
        if (collectTopLevelRefs(node, dialogFile, labelName, refs)) {
            return;
        }

        for (const child of node.children) {
            visit(child);
        }
    }

    visit(root);
    return refs;
}

/** Collect state label refs inside a begin_action or append_action scope. */
function collectRefsInScope(scopeNode: SyntaxNode, scopeDialog: string, labelName: string, refs: LabelRef[]): void {
    function visit(node: SyntaxNode): void {
        // State definition
        if (node.type === SyntaxType.State) {
            const label = node.childForFieldName("label");
            if (label && label.text === labelName) {
                refs.push({ node: label, isDefinition: true });
            }
        }

        // GOTO reference
        if (node.type === SyntaxType.GotoNext) {
            const label = node.childForFieldName("label");
            if (label && label.text === labelName) {
                refs.push({ node: label, isDefinition: false });
            }
        }

        // Short GOTO (+ label)
        if (node.type === SyntaxType.ShortGoto) {
            const label = node.childForFieldName("label");
            if (label && label.text === labelName) {
                refs.push({ node: label, isDefinition: false });
            }
        }

        // ExternNext inside a scope — match only if pointing to same dialog
        if (node.type === SyntaxType.ExternNext) {
            const fileNode = node.childForFieldName("file");
            const label = node.childForFieldName("label");
            if (fileNode && label && normalizeDialogFile(fileNode.text) === scopeDialog && label.text === labelName) {
                refs.push({ node: label, isDefinition: false });
            }
        }

        // CopyTrans inside transitions
        if (node.type === SyntaxType.CopyTrans) {
            const fileNode = node.childForFieldName("file");
            const stateNode = node.childForFieldName("state");
            if (
                fileNode &&
                stateNode &&
                normalizeDialogFile(fileNode.text) === scopeDialog &&
                stateNode.text === labelName
            ) {
                refs.push({ node: stateNode, isDefinition: false });
            }
        }

        for (const child of node.children) {
            visit(child);
        }
    }
    visit(scopeNode);
}

/**
 * Collect refs from top-level actions that reference (dialogFile, labelName).
 * Returns true if the node was handled (caller should NOT recurse into children).
 */
function collectTopLevelRefs(node: SyntaxNode, dialogFile: string, labelName: string, refs: LabelRef[]): boolean {
    const type = node.type;

    // CHAIN action: file + label + chain_epilogue children
    if (type === SyntaxType.ChainAction) {
        matchFileLabel(node, "file", "label", dialogFile, labelName, refs);
        for (const child of node.children) {
            if (child.type === SyntaxType.ChainEpilogue) {
                matchFileLabel(child, "file", "label", dialogFile, labelName, refs);
            }
        }
        return true;
    }

    // INTERJECT action: file + label + chain_epilogue children
    if (type === SyntaxType.InterjectAction || type === SyntaxType.InterjectCopyTrans) {
        matchFileLabel(node, "file", "label", dialogFile, labelName, refs);
        for (const child of node.children) {
            if (child.type === SyntaxType.ChainEpilogue) {
                matchFileLabel(child, "file", "label", dialogFile, labelName, refs);
            }
        }
        return true;
    }

    // EXTEND_TOP/EXTEND_BOTTOM: file + states[] (array field) + transition refs
    if (type === SyntaxType.ExtendAction) {
        const fileNode = node.childForFieldName("file");
        if (fileNode && normalizeDialogFile(fileNode.text) === dialogFile) {
            const statesNodes = node.childrenForFieldName("states");
            for (const stateNode of statesNodes) {
                if (stateNode.text === labelName) {
                    refs.push({ node: stateNode, isDefinition: false });
                }
            }
            collectTransitionRefs(node, labelName, refs);
        }
        return true;
    }

    // ADD_STATE_TRIGGER: file + state
    if (type === SyntaxType.AddStateTrigger) {
        matchFileState(node, dialogFile, labelName, refs);
        return true;
    }

    // ADD_TRANS_TRIGGER: file + state (first field only, extras are unnamed)
    if (type === SyntaxType.AddTransTrigger) {
        matchFileState(node, dialogFile, labelName, refs);
        return true;
    }

    // REPLACE_SAY: file + state
    if (type === SyntaxType.ReplaceSay) {
        matchFileState(node, dialogFile, labelName, refs);
        return true;
    }

    // REPLACE_STATE_TRIGGER: file + state
    if (type === SyntaxType.ReplaceStateTrigger) {
        matchFileState(node, dialogFile, labelName, refs);
        return true;
    }

    // SET_WEIGHT: file + state
    if (type === SyntaxType.SetWeight) {
        matchFileState(node, dialogFile, labelName, refs);
        return true;
    }

    return false;
}

/** Match a node's file + label fields against the target dialog/label. */
function matchFileLabel(
    node: SyntaxNode,
    fileField: string,
    labelField: string,
    dialogFile: string,
    labelName: string,
    refs: LabelRef[],
): void {
    const fileNode = node.childForFieldName(fileField);
    const labelNode = node.childForFieldName(labelField);
    if (fileNode && labelNode && normalizeDialogFile(fileNode.text) === dialogFile && labelNode.text === labelName) {
        refs.push({ node: labelNode, isDefinition: false });
    }
}

/** Match a node's file + state fields against the target dialog/label. */
function matchFileState(node: SyntaxNode, dialogFile: string, labelName: string, refs: LabelRef[]): void {
    matchFileLabel(node, "file", "state", dialogFile, labelName, refs);
}

/** Collect GOTO and ShortGoto refs inside transitions (used for EXTEND_TOP/EXTEND_BOTTOM). */
function collectTransitionRefs(parent: SyntaxNode, labelName: string, refs: LabelRef[]): void {
    function visit(node: SyntaxNode): void {
        if (node.type === SyntaxType.GotoNext || node.type === SyntaxType.ShortGoto) {
            const label = node.childForFieldName("label");
            if (label && label.text === labelName) {
                refs.push({ node: label, isDefinition: false });
            }
        }
        for (const child of node.children) {
            visit(child);
        }
    }
    visit(parent);
}
