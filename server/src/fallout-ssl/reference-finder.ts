/**
 * Scope-restricted reference finding for Fallout SSL rename and references operations.
 *
 * For procedure-scoped symbols: walks only the containing procedure subtree.
 * For file-scoped symbols: walks the entire file but skips into procedures
 * that shadow the symbol with a procedure-local definition, and skips macro
 * bodies where the symbol name matches a macro parameter.
 */

import type { Node } from "web-tree-sitter";
import { ScopeKind, assertNeverScope } from "./scope-kinds";
import type { SslSymbolScope } from "./symbol-scope";
import { isLocalToProc, resolveIdentifierDefinitionNode } from "./symbol-definitions";
import { parseMacroParams } from "./macro-utils";
import { SyntaxType } from "./tree-sitter.d";

/**
 * Check if a Define node has a macro parameter matching the given name.
 * Macro params are structured nodes with real identifier children;
 * we parse the text representation to extract parameter names.
 */
function isMacroParam(defineNode: Node, symbolName: string): boolean {
    const paramsNode = defineNode.childForFieldName("params");
    if (!paramsNode) return false;
    const params = parseMacroParams(paramsNode.text);
    return params.includes(symbolName);
}

/**
 * Resolve the AST subtree to search based on the symbol's scope.
 * File and External scopes search the full tree; Procedure and Macro scopes
 * are restricted to their containing node.
 *
 * The explicit return type + exhaustive switch ensures a compile error if a
 * new ScopeKind variant is added without updating this function.
 */
function resolveSearchRoot(symbolInfo: SslSymbolScope, rootNode: Node): Node {
    switch (symbolInfo.scope) {
        case ScopeKind.File:
            return rootNode;
        case ScopeKind.External:
            // Guarded before this call (findScopedReferences returns [] for External);
            // included here only to satisfy exhaustive coverage.
            return rootNode;
        case ScopeKind.Procedure:
            return symbolInfo.procedureNode ?? rootNode;
        case ScopeKind.Macro:
            return symbolInfo.defineNode ?? rootNode;
        default:
            return assertNeverScope(symbolInfo.scope);
    }
}

/**
 * Find all identifier references to a symbol within its correct scope.
 *
 * - procedure scope: searches only within symbolInfo.procedureNode
 * - file scope: searches entire tree, skipping procedures that shadow the name,
 *   and skipping macro bodies where the symbol matches a macro parameter name
 *
 * Uses recursive descent for consistency with utils.ts traversals.
 * SSL ASTs are shallow (no nested procedures), so stack depth is not a concern.
 */
export function findScopedReferences(rootNode: Node, symbolInfo: SslSymbolScope): Node[] {
    // Guard: external scope has no local definition to search for
    if (symbolInfo.scope === ScopeKind.External) {
        return [];
    }

    // Guard: procedure scope requires a procedureNode to restrict the search
    if (symbolInfo.scope === ScopeKind.Procedure && !symbolInfo.procedureNode) {
        return [];
    }

    // Guard: macro scope requires a defineNode to restrict the search
    if (symbolInfo.scope === ScopeKind.Macro && !symbolInfo.defineNode) {
        return [];
    }

    const refs: Node[] = [];
    const searchRoot = resolveSearchRoot(symbolInfo, rootNode);

    if (symbolInfo.definitionNode) {
        const visitResolved = (node: Node): void => {
            if (node.type === SyntaxType.Identifier) {
                if (node.id === symbolInfo.definitionNode!.id) {
                    refs.push(node);
                } else {
                    const definitionNode = resolveIdentifierDefinitionNode(rootNode, node);
                    if (definitionNode && definitionNode.id === symbolInfo.definitionNode!.id) {
                        refs.push(node);
                    }
                }
            }

            for (const child of node.children) {
                visitResolved(child);
            }
        };

        visitResolved(searchRoot);
        return refs;
    }

    function visit(node: Node): void {
        // Shadow exclusion: when searching file-scope, skip entire procedure
        // subtree if the procedure defines a local with the same name
        if (
            symbolInfo.scope === ScopeKind.File &&
            node.type === SyntaxType.Procedure &&
            isLocalToProc(node, symbolInfo.name)
        ) {
            return;
        }

        // Shadow exclusion: when searching file-scope, skip macro body
        // if the symbol name matches one of the macro's own parameters.
        // E.g., renaming file-scope `a` should not touch `a` in `#define ADD(a, b) ((a) + (b))`.
        if (
            symbolInfo.scope === ScopeKind.File &&
            node.type === SyntaxType.MacroBody &&
            node.parent?.type === SyntaxType.Define &&
            isMacroParam(node.parent, symbolInfo.name)
        ) {
            return;
        }

        // Skip macro_params entirely for file-scope searches — param names
        // are definitions, not references to file-scope symbols.
        if (symbolInfo.scope === ScopeKind.File && node.type === SyntaxType.MacroParams) {
            return;
        }

        if (node.type === SyntaxType.Identifier && node.text === symbolInfo.name) {
            refs.push(node);
        }

        for (const child of node.children) {
            visit(child);
        }
    }

    visit(searchRoot);
    return refs;
}
