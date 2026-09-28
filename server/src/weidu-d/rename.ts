/**
 * Rename symbol for WeiDU D files.
 * Supports dialog-scoped state label rename.
 *
 * A state label's identity is (dialogFile, labelName).
 * Rename collects ALL references with matching pair across the entire source_file.
 *
 * Public API: prepareRenameSymbol, renameSymbol.
 */

import type { Position, Range, TextEdit, WorkspaceEdit } from "vscode-languageserver/node";
import { makeRange } from "../core/position-utils";
import { parseWithCache, isInitialized } from "../../../shared/parsers/weidu-d";
import { findLabelNodeAtPosition } from "./state-utils";
import { findAllDialogLabelRefs } from "./reference-finder";

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
        ranges: refs.map((ref) => makeRange(ref.node)),
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

    // Reuse the ranges prepareRename found if the text and label match. Only a definition-bearing label is
    // ever cached, so a hit needs no second definition check.
    const cached = lastPrepareResult;
    lastPrepareResult = null;
    let ranges: readonly Range[];
    if (
        cached &&
        cached.text === text &&
        cached.dialogFile === labelInfo.dialogFile &&
        cached.labelName === labelInfo.labelNode.text
    ) {
        ranges = cached.ranges;
    } else {
        const refs = findAllDialogLabelRefs(tree.rootNode, labelInfo.dialogFile, labelInfo.labelNode.text);
        if (!refs.some((r) => r.isDefinition)) {
            return null;
        }
        ranges = refs.map((ref) => makeRange(ref.node));
    }

    const edits: TextEdit[] = ranges.map((range) => ({ range, newText: newName }));

    return { changes: { [uri]: edits } };
}

/**
 * Cache the last prepareRename result to avoid double AST traversal.
 * LSP calls prepareRename then rename sequentially - the second call
 * reuses the ranges found by the first if the text hasn't changed.
 *
 * Request-scoped memoisation: safe as module state because LSP callbacks are
 * sequential - prepareRename always runs to completion before rename is invoked.
 * It holds plain ranges, never tree nodes: other parses between the two requests
 * can evict the tree from the parse cache, which frees the memory its nodes read.
 */
let lastPrepareResult: {
    readonly text: string;
    readonly dialogFile: string;
    readonly labelName: string;
    readonly ranges: readonly Range[];
} | null = null;
