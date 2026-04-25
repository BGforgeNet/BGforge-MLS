/**
 * Rename symbol for WeiDU TP2 files.
 * Supports:
 * - Variables (OUTER_SET, OUTER_TEXT_SPRINT, SET, TEXT_SPRINT)
 * - Function parameters (INT_VAR, STR_VAR, RET, RET_ARRAY)
 * - Loop variables (PHP_EACH key/value vars, FOR_EACH vars)
 * - Functions/Macros (DEFINE_*_FUNCTION, DEFINE_*_MACRO)
 *
 * WeiDU variables are globally scoped across files via INCLUDE.
 * This implementation renames within single file only - cross-file references won't be updated.
 *
 * Public API: prepareRenameSymbol, renameSymbol.
 * Symbol discovery logic is in ./symbol-discovery.ts.
 * Reference finding logic is in ./reference-finder.ts.
 */

import { Position, TextEdit, WorkspaceEdit } from "vscode-languageserver/node";
import { makeRange } from "../core/position-utils";
import { parseWithCache, isInitialized } from "../../../shared/parsers/weidu-tp2";
import { SyntaxType } from "./tree-sitter.d";
import { getSymbolAtPosition, isRenameableSymbol } from "./symbol-discovery";
import { findAllReferences } from "./reference-finder";

// ============================================
// Main entry point
// ============================================

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

    // Find the symbol at the cursor position
    const symbolInfo = getSymbolAtPosition(tree.rootNode, position);
    if (!symbolInfo) {
        return null;
    }

    // Check if the symbol can be renamed
    if (!isRenameableSymbol(symbolInfo)) {
        return null;
    }

    // Check if the symbol has a definition in the current file
    // Allow rename from any position (definition or reference), but reject if symbol is external
    const occurrences = findAllReferences(tree.rootNode, symbolInfo);
    const hasLocalDefinition = occurrences.some((occ) => occ.isDefinition);
    if (!hasLocalDefinition) {
        return null; // Symbol is not defined in this file
    }

    // Return the range and placeholder
    return {
        range: {
            start: { line: symbolInfo.node.startPosition.row, character: symbolInfo.node.startPosition.column },
            end: { line: symbolInfo.node.endPosition.row, character: symbolInfo.node.endPosition.column },
        },
        placeholder: symbolInfo.name,
    };
}

/**
 * Rename a symbol at the given position.
 * Returns null if the symbol cannot be renamed.
 */
export function renameSymbol(text: string, position: Position, newName: string, uri: string): WorkspaceEdit | null {
    if (!isInitialized()) {
        return null;
    }

    const tree = parseWithCache(text);
    if (!tree) {
        return null;
    }

    // Find the symbol at the cursor position
    const symbolInfo = getSymbolAtPosition(tree.rootNode, position);
    if (!symbolInfo) {
        return null;
    }

    // Check if the symbol can be renamed
    if (!isRenameableSymbol(symbolInfo)) {
        return null;
    }

    // Find all occurrences of the symbol
    const occurrences = findAllReferences(tree.rootNode, symbolInfo);
    if (occurrences.length === 0) {
        return null;
    }

    // Check if the symbol has a definition in the current file
    // Allow rename from any position (definition or reference), but reject if symbol is external
    const hasLocalDefinition = occurrences.some((occ) => occ.isDefinition);
    if (!hasLocalDefinition) {
        return null; // Symbol is not defined in this file
    }

    // Create text edits for all occurrences
    const edits: TextEdit[] = occurrences.map((occ) => {
        const node = occ.node;
        // For synthetic %var% nodes in string content, wrap the new name with %
        // For percent_string nodes (%var% in expressions), they already have % so wrap as well
        // Note: synthetic_percent_var is a custom type created for string content parsing, not in grammar
        const SYNTHETIC_PERCENT_VAR = "synthetic_percent_var";
        const isSyntheticPercentVar = node.type === SYNTHETIC_PERCENT_VAR;
        const isPercentString = node.type === SyntaxType.PercentString;
        const needsPercentWrapper = isSyntheticPercentVar || isPercentString;

        // For macro/function names that are strings, preserve the delimiters
        const isStringName =
            (node.type === SyntaxType.String ||
                node.type === SyntaxType.TildeString ||
                node.type === SyntaxType.DoubleString ||
                node.type === SyntaxType.FiveTildeString) &&
            symbolInfo.kind === "function";

        let editText: string;
        if (needsPercentWrapper) {
            editText = `%${newName}%`;
        } else if (isStringName) {
            // Preserve the original string delimiters
            const originalText = node.text;
            const firstChar = originalText[0];
            const lastChar = originalText[originalText.length - 1];
            if (firstChar === "~" && lastChar === "~") {
                editText = `~${newName}~`;
            } else if (firstChar === '"' && lastChar === '"') {
                editText = `"${newName}"`;
            } else {
                editText = originalText; // Keep original format if we can't detect delimiters
            }
        } else {
            editText = newName;
        }

        return {
            range: makeRange(node),
            newText: editText,
        };
    });

    return {
        changes: {
            [uri]: edits,
        },
    };
}
