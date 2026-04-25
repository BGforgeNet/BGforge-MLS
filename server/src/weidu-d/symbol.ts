/**
 * Document symbol provider for WeiDU D files.
 */

import { DocumentSymbol, SymbolKind } from "vscode-languageserver/node";
import { parseWithCache, isInitialized } from "../../../shared/parsers/weidu-d";

export function getDocumentSymbols(text: string): DocumentSymbol[] {
    if (!isInitialized()) {
        return [];
    }

    const tree = parseWithCache(text);
    if (!tree) {
        return [];
    }

    const symbols: DocumentSymbol[] = [];

    // Walk the tree to find state nodes and extract their labels
    function visit(node: import("web-tree-sitter").Node) {
        if (node.type === "state") {
            const label = node.childForFieldName("label");
            if (label && label.text) {
                const startPos = label.startPosition;
                const endPos = label.endPosition;
                symbols.push({
                    name: label.text,
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
