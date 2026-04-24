/**
 * Find References for WeiDU D files.
 * Returns all locations referencing a state label at the cursor position.
 *
 * Reuses findLabelNodeAtPosition (cursor to symbol) and findAllDialogLabelRefs
 * (AST traversal) from the shared reference-finder module.
 */

import { Location, Position } from "vscode-languageserver/node";
import { makeRange } from "../core/position-utils";
import type { ReferencesIndex } from "../shared/references-index";
import { parseWithCache } from "./parser";
import { findLabelNodeAtPosition } from "./state-utils";
import { findAllDialogLabelRefs } from "./reference-finder";

/**
 * Find all references to the state label at the given position.
 * Returns empty array if the position is not on a label or no definition exists.
 *
 * When a ReferencesIndex is provided, cross-file references are included
 * for state labels using the "dialogFile:labelName" composite key.
 */
export function findReferences(
    text: string,
    position: Position,
    uri: string,
    includeDeclaration: boolean,
    refsIndex?: ReferencesIndex,
): Location[] {
    const tree = parseWithCache(text);
    if (!tree) {
        return [];
    }

    const labelInfo = findLabelNodeAtPosition(tree.rootNode, position);
    if (!labelInfo) {
        return [];
    }

    const labelName = labelInfo.labelNode.text;
    const refs = findAllDialogLabelRefs(tree.rootNode, labelInfo.dialogFile, labelName);
    const hasLocalDefinition = refs.some((r) => r.isDefinition);

    const localLocations = refs
        .filter((ref) => includeDeclaration || !ref.isDefinition)
        .map((ref) => ({
            uri,
            range: makeRange(ref.node),
        }));

    // Add cross-file references from the index
    if (refsIndex) {
        const compositeKey = `${labelInfo.dialogFile}:${labelName}`;
        const crossFileRefs = refsIndex.lookup(compositeKey).filter((loc) => loc.uri !== uri);

        // If no local definition, return only cross-file results (e.g., EXTEND_TOP
        // referencing a label defined in another file).
        if (!hasLocalDefinition) {
            return crossFileRefs;
        }
        return [...localLocations, ...crossFileRefs];
    }

    // Without an index, require a local definition to return results
    if (!hasLocalDefinition) {
        return [];
    }
    return localLocations;
}
