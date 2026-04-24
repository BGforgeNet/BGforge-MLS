/**
 * Shared utilities for Fallout SSL symbol extraction.
 * Used by both local-symbols.ts (document scope) and header-parser.ts (workspace scope).
 */

import type { Node } from "web-tree-sitter";
import { CompletionItemKind, MarkupKind, Position } from "vscode-languageserver/node";
import { LANG_FALLOUT_SSL_TOOLTIP } from "../core/languages";
import { makeRange } from "../core/position-utils";
import {
    type CallableSymbol,
    type ConstantSymbol,
    type IndexedSymbol,
    type VariableSymbol,
    ScopeLevel,
    SourceType,
    SymbolKind,
} from "../core/symbol";
import * as jsdoc from "../shared/jsdoc";
import type { SigInfoEx } from "../shared/signature";
import { buildSignatureBlock } from "../../../shared/tooltip-format";
import { jsdocToMarkdown } from "./jsdoc-format";
import {
    type MacroData,
    parseMacroParams,
    buildMacroTooltip,
    buildMacroCompletion,
    buildSignatureHelp,
} from "./macro-utils";
import { SyntaxType } from "./tree-sitter.d";

// Re-export for existing consumers
export { makeRange };

/** Parameter data extracted from AST. */
interface ParamInfo {
    name: string;
    defaultValue?: string;
}

function isSimpleParamDefault(node: Node): boolean {
    switch (node.type) {
        case SyntaxType.ParamDefault: {
            if (node.hasError || node.namedChildren.length !== 1) {
                return false;
            }
            const [inner] = node.namedChildren;
            return inner !== undefined && isSimpleParamDefault(inner);
        }
        case SyntaxType.ParamDefaultGroup: {
            if (node.hasError || node.namedChildren.length !== 1) {
                return false;
            }
            const [inner] = node.namedChildren;
            return inner !== undefined && isSimpleParamDefault(inner);
        }
        case SyntaxType.ParamDefaultUnary: {
            if (node.hasError) {
                return false;
            }
            const expr = node.childForFieldName("expr");
            return expr ? isSimpleParamDefault(expr) : false;
        }
        case SyntaxType.Identifier:
        case SyntaxType.Number:
        case SyntaxType.Boolean:
        case SyntaxType.String:
            return true;
        case SyntaxType.ParenExpr: {
            const inner = node.namedChildren[0];
            return inner ? isSimpleParamDefault(inner) : false;
        }
        case SyntaxType.UnaryExpr: {
            const expr = node.childForFieldName("expr");
            return expr ? isSimpleParamDefault(expr) : false;
        }
        default:
            return false;
    }
}

/**
 * Extract parameters with default values from a procedure/forward node.
 * Parses "variable x = 0" to { name: "x", defaultValue: "0" }.
 */
export function extractParams(procNode: Node): ParamInfo[] {
    const params = procNode.childForFieldName("params");
    if (!params) return [];

    const result: ParamInfo[] = [];
    for (const child of params.children) {
        if (child.type === SyntaxType.Param) {
            const nameNode = child.childForFieldName("name");
            const defaultNode = child.childForFieldName("default");
            if (nameNode) {
                result.push({
                    name: nameNode.text,
                    defaultValue: defaultNode && isSimpleParamDefault(defaultNode) ? defaultNode.text : undefined,
                });
            }
        }
    }
    return result;
}

import { type SignatureParam, formatSignature } from "../../../shared/signature-format";

/**
 * Build procedure signature string from AST params, enriched with optional JSDoc.
 * AST params are the source of truth; JSDoc only adds types and return info.
 */
function buildProcedureSignature(name: string, params: ParamInfo[], parsed: jsdoc.JSdoc | null): string {
    // Always build from AST params, enrich with JSDoc types; use "var" for untyped params
    const sigParams: SignatureParam[] = params.map((p, idx) => ({
        name: p.name,
        type: parsed?.args[idx]?.type ?? "var",
        defaultValue: p.defaultValue,
    }));

    let prefix = "procedure ";
    if (parsed?.ret) {
        prefix = `${parsed.ret.type} `;
    } else if (parsed) {
        prefix = "void ";
    }

    return formatSignature({ name, prefix, params: sigParams });
}

