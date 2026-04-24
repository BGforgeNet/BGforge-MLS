/**
 * Symbol scope determination for Fallout SSL rename operations.
 *
 * Fallout SSL has exactly two scopes:
 * - File scope: procedures, macros (#define), exports, forward declarations
 * - Procedure scope: params, variables, for/foreach vars
 *
 * Given a cursor position, determines which scope the symbol belongs to
 * and provides the procedure node for procedure-scoped symbols.
 */

import type { Node } from "web-tree-sitter";
import { Position } from "vscode-languageserver/node";
import { findIdentifierNodeAtPosition } from "./utils";
import { ScopeKind, type ScopeKind as ScopeKindValue } from "./scope-kinds";
import {
    findContainingDefine,
    findContainingProcedure,
    findFileScopeDefinitionNode,
    findMacroParamDefinitionNode,
    isLocalToProc,
    resolveIdentifierDefinitionNode,
} from "./symbol-definitions";

/**
 * Scope information for a symbol at a given cursor position.
 *
 * - "file": defined at file scope (procedure name, macro, export, top-level variable)
 * - "procedure": defined locally in a procedure (parameter, variable, for/foreach var)
 * - "macro": defined as a parameter of a #define macro (scoped to that define node)
 * - "external": identifier exists at cursor but is not defined in any scope of the current file
 *   (e.g., a macro from an included header)
 */
export interface SslSymbolScope {
    name: string;
    scope: ScopeKindValue;
    definitionNode?: Node;
    procedureNode?: Node;
    /** The containing Define node; only set when scope === ScopeKind.Macro. */
    defineNode?: Node;
}

/**
 * Determine the scope of a symbol at the given cursor position.
 *
 * Logic:
 * 1. Find identifier at position
 * 2. If inside a #define and the symbol is a parameter of that macro -> macro scope
 * 3. If inside a procedure and the procedure defines it locally -> procedure scope
 * 4. If defined at file scope (procedure name, macro, export) -> file scope
 * 5. Otherwise -> external (identifier exists but not defined in this file)
 */
export function getSymbolScope(rootNode: Node, position: Position): SslSymbolScope | null {
    const symbolNode = findIdentifierNodeAtPosition(rootNode, position);
    if (!symbolNode) {
        return null;
    }

    const symbolName = symbolNode.text;

    // Check if inside a #define where the symbol is a macro parameter.
    // Macros are not nested inside procedures, so this check is independent of the procedure scope check below.
    const containingDefine = findContainingDefine(symbolNode);
    if (containingDefine) {
        const macroParamNode = findMacroParamDefinitionNode(containingDefine, symbolName);
        if (macroParamNode) {
            return {
                name: symbolName,
                scope: ScopeKind.Macro,
                defineNode: containingDefine,
                definitionNode: macroParamNode,
            };
        }
    }

    const containingProc = findContainingProcedure(symbolNode);
    const localDefinitionNode =
        containingProc && isLocalToProc(containingProc, symbolName)
            ? resolveIdentifierDefinitionNode(rootNode, symbolNode)
            : null;

    if (containingProc && localDefinitionNode) {
        return {
            name: symbolName,
            scope: ScopeKind.Procedure,
            procedureNode: containingProc,
            definitionNode: localDefinitionNode,
        };
    }

    const fileDefinitionNode = findFileScopeDefinitionNode(rootNode, symbolName);
    if (fileDefinitionNode) {
        return {
            name: symbolName,
            scope: ScopeKind.File,
            definitionNode: fileDefinitionNode,
        };
    }

    // Symbol exists at cursor but is not defined in this file (e.g., from an included header)
    return { name: symbolName, scope: ScopeKind.External };
}
