import type { Node } from "web-tree-sitter";
import { extractProcedures, findMacroDefinition } from "./utils";
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
                if (nameNode?.text === symbolName) {
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
                if (nameNode?.text === symbolName) {
                    return nameNode;
                }
            }
        }
    } else if (node.type === SyntaxType.ForVarDecl) {
        const nameNode = node.childForFieldName("name");
        if (nameNode?.text === symbolName) {
            return nameNode;
        }
    } else if (node.type === SyntaxType.ForeachStmt) {
        for (const field of ["var", "key", "value"] as const) {
            const fieldNode = node.childForFieldName(field);
            if (fieldNode?.text === symbolName) {
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
    const procedure = extractProcedures(rootNode).get(symbolName)?.node;
    if (procedure) {
        return procedure.childForFieldName("name");
    }

    for (const child of rootNode.children) {
        if (child.type === SyntaxType.ExportDecl) {
            const nameNode = child.childForFieldName("name");
            if (nameNode?.text === symbolName) {
                return nameNode;
            }
        }
    }

    for (const child of rootNode.children) {
        if (child.type === SyntaxType.VariableDecl) {
            for (const varInit of child.children) {
                if (varInit.type === SyntaxType.VarInit) {
                    const nameNode = varInit.childForFieldName("name");
                    if (nameNode?.text === symbolName) {
                        return nameNode;
                    }
                }
            }
        }
    }

    const macroNode = findMacroDefinition(rootNode, symbolName);
    return macroNode?.childForFieldName("name") ?? null;
}

export function isFileScopeDef(rootNode: Node, symbolName: string): boolean {
    return findFileScopeDefinitionNode(rootNode, symbolName) !== null;
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