/**
 * Build base tooltip content: signature block + optional file path + optional JSDoc
 * + optional engine doc (for engine procedures).
 * Shared by procedures and macros.
 * Used by: hover (contents.value), completion (documentation.value), header symbols.
 */
export function buildTooltipBase(
    signature: string,
    jsdocData: jsdoc.JSdoc | null,
    filePath?: string,
    engineDoc?: string,
): string {
    let markdown = buildSignatureBlock(signature, LANG_FALLOUT_SSL_TOOLTIP, filePath);
    if (jsdocData) {
        markdown += jsdocToMarkdown(jsdocData);
    }
    if (engineDoc) {
        if (jsdocData) {
            // Separate engine doc from user JSDoc with a horizontal rule.
            markdown += "\n\n---\n\n";
        } else {
            // No user JSDoc — still need a blank line after the closing code fence.
            markdown += "\n\n";
        }
        markdown += engineDoc;
    }
    return markdown;
}

/**
 * Find doc comment immediately preceding a node.
 * Comments are siblings in the tree.
 */
export function findPrecedingDocComment(root: Node, defNode: Node): string | null {
    const defLine = defNode.startPosition.row;

    for (const node of root.children) {
        if (node.type === SyntaxType.Comment) {
            const text = node.text;
            if (!text.startsWith("/**")) {
                continue;
            }
            const commentEndLine = node.endPosition.row;
            if (commentEndLine === defLine - 1 || commentEndLine === defLine) {
                return text;
            }
        }
    }
    return null;
}

/**
 * Extract all procedures from root, deduplicating by name.
 * Definition takes precedence over forward declaration.
 * Returns Map<name, { node, isForward }>.
 */
export function extractProcedures(root: Node): Map<string, { node: Node; isForward: boolean }> {
    const procedures = new Map<string, { node: Node; isForward: boolean }>();

    for (const node of root.children) {
        if (node.type === SyntaxType.Procedure) {
            const nameNode = node.childForFieldName("name");
            if (nameNode) {
                // Definition always wins
                procedures.set(nameNode.text, { node, isForward: false });
            }
        } else if (node.type === SyntaxType.ProcedureForward) {
            const nameNode = node.childForFieldName("name");
            if (nameNode && !procedures.has(nameNode.text)) {
                // Only add forward if definition doesn't exist
                procedures.set(nameNode.text, { node, isForward: true });
            }
        }
    }

    return procedures;
}

/**
 * Find a procedure by name, preferring definition over forward.
 */
export function findProcedure(root: Node, symbol: string): Node | null {
    const procedures = extractProcedures(root);
    const proc = procedures.get(symbol);
    return proc?.node ?? null;
}

/**
 * Find the identifier at the given position.
 * Used by go-to-definition and rename.
 */
export function findIdentifierAtPosition(root: Node, position: Position): string | null {
    const node = findIdentifierNodeAtPosition(root, position);
    return node?.text ?? null;
}

/**
 * Find the identifier node at the given position.
 * Returns the full Node object for access to position information.
 */
export function findIdentifierNodeAtPosition(root: Node, position: Position): Node | null {
    function visit(node: Node): Node | null {
        const startRow = node.startPosition.row;
        const endRow = node.endPosition.row;
        const startCol = node.startPosition.column;
        const endCol = node.endPosition.column;

        const inRange =
            (position.line > startRow || (position.line === startRow && position.character >= startCol)) &&
            (position.line < endRow || (position.line === endRow && position.character <= endCol));

        if (!inRange) {
            return null;
        }

        if (node.type === SyntaxType.Identifier) {
            return node;
        }

        for (const child of node.children) {
            const result = visit(child);
            if (result) return result;
        }

        return null;
    }

    return visit(root);
}

/**
 * Find the definition node for a symbol by name.
 * Handles: procedures, forward declarations, macros, variables, exports, params, for-loop vars, foreach vars.
 * Prefers procedure definitions over forward declarations.
 */
