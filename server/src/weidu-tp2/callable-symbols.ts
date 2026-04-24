import type { Position } from "vscode-languageserver/node";
import type { Node as SyntaxNode } from "web-tree-sitter";
import { FUNCTION_DEF_TYPES } from "./variable-symbols";
import { ScopeKind } from "./scope-kinds";
import { SyntaxType } from "./tree-sitter.d";
import { findAncestorOfType, findNodeAtPosition, isSameNode, stripStringDelimiters } from "./tree-utils";

/** Node types for function/macro calls. */
export const FUNCTION_CALL_TYPES: ReadonlySet<SyntaxType> = new Set([
    SyntaxType.ActionLaunchFunction,
    SyntaxType.ActionLaunchMacro,
    SyntaxType.PatchLaunchFunction,
    SyntaxType.PatchLaunchMacro,
]);

interface CallableSymbolInfo {
    name: string;
    kind: "function";
    scope: typeof ScopeKind.File;
    node: SyntaxNode;
}

export function getCallableSymbolAtPosition(root: SyntaxNode, position: Position): CallableSymbolInfo | null {
    const node = findNodeAtPosition(root, position);
    if (!node) {
        return null;
    }

    if (isStringContentNode(node)) {
        const stringNode = node.parent;
        if (!stringNode || !isStringNode(stringNode)) {
            return null;
        }

        const functionName = getCallableNameFromContainer(stringNode, FUNCTION_DEF_TYPES);
        if (functionName) {
            return {
                name: node.text,
                kind: "function",
                scope: ScopeKind.File,
                node: stringNode,
            };
        }

        const callName = getCallableNameFromContainer(stringNode, FUNCTION_CALL_TYPES);
        if (callName) {
            return {
                name: node.text,
                kind: "function",
                scope: ScopeKind.File,
                node: stringNode,
            };
        }

        return null;
    }

    if (node.type !== SyntaxType.Identifier && node.type !== SyntaxType.String) {
        return null;
    }

    const functionName = getCallableNameFromContainer(node, FUNCTION_DEF_TYPES);
    if (functionName) {
        return {
            name: stripStringDelimiters(node.text),
            kind: "function",
            scope: ScopeKind.File,
            node,
        };
    }

    const callName = getCallableNameFromContainer(node, FUNCTION_CALL_TYPES);
    if (callName) {
        return {
            name: stripStringDelimiters(node.text),
            kind: "function",
            scope: ScopeKind.File,
            node,
        };
    }

    return null;
}

function getCallableNameFromContainer(node: SyntaxNode, containerTypes: ReadonlySet<SyntaxType>): string | null {
    const container = findAncestorOfType(node, containerTypes);
    if (!container) {
        return null;
    }

    const nameNode = container.childForFieldName("name");
    if (!nameNode || !isSameNode(nameNode, node)) {
        return null;
    }

    return stripStringDelimiters(nameNode.text);
}

function isStringContentNode(node: SyntaxNode): boolean {
    return (
        node.type === SyntaxType.TildeContent ||
        node.type === SyntaxType.DoubleContent ||
        node.type === SyntaxType.FiveTildeContent
    );
}

function isStringNode(node: SyntaxNode): boolean {
    return (
        node.type === SyntaxType.String ||
        node.type === SyntaxType.TildeString ||
        node.type === SyntaxType.DoubleString ||
        node.type === SyntaxType.FiveTildeString
    );
}
