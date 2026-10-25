/**
 * Rename symbol for WeiDU D files.
 * Supports dialog-scoped state label rename.
 *
 * A state label's identity is (dialogFile, labelName).
 * Rename collects ALL references with matching pair across the entire source_file.
 *
 * This implementation renames within single file only - a reference in another .d file (an EXTEND_TOP,
 * EXTEND_BOTTOM or EXTERN naming this label, which find-references reaches through the workspace index) is
 * not updated.
 *
 * Public API: prepareRenameSymbol, renameSymbol.
 */

import type { Position, Range, TextEdit, WorkspaceEdit } from "vscode-languageserver/node";
import { makeRange } from "../core/position-utils";
import { parseWithCache, isInitialized } from "@bgforge/shared/parsers/weidu-d";
import type { Node as SyntaxNode } from "web-tree-sitter";
import { findLabelNodeAtPosition } from "./state-utils";
import { findAllDialogLabelRefs } from "./reference-finder";
import { labelName, quotedLabelContent } from "./label-refs";
import { SyntaxType } from "./syntax-type";

/**
 * A new name must stand as a bare label everywhere the old one did, so it is checked by the grammar itself: a
 * bare word WeiDU accepts as a label (`100`, `KHPC1.1`, `RR#ZA00`), never a keyword or anything with a space.
 */
function isValidLabel(name: string): boolean {
    const tree = parseWithCache(`BEGIN d\nIF ~~ THEN BEGIN ${name} SAY ~~ END\n`);
    if (!tree || tree.rootNode.hasError) return false;
    const label = tree.rootNode.firstNamedChild?.namedChildren.find((n) => n.type === SyntaxType.State);
    const labelNode = label?.childForFieldName("label");
    return labelNode?.type === SyntaxType.StateLabelAlnum && labelNode.text === name;
}

/** The span a rename replaces: a quoted label keeps its quotes, so only the name inside them changes. */
function nameRange(labelNode: SyntaxNode): Range {
    return makeRange(quotedLabelContent(labelNode) ?? labelNode);
}

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
    const name = labelName(labelInfo.labelNode);
    const refs = findAllDialogLabelRefs(tree.rootNode, labelInfo.dialogFile, name);
    const hasDefinition = refs.some((r) => r.isDefinition);
    if (!hasDefinition) {
        lastPrepareResult = null;
        return null;
    }

    // Cache for the subsequent renameSymbol call
    lastPrepareResult = {
        text,
        dialogFile: labelInfo.dialogFile,
        labelName: name,
        ranges: refs.map((ref) => nameRange(ref.node)),
    };

    return {
        range: nameRange(labelInfo.labelNode),
        placeholder: name,
    };
}

/**
 * Rename a symbol at the given position.
 * Returns null if the symbol cannot be renamed.
 */
export function renameSymbol(text: string, position: Position, newName: string, uri: string): WorkspaceEdit | null {
    if (!isInitialized() || !isValidLabel(newName)) {
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
    const name = labelName(labelInfo.labelNode);
    const cached = lastPrepareResult;
    lastPrepareResult = null;
    let ranges: readonly Range[];
    if (cached && cached.text === text && cached.dialogFile === labelInfo.dialogFile && cached.labelName === name) {
        ranges = cached.ranges;
    } else {
        const refs = findAllDialogLabelRefs(tree.rootNode, labelInfo.dialogFile, name);
        if (!refs.some((r) => r.isDefinition)) {
            return null;
        }
        ranges = refs.map((ref) => nameRange(ref.node));
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