export function findDefinitionNode(root: Node, symbol: string): Node | null {
    // Check procedures first (with deduplication)
    const procedures = extractProcedures(root);
    const proc = procedures.get(symbol);
    if (proc) {
        return proc.node;
    }

    // Check macros
    const macroNode = findMacroDefinition(root, symbol);
    if (macroNode) {
        return macroNode;
    }

    // Check inside procedures for params and local vars
    function search(node: Node): Node | null {
        if (node.type === SyntaxType.Procedure) {
            // Check parameters
            const params = node.childForFieldName("params");
            if (params) {
                for (const child of params.children) {
                    if (child.type === SyntaxType.Param) {
                        const paramName = child.childForFieldName("name");
                        if (paramName?.text === symbol) {
                            return child;
                        }
                    }
                }
            }
            // Check inside procedure body
            for (const child of node.children) {
                const result = search(child);
                if (result) return result;
            }
        } else if (node.type === SyntaxType.VariableDecl) {
            for (const child of node.children) {
                if (child.type === SyntaxType.VarInit) {
                    const nameNode = child.childForFieldName("name");
                    if (nameNode?.text === symbol) {
                        return child;
                    }
                }
            }
        } else if (node.type === SyntaxType.ForVarDecl) {
            const nameNode = node.childForFieldName("name");
            if (nameNode?.text === symbol) {
                return node;
            }
        } else if (node.type === SyntaxType.ForeachStmt) {
            const varNode = node.childForFieldName("var");
            if (varNode?.text === symbol) {
                return varNode;
            }
            const keyNode = node.childForFieldName("key");
            if (keyNode?.text === symbol) {
                return keyNode;
            }
            const valueNode = node.childForFieldName("value");
            if (valueNode?.text === symbol) {
                return valueNode;
            }
        } else if (node.type === SyntaxType.ExportDecl) {
            const nameNode = node.childForFieldName("name");
            if (nameNode?.text === symbol) {
                return node;
            }
        }
        return null;
    }

    for (const node of root.children) {
        const result = search(node);
        if (result) return result;
    }

    return null;
}

/**
 * Check if a symbol is defined locally.
 * Reuses findDefinitionNode for consistency.
 */
export function isLocalDefinition(root: Node, symbol: string): boolean {
    return findDefinitionNode(root, symbol) !== null;
}

/**
 * Extract all macros from tree-sitter AST.
 * Returns MacroData objects with name, params, body, jsdoc, etc.
 */
export function extractMacros(root: Node): MacroData[] {
    const macros: MacroData[] = [];

    /**
     * Extract a macro from a Define node.
     * The body may be a proper macro_body node (parsed successfully) or absent
     * (when the body contains SSL keywords that cause parse errors).
     */
    function extractFromDefine(defineNode: Node, parentNode: Node): void {
        const nameNode = defineNode.childForFieldName("name");
        const paramsNode = defineNode.childForFieldName("params");
        const bodyNode = defineNode.childForFieldName("body");

        if (!nameNode) return;

        const name = nameNode.text;
        const bodyText = bodyNode?.text || "";

        let params: string[] | undefined;
        let hasParams = false;
        const actualBody = bodyText.trimStart();

        if (paramsNode) {
            params = parseMacroParams(paramsNode.text);
            hasParams = true;
        }

        const multiline = actualBody.includes("\n");
        const firstline = multiline ? (actualBody.split("\n")[0] || "").trim() : actualBody.trim();

        const docComment = findPrecedingDocComment(root, parentNode);
        const parsedJsdoc = docComment ? jsdoc.parse(docComment) : undefined;

        macros.push({
            name,
            params,
            hasParams,
            body: actualBody.trim(),
            firstline,
            multiline,
            jsdoc: parsedJsdoc,
            node: defineNode,
        });
    }

    /**
     * Fallback: extract macro from an ERROR node that contains #define children.
     * This happens when the macro body confuses the parser, e.g., `call(F(X,Y))`
     * where `call` is misinterpreted as the SSL keyword followed by `(`.
     * We recover the macro name and params from the ERROR's children.
     */
    function extractFromError(errorNode: Node, parentNode: Node): void {
        const children = errorNode.children;
        let hasDefineKeyword = false;
        let nameNode: Node | null = null;
        let paramsNode: Node | null = null;
        let bodyStartIdx = -1;

        for (let i = 0; i < children.length; i++) {
            const child = children[i]!;
            if (child.text === "#define" || child.type === "#define") {
                hasDefineKeyword = true;
                continue;
            }
            if (hasDefineKeyword && !nameNode && child.type === SyntaxType.Identifier) {
                nameNode = child;
                continue;
            }
            if (hasDefineKeyword && nameNode && !paramsNode && child.type === SyntaxType.MacroParams) {
                paramsNode = child;
                continue;
            }
            if (hasDefineKeyword && nameNode) {
                bodyStartIdx = i;
                break;
            }
        }

        if (!hasDefineKeyword || !nameNode) return;

        const name = nameNode.text;
        let params: string[] | undefined;
        let hasParams = false;

        if (paramsNode) {
            params = parseMacroParams(paramsNode.text);
            hasParams = true;
        }

        // Reconstruct body text from remaining children using byte offsets.
        // Column-based offsets break for multiline ERROR nodes because column
        // resets to 0 on each line. Byte offsets (startIndex/endIndex) are absolute.
        let bodyText = "";
        if (bodyStartIdx >= 0) {
            const firstChild = children[bodyStartIdx]!;
            const lastChild = children[children.length - 1]!;
            const errorText = errorNode.text;
            const errorStartByte = errorNode.startIndex;
            const bodyOffset = firstChild.startIndex - errorStartByte;
            const bodyEnd = lastChild.endIndex - errorStartByte;
            bodyText = errorText.substring(bodyOffset, bodyEnd).trim();
        }

        const multiline = bodyText.includes("\n");
        const firstline = multiline ? (bodyText.split("\n")[0] || "").trim() : bodyText.trim();

        const docComment = findPrecedingDocComment(root, parentNode);
        const parsedJsdoc = docComment ? jsdoc.parse(docComment) : undefined;

        macros.push({
            name,
            params,
            hasParams,
            body: bodyText,
            firstline,
            multiline,
            jsdoc: parsedJsdoc,
            node: errorNode,
        });
    }

    function visit(node: Node) {
        if (node.type === SyntaxType.Preprocessor) {
            for (const child of node.children) {
                if (child.type === SyntaxType.Define) {
                    extractFromDefine(child, node);
                }
            }
        }

        // Fallback: ERROR nodes at top level may contain collapsed #define directives
        if (node.type === "ERROR" && node.parent?.type === SyntaxType.SourceFile) {
            extractFromError(node, node);
        }

        for (const child of node.children) {
            visit(child);
        }
    }

    visit(root);
    return macros;
}

