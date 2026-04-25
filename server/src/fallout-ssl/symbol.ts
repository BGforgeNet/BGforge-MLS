/**
 * Document symbol provider for Fallout SSL files.
 * Extracts procedures (with local variables as children), macros, and global
 * variables. Procedure children include params, variable declarations, and
 * for loop declarations — all as flat children (two-level nesting max).
 * Only actual declarations (using the `variable` keyword) are collected,
 * not assignments or loop iteration variables.
 */

import { DocumentSymbol, SymbolKind } from "vscode-languageserver/node";
import type { Node } from "web-tree-sitter";
import { parseWithCache, isInitialized } from "../../../shared/parsers/fallout-ssl";
import { extractProcedures, makeRange, extractMacros } from "./utils";
import { SyntaxType } from "./tree-sitter.d";

function makeSymbol(
    node: Node,
    nameNode: Node,
    kind: SymbolKind,
    detail?: string,
    children?: DocumentSymbol[],
): DocumentSymbol | null {
    const name = nameNode.text;
    if (!name) {
        return null;
    }
    return {
        name,
        detail,
        kind,
        range: makeRange(node),
        selectionRange: makeRange(nameNode),
        children,
    };
}

/**
 * Collect all variable declarations inside a procedure body as flat DocumentSymbol children.
 * Walks recursively — variables inside conditionals/loops still belong to the procedure.
 * No deduplication needed: SSL requires the `variable` keyword for declarations,
 * and the compiler rejects redeclarations within the same procedure.
 */
function collectProcBodyVars(node: Node, procName: string): DocumentSymbol[] {
    const vars: DocumentSymbol[] = [];

    if (node.type === SyntaxType.VariableDecl) {
        for (const child of node.children) {
            if (child.type === SyntaxType.VarInit) {
                const nameNode = child.childForFieldName("name");
                if (nameNode) {
                    const sym = makeSymbol(child, nameNode, SymbolKind.Variable, procName);
                    if (sym) vars.push(sym);
                }
            }
        }
    } else if (node.type === SyntaxType.ForVarDecl) {
        const nameNode = node.childForFieldName("name");
        if (nameNode) {
            const sym = makeSymbol(node, nameNode, SymbolKind.Variable, procName);
            if (sym) vars.push(sym);
        }
    }

    for (const child of node.children) {
        vars.push(...collectProcBodyVars(child, procName));
    }
    return vars;
}

/** Collect procedure parameters as DocumentSymbol children. */
function collectProcParams(procNode: Node, procName: string): DocumentSymbol[] {
    const vars: DocumentSymbol[] = [];
    const params = procNode.childForFieldName("params");
    if (!params) return vars;

    for (const child of params.children) {
        if (child.type === SyntaxType.Param) {
            const nameNode = child.childForFieldName("name");
            if (nameNode) {
                const sym = makeSymbol(child, nameNode, SymbolKind.Variable, procName);
                if (sym) vars.push(sym);
            }
        }
    }
    return vars;
}

/**
 * Extract symbols from a pre-parsed AST root node.
 * Prefers procedure definitions over forward declarations.
 */
function extractSymbols(root: Node): DocumentSymbol[] {
    // Extract procedures (already deduped) with children for params and local vars
    const procedures = extractProcedures(root);
    const procSymbols: DocumentSymbol[] = [];
    for (const [name, { node }] of procedures) {
        const nameNode = node.childForFieldName("name");
        if (!nameNode) continue;

        const children = [...collectProcParams(node, name), ...collectProcBodyVars(node, name)];

        const sym = makeSymbol(
            node,
            nameNode,
            SymbolKind.Function,
            undefined,
            children.length > 0 ? children : undefined,
        );
        if (sym) procSymbols.push(sym);
    }

    // Extract macros
    const macros = extractMacros(root);
    const macroSymbols: DocumentSymbol[] = [];

    // Iterate over tree to find define nodes and match with MacroData
    function visitForMacros(node: Node): void {
        if (node.type === SyntaxType.Preprocessor) {
            for (const child of node.children) {
                if (child.type === SyntaxType.Define) {
                    const nameNode = child.childForFieldName("name");
                    if (!nameNode) continue;

                    const name = nameNode.text;
                    const macro = macros.find((m) => m.name === name);
                    if (!macro) continue;

                    // Determine symbol kind: parameterized macros → Method,
                    // constant-like macros → Constant
                    const kind = macro.hasParams ? SymbolKind.Method : SymbolKind.Constant;

                    const sym = makeSymbol(child, nameNode, kind);
                    if (sym) macroSymbols.push(sym);
                }
            }
        }

        for (const c of node.children) {
            visitForMacros(c);
        }
    }

    visitForMacros(root);

    const variables: DocumentSymbol[] = [];

    for (const node of root.children) {
        if (node.type === SyntaxType.VariableDecl) {
            for (const child of node.children) {
                if (child.type === SyntaxType.VarInit) {
                    const nameNode = child.childForFieldName("name");
                    if (nameNode) {
                        const sym = makeSymbol(child, nameNode, SymbolKind.Variable);
                        if (sym) variables.push(sym);
                    }
                }
            }
        } else if (node.type === SyntaxType.ExportDecl) {
            const nameNode = node.childForFieldName("name");
            if (nameNode) {
                const sym = makeSymbol(node, nameNode, SymbolKind.Variable);
                if (sym) variables.push(sym);
            }
        }
    }

    return [...procSymbols, ...macroSymbols, ...variables];
}

/** Parse text and extract document symbols. */
export function getDocumentSymbols(text: string): DocumentSymbol[] {
    if (!isInitialized()) {
        return [];
    }

    const tree = parseWithCache(text);
    if (!tree) {
        return [];
    }

    return extractSymbols(tree.rootNode);
}
