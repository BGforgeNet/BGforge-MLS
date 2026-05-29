/**
 * WeiDU D file parser.
 * Extracts workspace symbols and cross-file references from a single
 * tree-sitter AST parse, returning a unified ParseResult.
 *
 * D files have no user-defined functions/macros, but state labels are
 * navigable symbols for workspace search. References use dialog-scoped
 * composite keys ("dialogFile:labelName").
 *
 * AST traversal (which grammar nodes carry label references) lives in
 * label-refs.ts, shared with reference-finder.ts.
 */

import { type Location, CompletionItemKind, InsertTextFormat, MarkupKind } from "vscode-languageserver/node";
import type { Node as SyntaxNode } from "web-tree-sitter";
import { computeDisplayPath, extractFilename } from "../core/location-utils";
import { type ParseResult, EMPTY_PARSE_RESULT } from "../core/parse-result";
import { makeRange } from "../core/position-utils";
import { ScopeLevel, type StateSymbol, SourceType, SymbolKind } from "../core/symbol";
import { buildSignatureBlock } from "../../../shared/tooltip-format";
import { LANG_WEIDU_D_TOOLTIP } from "../core/languages";
import { parseWithCache, isInitialized } from "../../../shared/parsers/weidu-d";
import { forEachDialogLabelRef } from "./label-refs";

/** Build the composite key for dialog-scoped labels. */
function labelKey(dialogFile: string, labelName: string): string {
    return `${dialogFile}:${labelName}`;
}

function createStateSymbol(uri: string, dialogFile: string, labelNode: SyntaxNode, displayPath: string): StateSymbol {
    const label = labelNode.text;
    const scopedName = labelKey(dialogFile, label);
    return {
        name: scopedName,
        kind: SymbolKind.State,
        location: { uri, range: makeRange(labelNode) },
        scope: { level: ScopeLevel.File },
        source: {
            type: SourceType.Navigation,
            uri,
            displayPath,
        },
        completion: {
            label,
            kind: CompletionItemKind.Field,
            detail: `state (${dialogFile})`,
            insertTextFormat: InsertTextFormat.PlainText,
            labelDetails: { description: displayPath },
        },
        hover: {
            contents: {
                kind: MarkupKind.Markdown,
                value: buildSignatureBlock(`state ${scopedName}`, LANG_WEIDU_D_TOOLTIP, displayPath),
            },
        },
    };
}

/**
 * Parse a D file and return state symbols and references.
 */
export function parseFile(uri: string, text: string, workspaceRoot?: string): ParseResult {
    if (!isInitialized()) {
        return EMPTY_PARSE_RESULT;
    }

    const tree = parseWithCache(text);
    if (!tree) {
        return EMPTY_PARSE_RESULT;
    }

    const symbols: StateSymbol[] = [];
    const refs = new Map<string, Location[]>();
    const displayPath = computeDisplayPath(uri, workspaceRoot) || extractFilename(uri);

    function addRef(dialogFile: string, labelName: string, loc: Location): void {
        const key = labelKey(dialogFile, labelName);
        let locs = refs.get(key);
        if (!locs) {
            locs = [];
            refs.set(key, locs);
        }
        locs.push(loc);
    }

    forEachDialogLabelRef(tree.rootNode, (dialog, labelNode, isDefinition) => {
        addRef(dialog, labelNode.text, { uri, range: makeRange(labelNode) });
        if (isDefinition) {
            symbols.push(createStateSymbol(uri, dialog, labelNode, displayPath));
        }
    });

    return { symbols, refs };
}
