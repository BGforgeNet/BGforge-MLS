/**
 * Semantic token extraction for Fallout SSL files.
 * Highlights procedure and macro parameter references in their bodies.
 *
 * Unlike TP2 (which collects param names into a set and does fast lookups),
 * SSL uses resolve-per-identifier: each identifier is resolved via
 * resolveIdentifierDefinitionNode (the same path used by go-to-definition
 * and rename), then checked with isParameterDefinitionNode. This reuses
 * the unified symbol resolution chain rather than duplicating knowledge
 * about which node types are parameter declarations.
 *
 * The visit() signature takes an extra rootNode arg because
 * resolveIdentifierDefinitionNode needs the file root for scope walking.
 */

import { SemanticTokenTypes } from "vscode-languageserver/node";
import type { Node } from "web-tree-sitter";
import { isInitialized, parseWithCache } from "../../../shared/parsers/fallout-ssl";
import { SyntaxType } from "./tree-sitter.d";
import { isParameterDefinitionNode, resolveIdentifierDefinitionNode } from "./symbol-definitions";
import type { SemanticTokenSpan } from "../shared/semantic-tokens";

function pushSpan(node: Node, out: SemanticTokenSpan[]): void {
    out.push({
        line: node.startPosition.row,
        startChar: node.startPosition.column,
        length: node.endPosition.column - node.startPosition.column,
        tokenType: SemanticTokenTypes.parameter,
        tokenModifiers: 0,
    });
}

function visitBodyForParamRefs(rootNode: Node, node: Node, out: SemanticTokenSpan[]): void {
    if (node.type === SyntaxType.Identifier) {
        const definitionNode = resolveIdentifierDefinitionNode(rootNode, node);
        if (definitionNode && definitionNode !== node && isParameterDefinitionNode(definitionNode)) {
            pushSpan(node, out);
        }
    }

    for (const child of node.children) {
        visitBodyForParamRefs(rootNode, child, out);
    }
}

function collectProcedureParameterReferences(rootNode: Node, procedureNode: Node, out: SemanticTokenSpan[]): void {
    const paramsNode = procedureNode.childForFieldName("params");
    const nameNode = procedureNode.childForFieldName("name");
    if (!paramsNode) {
        return;
    }

    for (const child of procedureNode.children) {
        if (child.type === SyntaxType.ParamList) {
            continue;
        }
        if (
            nameNode &&
            child.type === SyntaxType.Identifier &&
            child.startIndex === nameNode.startIndex &&
            child.endIndex === nameNode.endIndex
        ) {
            continue;
        }
        visitBodyForParamRefs(rootNode, child, out);
    }
}

function collectMacroParameterReferences(rootNode: Node, defineNode: Node, out: SemanticTokenSpan[]): void {
    const paramsNode = defineNode.childForFieldName("params");
    const bodyNode = defineNode.childForFieldName("body");
    if (!paramsNode || !bodyNode) {
        return;
    }

    for (const child of bodyNode.children) {
        visitBodyForParamRefs(rootNode, child, out);
    }
}

function visit(rootNode: Node, node: Node, out: SemanticTokenSpan[]): void {
    if (node.type === SyntaxType.Procedure) {
        collectProcedureParameterReferences(rootNode, node, out);
        return;
    }

    if (node.type === SyntaxType.Define) {
        collectMacroParameterReferences(rootNode, node, out);
        return;
    }

    for (const child of node.children) {
        visit(rootNode, child, out);
    }
}

export function getSemanticTokenSpans(text: string): SemanticTokenSpan[] {
    if (!isInitialized()) {
        return [];
    }

    const tree = parseWithCache(text);
    if (!tree) {
        return [];
    }

    const spans: SemanticTokenSpan[] = [];
    visit(tree.rootNode, tree.rootNode, spans);
    return spans;
}
