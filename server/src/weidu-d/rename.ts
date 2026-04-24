/**
 * Rename symbol for WeiDU D files.
 * Supports dialog-scoped state label rename.
 *
 * A state label's identity is (dialogFile, labelName).
 * Rename collects ALL references with matching pair across the entire source_file.
 *
 * Public API: prepareRenameSymbol, renameSymbol.
 */

import { Position, TextEdit, WorkspaceEdit } from "vscode-languageserver/node";
import { makeRange } from "../core/position-utils";
import { parseWithCache, isInitialized } from "./parser";
import { findLabelNodeAtPosition } from "./state-utils";
import { findAllDialogLabelRefs, type LabelRef } from "./reference-finder";

/** WeiDU D state labels: alphanumeric identifiers. */
const VALID_STATE_LABEL = /^[a-zA-Z_][a-zA-Z0-9_]*$/;

/**
 * Prepares for rename by validating the position and returning the range and placeholder.
 * Returns null if rename is not allowed at this position.
 */
export function prepareRenameSymbol(
    text: string,
    position: Position,
): { range: { start: Position; end: Position }; placeholder: string } | null {
    if (!isInitialized()) {
        return null;
    }

    const tree = parseWithCache(text);
    if (!tree) {
        return null;
    }

    const labelInfo = findLabelNodeAtPosition(tree.rootNode, position);
    if (!labelInfo) {
        return null;
    }

    // Ensure there's a definition for this label in the file
    const refs = findAllDialogLabelRefs(tree.rootNode, labelInfo.dialogFile, labelInfo.labelNode.text);
    const hasDefinition = refs.some((r) => r.isDefinition);
    if (!hasDefinition) {
        lastPrepareResult = null;
        return null;
    }

    // Cache for the subsequent renameSymbol call
    lastPrepareResult = {
        text,
        dialogFile: labelInfo.dialogFile,
        labelName: labelInfo.labelNode.text,
        refs,
    };

    return {
        range: makeRange(labelInfo.labelNode),
        placeholder: labelInfo.labelNode.text,
    };
}

/**
 * Rename a symbol at the given position.
 * Returns null if the symbol cannot be renamed.
 */
export function renameSymbol(text: string, position: Position, newName: string, uri: string): WorkspaceEdit | null {
    if (!isInitialized() || !VALID_STATE_LABEL.test(newName)) {
        return null;
    }

    const tree = parseWithCache(text);
    if (!tree) {
        return null;
    }

    const labelInfo = findLabelNodeAtPosition(tree.rootNode, position);
    if (!labelInfo) {
        return null;
    }

    // Reuse cached refs from prepareRename if the text and label match
    const cached = lastPrepareResult;
    const refs =
        cached &&
        cached.text === text &&
        cached.dialogFile === labelInfo.dialogFile &&
        cached.labelName === labelInfo.labelNode.text
            ? cached.refs
            : findAllDialogLabelRefs(tree.rootNode, labelInfo.dialogFile, labelInfo.labelNode.text);
    lastPrepareResult = null;

    if (refs.length === 0) {
        return null;
    }

    const hasDefinition = refs.some((r) => r.isDefinition);
    if (!hasDefinition) {
        return null;
    }

    const edits: TextEdit[] = refs.map((ref) => ({
        range: makeRange(ref.node),
        newText: newName,
    }));

    return { changes: { [uri]: edits } };
}

/**
 * Cache the last prepareRename result to avoid double AST traversal.
 * LSP calls prepareRename then rename sequentially — the second call
 * reuses the refs found by the first if the text hasn't changed.
 *
 * Request-scoped memoisation: safe as module state because LSP callbacks are
 * sequential — prepareRename always runs to completion before rename is invoked.
 */
let lastPrepareResult: {
    readonly text: string;
    readonly dialogFile: string;
    readonly labelName: string;
    readonly refs: readonly LabelRef[];
} | null = null;
