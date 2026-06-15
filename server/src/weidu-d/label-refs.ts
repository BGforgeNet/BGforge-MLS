/**
 * Single source of truth for which WeiDU D grammar nodes carry state-label
 * references. Both the workspace indexer (file-parser.ts) and the single-file
 * reference finder (reference-finder.ts) walk the tree through this visitor, so
 * grammar node types are enumerated in exactly one place.
 *
 * Dialog attribution mirrors how the engine scopes labels:
 * - State definitions and GOTO/ShortGoto belong to the enclosing BEGIN/APPEND
 *   dialog (`scopeDialog`).
 * - EXTERN/COPY_TRANS and the top-level actions (CHAIN, INTERJECT, EXTEND_*,
 *   ADD_STATE_TRIGGER, ADD_TRANS_TRIGGER, REPLACE_SAY, REPLACE_STATE_TRIGGER,
 *   SET_WEIGHT) reference the dialog named on the action itself.
 */

import type { Node as SyntaxNode } from "web-tree-sitter";
import { SyntaxType } from "./syntax-type";
import { normalizeDialogFile } from "./state-utils";

/**
 * Invoke `emit` for every state-label reference in the tree. `dialog` is the
 * normalized dialog the label belongs to, `labelNode` is the identifier node,
 * and `isDefinition` is true only for a state definition (a `BEGIN <state>`).
 */
export function forEachDialogLabelRef(
    root: SyntaxNode,
    emit: (dialog: string, labelNode: SyntaxNode, isDefinition: boolean) => void,
): void {
    function emitFileLabel(node: SyntaxNode, fileField: string, labelField: string): void {
        const fileNode = node.childForFieldName(fileField);
        const labelNode = node.childForFieldName(labelField);
        if (fileNode && labelNode) {
            emit(normalizeDialogFile(fileNode.text), labelNode, false);
        }
    }

    // GOTO/ShortGoto refs nested inside EXTEND_TOP/EXTEND_BOTTOM transitions.
    function visitTransitions(parent: SyntaxNode, dialog: string): void {
        function inner(node: SyntaxNode): void {
            if (node.type === SyntaxType.GotoNext || node.type === SyntaxType.ShortGoto) {
                const label = node.childForFieldName("label");
                if (label) {
                    emit(dialog, label, false);
                }
            }
            for (const child of node.children) {
                inner(child);
            }
        }
        inner(parent);
    }

    // Refs inside a begin_action / append_action scope.
    function visitScope(scopeNode: SyntaxNode, scopeDialog: string): void {
        function inner(node: SyntaxNode): void {
            if (node.type === SyntaxType.State) {
                const label = node.childForFieldName("label");
                if (label) {
                    emit(scopeDialog, label, true);
                }
            } else if (node.type === SyntaxType.GotoNext || node.type === SyntaxType.ShortGoto) {
                const label = node.childForFieldName("label");
                if (label) {
                    emit(scopeDialog, label, false);
                }
            } else if (node.type === SyntaxType.ExternNext) {
                const fileNode = node.childForFieldName("file");
                const label = node.childForFieldName("label");
                if (fileNode && label) {
                    emit(normalizeDialogFile(fileNode.text), label, false);
                }
            } else if (node.type === SyntaxType.CopyTrans) {
                const fileNode = node.childForFieldName("file");
                const stateNode = node.childForFieldName("state");
                if (fileNode && stateNode) {
                    emit(normalizeDialogFile(fileNode.text), stateNode, false);
                }
            }
            for (const child of node.children) {
                inner(child);
            }
        }
        inner(scopeNode);
    }

    // Top-level actions with file + state/label fields. Returns true if handled
    // (the caller must NOT recurse into children, e.g. chain_epilogue).
    function visitTopLevel(node: SyntaxNode): boolean {
        const type = node.type;

        // CHAIN / INTERJECT: file + label, plus chain_epilogue children.
        if (
            type === SyntaxType.ChainAction ||
            type === SyntaxType.InterjectAction ||
            type === SyntaxType.InterjectCopyTrans
        ) {
            emitFileLabel(node, "file", "label");
            for (const child of node.children) {
                if (child.type === SyntaxType.ChainEpilogue) {
                    emitFileLabel(child, "file", "label");
                }
            }
            return true;
        }

        // EXTEND_TOP/EXTEND_BOTTOM: file + states[] + transition refs.
        if (type === SyntaxType.ExtendAction) {
            const fileNode = node.childForFieldName("file");
            if (fileNode) {
                const dialog = normalizeDialogFile(fileNode.text);
                for (const stateNode of node.childrenForFieldName("states")) {
                    emit(dialog, stateNode, false);
                }
                visitTransitions(node, dialog);
            }
            return true;
        }

        // ADD_STATE_TRIGGER, ADD_TRANS_TRIGGER, REPLACE_SAY, REPLACE_STATE_TRIGGER, SET_WEIGHT: file + state.
        if (
            type === SyntaxType.AddStateTrigger ||
            type === SyntaxType.AddTransTrigger ||
            type === SyntaxType.ReplaceSay ||
            type === SyntaxType.ReplaceStateTrigger ||
            type === SyntaxType.SetWeight
        ) {
            emitFileLabel(node, "file", "state");
            return true;
        }

        return false;
    }

    function visit(node: SyntaxNode): void {
        if (node.type === SyntaxType.BeginAction || node.type === SyntaxType.AppendAction) {
            const fileNode = node.childForFieldName("file");
            if (fileNode) {
                visitScope(node, normalizeDialogFile(fileNode.text));
            }
            // Don't recurse - visitScope handles children.
            return;
        }

        if (visitTopLevel(node)) {
            return;
        }

        for (const child of node.children) {
            visit(child);
        }
    }

    visit(root);
}
