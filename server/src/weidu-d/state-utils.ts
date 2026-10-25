/**
 * Shared state label utilities for WeiDU D files.
 * Used by definition, references, rename, and hover features.
 *
 * Core concept: state labels are scoped to a dialog file.
 * A label "state1" in BEGIN ~DIALOG_A~ is separate from "state1" in BEGIN ~DIALOG_B~.
 * The unique key is (dialogFile, labelName). Which nodes are labels, and which dialog each belongs to, is
 * label-refs.ts's single walk; this module only asks it.
 */

import type { Position } from "vscode-languageserver/node";
import type { Node as SyntaxNode } from "web-tree-sitter";
import { containsPosition } from "../core/position-utils";
import { forEachDialogLabelRef, labelName } from "./label-refs";

/** A state definition found in the AST. */
interface StateInfo {
    readonly name: string;
    readonly labelNode: SyntaxNode;
    /** The node the label defines: a state, or the CHAIN whose first state it labels. */
    readonly stateNode: SyntaxNode;
}

/** Result of finding a label node at a cursor position. */
interface LabelAtPosition {
    readonly labelNode: SyntaxNode;
    readonly dialogFile: string;
}

/**
 * Find the state label node at the given cursor position: a definition or any reference to one.
 * Returns the label node and the dialog file it belongs to.
 */
export function findLabelNodeAtPosition(root: SyntaxNode, position: Position): LabelAtPosition | null {
    let found: LabelAtPosition | null = null;
    forEachDialogLabelRef(root, (dialogFile, labelNode) => {
        if (found === null && containsPosition(position, labelNode)) {
            found = { labelNode, dialogFile };
        }
    });
    return found;
}

/**
 * Find a state definition matching (dialogFile, labelName) across the entire tree.
 * Returns the full StateInfo (callers pick the field they need: labelNode or stateNode).
 */
export function findStateInDialog(root: SyntaxNode, dialogFile: string, name: string): StateInfo | null {
    let found: StateInfo | null = null;
    forEachDialogLabelRef(root, (dialog, labelNode, isDefinition) => {
        if (found === null && isDefinition && dialog === dialogFile && labelName(labelNode) === name) {
            found = { name, labelNode, stateNode: labelNode.parent ?? labelNode };
        }
    });
    return found;
}