/**
 * Find macro definition by name.
 * Returns the 'define' node or null.
 */
export function findMacroDefinition(root: Node, symbol: string): Node | null {
    let result: Node | null = null;

    function visit(node: Node) {
        if (result) return;

        if (node.type === SyntaxType.Preprocessor) {
            for (const child of node.children) {
                if (child.type === SyntaxType.Define) {
                    const nameNode = child.childForFieldName("name");
                    if (nameNode?.text === symbol) {
                        result = child;
                        return;
                    }
                }
            }
        }

        for (const child of node.children) {
            visit(child);
        }
    }

    visit(root);
    return result;
}

/** Options for buildProcedureSymbol. */
interface BuildProcedureSymbolOptions {
    /** Workspace-relative path shown in hover/completion (used by header-parser.ts). */
    readonly displayPath?: string;
    /** Built-in engine doc appended after user JSDoc (used for engine procedures). */
    readonly engineDoc?: string;
}

/**
 * Build a CallableSymbol for a procedure definition.
 *
 * When `displayPath` is provided, builds a workspace-scoped symbol with the path
 * shown in hover and completion labelDetails (used by header-parser.ts).
 * When omitted, builds a file-scoped symbol for in-document use (used by local-symbols.ts).
 */
export function buildProcedureSymbol(
    name: string,
    uri: string,
    node: Node,
    astParams: ParamInfo[],
    parsed: jsdoc.JSdoc | null,
    options: BuildProcedureSymbolOptions = {},
): CallableSymbol {
    const { displayPath, engineDoc } = options;
    const range = makeRange(node);
    const sig = buildProcedureSignature(name, astParams, parsed);
    const hoverValue = buildTooltipBase(sig, parsed, displayPath, engineDoc);

    const hoverContents = {
        kind: MarkupKind.Markdown,
        value: hoverValue,
    };

    const sigHelp: SigInfoEx | undefined =
        astParams.length > 0 ? buildSignatureHelp(name, astParams, parsed, uri) : undefined;

    const isWorkspace = displayPath !== undefined;

    return {
        name,
        kind: SymbolKind.Procedure,
        location: { uri, range },
        scope: { level: isWorkspace ? ScopeLevel.Workspace : ScopeLevel.File },
        source: isWorkspace ? { type: SourceType.Workspace, uri, displayPath } : { type: SourceType.Document, uri },
        completion: {
            label: name,
            kind: CompletionItemKind.Function,
            ...(isWorkspace && { labelDetails: { description: displayPath } }),
            documentation: hoverContents,
        },
        hover: { contents: hoverContents },
        signature: sigHelp,
        callable: {
            parameters: astParams.map((p) => {
                const jsdocArg = parsed?.args.find((a) => a.name === p.name);
                return {
                    name: p.name,
                    type: jsdocArg?.type,
                    description: jsdocArg?.description,
                    defaultValue: p.defaultValue,
                };
            }),
        },
    };
}

