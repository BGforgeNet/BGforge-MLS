import type { Node } from "web-tree-sitter";
import type { Symbols } from "../core/symbol-index";
import { extractProcedures, findMacroDefinition } from "./utils";
import { sslMapGet, sslNamesEqual } from "../../../shared/fallout-ssl-names";
import { SyntaxType } from "./syntax-type";

/**
 * Walk ancestors to find the containing procedure node.
 * Returns null if the node is not inside a procedure.
 */
export function findContainingProcedure(node: Node): Node | null {
    let current: Node | null = node.parent;
    while (current) {
        if (current.type === SyntaxType.Procedure) {
            return current;
        }
        current = current.parent;
    }
    return null;
}

/** Walk ancestors to find the nearest containing Define node, or null if not inside a #define. */
export function findContainingDefine(node: Node): Node | null {
    let current: Node | null = node.parent;
    while (current) {
        if (current.type === SyntaxType.Define) {
            return current;
        }
        current = current.parent;
    }
    return null;
}

/**
 * Find the identifier node in a Define's params that matches symbolName.
 * Returns null if the define has no params or if the name is not among them.
 *
 * Matched exactly, where every other resolver in this file folds case: a macro parameter is substituted by the
 * preprocessor, which distinguishes case even though SSL itself does not.
 */
export function findMacroParamDefinitionNode(defineNode: Node, symbolName: string): Node | null {
    const params = defineNode.childForFieldName("params");
    if (!params) {
        return null;
    }

    for (const child of params.children) {
        if (child.type === SyntaxType.Identifier && child.text === symbolName) {
            return child;
        }
    }

    return null;
}

export function isParameterDefinitionNode(node: Node): boolean {
    const parentType = node.parent?.type;
    return parentType === SyntaxType.Param || parentType === SyntaxType.MacroParams;
}

function findProcedureLocalDefinitionNode(procedureNode: Node, symbolName: string): Node | null {
    const params = procedureNode.childForFieldName("params");
    if (params) {
        for (const child of params.children) {
            if (child.type === SyntaxType.Param) {
                const nameNode = child.childForFieldName("name");
                if (sslNamesEqual(nameNode?.text, symbolName)) {
                    return nameNode;
                }
            }
        }
    }

    return searchProcBody(procedureNode, symbolName);
}

/**
 * Check if a procedure defines a symbol as a procedure-local construct:
 * parameters, variable declarations, for loop vars, foreach vars.
 * Does NOT match the procedure's own name (that's file-scoped).
 */
export function isLocalToProc(procedureNode: Node, symbolName: string): boolean {
    return findProcedureLocalDefinitionNode(procedureNode, symbolName) !== null;
}

function searchProcBody(node: Node, symbolName: string): Node | null {
    if (node.type === SyntaxType.VariableDecl) {
        for (const child of node.children) {
            if (child.type === SyntaxType.VarInit) {
                const nameNode = child.childForFieldName("name");
                if (sslNamesEqual(nameNode?.text, symbolName)) {
                    return nameNode;
                }
            }
        }
    } else if (node.type === SyntaxType.ForVarDecl) {
        const nameNode = node.childForFieldName("name");
        if (sslNamesEqual(nameNode?.text, symbolName)) {
            return nameNode;
        }
    } else if (node.type === SyntaxType.ForeachStmt) {
        for (const field of ["var", "key", "value"] as const) {
            const fieldNode = node.childForFieldName(field);
            if (sslNamesEqual(fieldNode?.text, symbolName)) {
                return fieldNode;
            }
        }
    }

    for (const child of node.children) {
        const result = searchProcBody(child, symbolName);
        if (result) {
            return result;
        }
    }
    return null;
}

/**
 * Check if a symbol is defined at file scope: procedure names, forward
 * declarations, macros, exports.
 */
export function findFileScopeDefinitionNode(rootNode: Node, symbolName: string): Node | null {
    const procedure = sslMapGet(extractProcedures(rootNode), symbolName)?.node;
    if (procedure) {
        return procedure.childForFieldName("name");
    }

    for (const child of rootNode.children) {
        if (child.type === SyntaxType.ExportDecl) {
            const nameNode = child.childForFieldName("name");
            if (sslNamesEqual(nameNode?.text, symbolName)) {
                return nameNode;
            }
        }
    }

    for (const child of rootNode.children) {
        if (child.type === SyntaxType.VariableDecl) {
            for (const varInit of child.children) {
                if (varInit.type === SyntaxType.VarInit) {
                    const nameNode = varInit.childForFieldName("name");
                    if (sslNamesEqual(nameNode?.text, symbolName)) {
                        return nameNode;
                    }
                }
            }
        }
    }

    const macroNode = findMacroDefinition(rootNode, symbolName);
    return macroNode?.childForFieldName("name") ?? null;
}

/**
 * The rival-definition rule: a file OTHER than a symbol's own definition file that defines the same name at
 * file scope holds a rival symbol, not a reference - find-references must not report its occurrences and
 * rename must not rewrite them. SSL binds these names per file, so two scripts may each own a `start`.
 *
 * The rule has two oracles, deliberately, and both live here so they are read and changed together:
 *
 * - `isFileScopeDef` asks a PARSED TREE. Exact, and current for an unsaved buffer, but it costs a parse - so
 *   it is for a caller that already holds the tree (rename parses every candidate anyway).
 * - `rivalDefinitionUris` asks the WORKSPACE INDEX. Answers for the whole workspace without parsing anything,
 *   which is the only affordable oracle for find-references; it lags an unsaved edit until the file is
 *   re-indexed.
 *
 * Forcing one oracle on both would mean either parsing the workspace on every find-references or dropping
 * rename's accuracy on the buffer being edited, so the split stays - but the rule itself is defined once.
 */
export function isFileScopeDef(rootNode: Node, symbolName: string): boolean {
    return findFileScopeDefinitionNode(rootNode, symbolName) !== null;
}

/**
 * The rival-definition rule over the workspace index: URIs other than `ownUri` that define `name` at file
 * scope. The index holds exactly SSL's file-scope constructs (procedures, macros, top-level variables,
 * exports); procedure-locals live in the per-document index and never appear here. See `isFileScopeDef` for
 * the rule and why there are two oracles.
 */
export function rivalDefinitionUris(symbols: Symbols, name: string, ownUri: string): Set<string> {
    const uris = new Set<string>();
    for (const symbol of symbols.lookupAll(name)) {
        if (symbol.location && symbol.location.uri !== ownUri) uris.add(symbol.location.uri);
    }
    return uris;
}

export function resolveIdentifierDefinitionNode(rootNode: Node, identifierNode: Node): Node | null {
    const symbolName = identifierNode.text;

    const containingDefine = findContainingDefine(identifierNode);
    if (containingDefine) {
        const macroParam = findMacroParamDefinitionNode(containingDefine, symbolName);
        if (macroParam) {
            return macroParam;
        }
    }

    const containingProc = findContainingProcedure(identifierNode);
    if (containingProc) {
        const local = findProcedureLocalDefinitionNode(containingProc, symbolName);
        if (local) {
            return local;
        }
    }

    return findFileScopeDefinitionNode(rootNode, symbolName);
}
