/**
 * Go to Definition for WeiDU D files.
 * Handles jumping to state label definitions within the same file.
 * Uses dialog-scoped matching: labels are unique within a (dialogFile, labelName) pair.
 */

import { Location, Position } from "vscode-languageserver/node";
import { makeRange } from "../core/position-utils";
import { parseWithCache, isInitialized } from "../../../shared/parsers/weidu-d";
import { findLabelNodeAtPosition, findStateInDialog } from "./state-utils";

/**
 * Get definition location for the symbol at the given position.
 */
export function getDefinition(text: string, uri: string, position: Position): Location | null {
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

    const state = findStateInDialog(tree.rootNode, labelInfo.dialogFile, labelInfo.labelNode.text);
    if (!state) {
        return null;
    }

    return { uri, range: makeRange(state.labelNode) };
}
