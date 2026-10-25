/**
 * Find References for WeiDU D files.
 * Returns all locations referencing a state label at the cursor position.
 *
 * Reuses findLabelNodeAtPosition (cursor to symbol) and findAllDialogLabelRefs
 * (AST traversal) from the shared reference-finder module.
 */

import type { Location, Position } from "vscode-languageserver/node";
import { makeRange } from "../core/position-utils";
import type { ReferencesIndex } from "../shared/references-index";
import { parseWithCache } from "@bgforge/shared/parsers/weidu-d";
import { findLabelNodeAtPosition } from "./state-utils";
import { findAllDialogLabelRefs } from "./reference-finder";
import { labelKey, labelName } from "./label-refs";

/**
 * Find all references to the state label at the given position.
 * Returns empty array if the position is not on a label.
 *
 * When a ReferencesIndex is provided, cross-file references are included
 * for state labels using the "dialogFile:labelName" composite key; without one,
 * a label with no definition in this file has no references.
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

    const name = labelName(labelInfo.labelNode);
    const refs = findAllDialogLabelRefs(tree.rootNode, labelInfo.dialogFile, name);
    const hasLocalDefinition = refs.some((r) => r.isDefinition);

    const localLocations = refs
        .filter((ref) => includeDeclaration || !ref.isDefinition)
        .map((ref) => ({
            uri,
            range: makeRange(ref.node),
        }));

    // Add cross-file references from the index. A label defined in another file (an EXTEND_TOP or EXTERN
    // naming it) still keeps this file's own references, the one under the cursor among them.
    if (refsIndex) {
        const crossFileRefs = refsIndex.lookup(labelKey(labelInfo.dialogFile, name)).filter((loc) => loc.uri !== uri);
        return [...localLocations, ...crossFileRefs];
    }

    // Without an index, require a local definition to return results
    if (!hasLocalDefinition) {
        return [];
    }
    return localLocations;
}
