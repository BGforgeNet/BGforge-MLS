/**
 * Single source of truth for which WeiDU D grammar nodes carry state-label
 * references. The workspace indexer (file-parser.ts), the single-file reference
 * finder (reference-finder.ts) and the cursor lookups in state-utils.ts all walk
 * the tree through this visitor, so grammar node types are enumerated in exactly
 * one place.
 *
 * Dialog attribution mirrors how WeiDU scopes labels:
 * - A state definition, and a GOTO or `+ label` jump, belongs to the dialog the
 *   enclosing block works on: BEGIN, APPEND, REPLACE, APPENDI, or the CHAIN,
 *   INTERJECT or EXTEND whose epilogue or transitions hold the jump.
 * - EXTERN, COPY_TRANS and the top-level actions (CHAIN, INTERJECT, EXTEND_*, the
 *   state lists of ALTER_TRANS, ADD_TRANS_ACTION, REPLACE_TRANS_*, and the states of
 *   ADD_STATE_TRIGGER, ADD_TRANS_TRIGGER, REPLACE_STATE_TRIGGER, REPLACE_SAY,
 *   SET_WEIGHT) name the dialog on the construct itself.
 * - A CHAIN's (and a CHAIN2's) entry label defines the chain's first state; an
 *   INTERJECT's names the existing state it interjects into.
 */

import type { Node as SyntaxNode } from "web-tree-sitter";
import { SyntaxType } from "./syntax-type";

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

/** The content node of a quoted label (`13` in `~13~`), or null for a bare label or an empty string. */
export function quotedLabelContent(labelNode: SyntaxNode): SyntaxNode | null {
    if (labelNode.type !== SyntaxType.String) return null;
    return labelNode.firstNamedChild?.firstNamedChild ?? null;
}

/**
 * A state label's name as WeiDU reads it. Its lexer strips a quoted label's delimiters, so `~13~` and `13`
 * are one label.
 */
export function labelName(labelNode: SyntaxNode): string {
    if (labelNode.type !== SyntaxType.String) return labelNode.text;
    return quotedLabelContent(labelNode)?.text ?? "";
}

/** The workspace index key of a dialog-scoped label. */
export function labelKey(dialogFile: string, name: string): string {
    return `${dialogFile}:${name}`;
}

/** Actions whose `state` fields all name states of the action's own dialog. */
const STATE_FIELD_ACTIONS: ReadonlySet<string> = new Set<string>([
    SyntaxType.AddStateTrigger,
    SyntaxType.AddTransTrigger,
    SyntaxType.AddTransAction,
    SyntaxType.AlterTrans,
    SyntaxType.ReplaceSay,
    SyntaxType.ReplaceStateTrigger,
    SyntaxType.ReplaceTransAction,
    SyntaxType.ReplaceTransTrigger,
    SyntaxType.SetWeight,
]);

/** Blocks whose states and jumps belong to the dialog named in their `file` field. */
const STATE_BLOCKS: ReadonlySet<string> = new Set<string>([
    SyntaxType.BeginAction,
    SyntaxType.AppendAction,
    SyntaxType.ReplaceAction,
    SyntaxType.InlineAppend,
]);

/**
 * Invoke `emit` for every state-label reference in the tree. `dialog` is the
 * normalized dialog the label belongs to, `labelNode` is the label node, and
 * `isDefinition` is true only where a state gets that label: a state's own label,
 * or a CHAIN's entry label.
 */
export function forEachDialogLabelRef(
    root: SyntaxNode,
    emit: (dialog: string, labelNode: SyntaxNode, isDefinition: boolean) => void,
): void {
    const dialogOf = (node: SyntaxNode, fileField = "file"): string | null => {
        const fileNode = node.childForFieldName(fileField);
        return fileNode ? normalizeDialogFile(fileNode.text) : null;
    };
    const emitField = (dialog: string | null, node: SyntaxNode, field: string, isDefinition: boolean) => {
        if (dialog === null) return;
        for (const label of node.childrenForFieldName(field)) {
            emit(dialog, label, isDefinition);
        }
    };

    // `scope` is the dialog a state definition or a GOTO belongs to at this point of the walk.
    function visit(node: SyntaxNode, scope: string | null): void {
        let inner = scope;
        const type = node.type;
        if (STATE_BLOCKS.has(type)) {
            inner = dialogOf(node);
        } else if (type === SyntaxType.State) {
            emitField(scope, node, "label", true);
        } else if (type === SyntaxType.GotoNext || type === SyntaxType.ShortGoto) {
            emitField(scope, node, "label", false);
        } else if (type === SyntaxType.ExternNext || type === SyntaxType.ChainEpilogue) {
            emitField(dialogOf(node), node, "label", false);
        } else if (type === SyntaxType.CopyTrans) {
            emitField(dialogOf(node), node, "state", false);
        } else if (type === SyntaxType.ChainAction) {
            inner = dialogOf(node);
            emitField(inner, node, "label", true);
        } else if (type === SyntaxType.InterjectAction || type === SyntaxType.InterjectCopyTrans) {
            inner = dialogOf(node);
            emitField(inner, node, "label", false);
        } else if (type === SyntaxType.InlineChain) {
            emitField(dialogOf(node), node, "label", true);
            emitField(dialogOf(node, "exit_file"), node, "exit_label", false);
        } else if (type === SyntaxType.ExtendAction) {
            inner = dialogOf(node);
            emitField(inner, node, "states", false);
        } else if (STATE_FIELD_ACTIONS.has(type)) {
            emitField(dialogOf(node), node, "state", false);
        }
        for (const child of node.children) {
            visit(child, inner);
        }
    }

    visit(root, null);
}