/**
 * Build an IndexedSymbol for a macro definition (callable or constant).
 *
 * Macros with parameters become CallableSymbol; without become ConstantSymbol.
 * When `displayPath` is provided, builds a workspace-scoped symbol (header-parser.ts).
 * When omitted, builds a file-scoped symbol (local-symbols.ts).
 */
export function buildMacroSymbol(macro: MacroData, uri: string, displayPath?: string): IndexedSymbol {
    const location = macro.node ? { uri, range: makeRange(macro.node) } : null;

    const hoverContents = {
        kind: MarkupKind.Markdown,
        value: buildMacroTooltip(macro, displayPath ?? ""),
    };
    const completionItem = buildMacroCompletion(macro, uri, displayPath ?? "");

    // Variadic macros always get signature help, enriched with JSDoc if available
    const sig =
        macro.hasParams && macro.params
            ? buildSignatureHelp(
                  macro.name,
                  macro.params.map((name) => ({ name })),
                  macro.jsdoc ?? null,
                  uri,
              )
            : undefined;

    const isWorkspace = displayPath !== undefined;

    const base = {
        name: macro.name,
        location,
        scope: { level: isWorkspace ? ScopeLevel.Workspace : ScopeLevel.File },
        source: isWorkspace ? { type: SourceType.Workspace, uri, displayPath } : { type: SourceType.Document, uri },
        completion: completionItem,
        hover: { contents: hoverContents },
        signature: sig,
    };

    if (macro.hasParams) {
        return {
            ...base,
            kind: SymbolKind.Macro,
            callable: { parameters: macro.params?.map((p) => ({ name: p })) },
        } as CallableSymbol;
    }

    return {
        ...base,
        kind: SymbolKind.Constant,
        constant: { value: macro.firstline ?? "" },
    } as ConstantSymbol;
}

/**
 * Build a VariableSymbol from a variable or export declaration.
 *
 * When `displayPath` is provided, builds a workspace-scoped symbol with the path
 * shown in hover and completion labelDetails (used by header-parser.ts).
 * When omitted, builds a file-scoped symbol for in-document use (used by local-symbols.ts).
 */
export function buildVariableSymbol(
    name: string,
    uri: string,
    range: { start: { line: number; character: number }; end: { line: number; character: number } },
    description?: string,
    parsed?: jsdoc.JSdoc | null,
    displayPath?: string,
): VariableSymbol {
    const sigText = parsed?.type
        ? `${parsed.type} ${name}`
        : description
          ? `${description} ${name}`
          : `variable ${name}`;
    let hoverValue = buildSignatureBlock(sigText, LANG_FALLOUT_SSL_TOOLTIP, displayPath);

    if (description) {
        hoverValue += "\n\n" + description;
    }
    if (parsed?.desc) {
        hoverValue += "\n\n" + parsed.desc;
    }

    const hoverContents = {
        kind: MarkupKind.Markdown,
        value: hoverValue,
    };

    const isWorkspace = displayPath !== undefined;

    return {
        name,
        kind: SymbolKind.Variable,
        location: { uri, range },
        scope: { level: isWorkspace ? ScopeLevel.Workspace : ScopeLevel.File },
        source: isWorkspace ? { type: SourceType.Workspace, uri, displayPath } : { type: SourceType.Document, uri },
        completion: {
            label: name,
            kind: CompletionItemKind.Variable,
            ...(isWorkspace && {
                labelDetails: { description: displayPath },
                documentation: hoverContents,
            }),
        },
        hover: { contents: hoverContents },
        variable: {
            description: parsed?.desc ?? description,
        },
    };
}
