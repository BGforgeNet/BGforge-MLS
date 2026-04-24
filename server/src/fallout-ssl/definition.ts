/**
 * Go to Definition for Fallout SSL files.
 * Finds local definitions (procedures, macros, variables) in the current file.
 * Also handles #include directives — navigates to the included file.
 * Returns null if not found locally, allowing fallback to header definitions.
 */

import * as fs from "fs";
import * as path from "path";
import type { Node } from "web-tree-sitter";
import { Location, Position } from "vscode-languageserver/node";
import { uriToPath, pathToUri } from "../common";
import { parseWithCache, isInitialized } from "./parser";
import { SyntaxType } from "./tree-sitter.d";
import { makeRange, findIdentifierNodeAtPosition } from "./utils";
import { resolveIdentifierDefinitionNode } from "./symbol-definitions";

/**
 * Get definition location for the symbol at the given position.
 * Returns null if not found locally (falls back to header definitions).
 */
export function getLocalDefinition(text: string, uri: string, position: Position): Location | null {
    if (!isInitialized()) {
        return null;
    }

    const tree = parseWithCache(text);
    if (!tree) {
        return null;
    }

    const includeResult = tryIncludeDefinition(tree.rootNode, position, uri);
    if (includeResult) {
        return includeResult;
    }

    const symbolNode = findIdentifierNodeAtPosition(tree.rootNode, position);
    if (!symbolNode) {
        return null;
    }

    const definitionNode = resolveIdentifierDefinitionNode(tree.rootNode, symbolNode);
    if (!definitionNode) {
        return null;
    }

    return {
        uri,
        range: makeRange(definitionNode),
    };
}

/**
 * Try to resolve an #include directive at the given position to the included file.
 */
function tryIncludeDefinition(root: Node, position: Position, uri: string): Location | null {
    const node = root.descendantForPosition({ row: position.line, column: position.character });
    if (!node) {
        return null;
    }

    // Walk up to find an include node
    let current: Node | null = node;
    while (current && current.type !== SyntaxType.Include) {
        current = current.parent;
    }
    if (!current) {
        return null;
    }

    const pathNode = current.childForFieldName("path");
    if (!pathNode || pathNode.type !== SyntaxType.String) {
        return null;
    }

    // Only trigger when cursor is on the path string, not the #include keyword
    const ps = pathNode.startPosition;
    const pe = pathNode.endPosition;
    if (
        position.line < ps.row ||
        position.line > pe.row ||
        (position.line === ps.row && position.character < ps.column) ||
        (position.line === pe.row && position.character >= pe.column)
    ) {
        return null;
    }

    // Strip delimiters: "file.h" -> file.h, <file.h> -> file.h
    const raw = pathNode.text;
    const includePath = raw.replace(/^["<]|[">]$/g, "");
    if (!includePath) {
        return null;
    }

    const currentFilePath = uriToPath(uri);
    const currentDir = path.dirname(currentFilePath);
    const resolvedPath = path.resolve(currentDir, includePath);

    if (!fs.existsSync(resolvedPath)) {
        return null;
    }

    return {
        uri: pathToUri(resolvedPath),
        range: {
            start: { line: 0, character: 0 },
            end: { line: 0, character: 0 },
        },
    };
}
