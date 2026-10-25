/**
 * Document symbol provider for WeiDU D files.
 */

import { type DocumentSymbol, SymbolKind } from "vscode-languageserver/node";
import type { Node as SyntaxNode } from "web-tree-sitter";
import { parseWithCache, isInitialized } from "@bgforge/shared/parsers/weidu-d";
import { SyntaxType } from "./syntax-type";
import { labelName } from "./label-refs";

/**
 * Nodes whose `label` names a state they create: a state, and a CHAIN or CHAIN2, whose entry label is its first
 * state's. The walk visits every node, ERROR subtrees included, so a state in a recovered tree stays listed.
 */
const LABELLED_STATE_TYPES: ReadonlySet<string> = new Set<string>([
    SyntaxType.State,
    SyntaxType.ChainAction,
    SyntaxType.InlineChain,
]);

export function getDocumentSymbols(text: string): DocumentSymbol[] {
    if (!isInitialized()) {
        return [];
    }

    const tree = parseWithCache(text);
    if (!tree) {
        return [];
    }

    const symbols: DocumentSymbol[] = [];

    function visit(node: SyntaxNode) {
        if (LABELLED_STATE_TYPES.has(node.type)) {
            const label = node.childForFieldName("label");
            const name = label ? labelName(label) : "";
            if (label && name) {
                const startPos = label.startPosition;
                const endPos = label.endPosition;
                symbols.push({
                    name,
                    kind: SymbolKind.Function,
                    range: {
                        start: { line: node.startPosition.row, character: node.startPosition.column },
                        end: { line: node.endPosition.row, character: node.endPosition.column },
                    },
                    selectionRange: {
                        start: { line: startPos.row, character: startPos.column },
                        end: { line: endPos.row, character: endPos.column },
                    },
                });
            }
        }
        for (const child of node.children) {
            visit(child);
        }
    }

    visit(tree.rootNode);
    return symbols;
}
