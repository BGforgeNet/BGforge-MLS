/**
 * Go to Definition for WeiDU D files.
 * Handles jumping to state label definitions, in the same file or, through the workspace index, in another.
 * Uses dialog-scoped matching: labels are unique within a (dialogFile, labelName) pair.
 */

import type { Location, Position } from "vscode-languageserver/node";
import { makeRange } from "../core/position-utils";
import { parseWithCache, isInitialized } from "@bgforge/shared/parsers/weidu-d";
import { findLabelNodeAtPosition, findStateInDialog } from "./state-utils";
import { labelName, labelKey } from "./label-refs";

/**
 * Get definition location for the symbol at the given position. `lookupIndexed` resolves a
 * `dialogFile:labelName` key against the workspace index, for a label defined in another file.
 */
export function getDefinition(
    text: string,
    uri: string,
    position: Position,
    lookupIndexed?: (key: string) => Location | null,
): Location | null {
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

    const name = labelName(labelInfo.labelNode);
    const state = findStateInDialog(tree.rootNode, labelInfo.dialogFile, name);
    if (state) {
        return { uri, range: makeRange(state.labelNode) };
    }
    return lookupIndexed?.(labelKey(labelInfo.dialogFile, name)) ?? null;
}
