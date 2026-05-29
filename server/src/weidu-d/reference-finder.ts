/**
 * Reference finding for WeiDU D state labels.
 * Locates all occurrences (definitions and references) of a state label
 * scoped to a dialog file.
 *
 * Extracted from rename.ts to support both rename and findReferences features.
 * Tree traversal lives in label-refs.ts (shared with the workspace indexer);
 * this module just filters that stream to a single (dialogFile, labelName).
 */

import type { Node as SyntaxNode } from "web-tree-sitter";
import { forEachDialogLabelRef } from "./label-refs";

/** A reference to a state label in the AST. */
export interface LabelRef {
    readonly node: SyntaxNode;
    readonly isDefinition: boolean;
}

/**
 * Find all references to (dialogFile, labelName) in the entire tree, including
 * the definition. EXTERN/COPY_TRANS that target the dialog from inside another
 * dialog's block are matched on the action's own file.
 */
export function findAllDialogLabelRefs(root: SyntaxNode, dialogFile: string, labelName: string): readonly LabelRef[] {
    const refs: LabelRef[] = [];
    forEachDialogLabelRef(root, (dialog, labelNode, isDefinition) => {
        if (dialog === dialogFile && labelNode.text === labelName) {
            refs.push({ node: labelNode, isDefinition });
        }
    });
    return refs;
}
