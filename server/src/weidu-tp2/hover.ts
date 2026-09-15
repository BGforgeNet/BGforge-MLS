/**
 * Hover functionality for WeiDU TP2 language.
 * Provides hover info for function parameters at call sites; the builders for function
 * and variable symbols live in hover-content.ts.
 */

import { type Hover, type Position, MarkupKind } from "vscode-languageserver/node";
import { isCallableSymbol, type CallableInfo } from "../core/symbol";
import { buildParamInfoMap } from "../shared/jsdoc";
import { parseWithCache, isInitialized } from "../../../shared/parsers/weidu-tp2";
import { type FunctionInfo, parseHeader } from "./header-parser";
import { buildRetsMap } from "./hover-content";
import type { Symbols } from "../core/symbol-index";
import { SyntaxType } from "./syntax-type";
import { stripStringDelimiters } from "./tree-utils";
import { buildSignatureBlock } from "../../../shared/tooltip-format";
import { LANG_WEIDU_TP2_TOOLTIP } from "../core/languages";

/**
 * Get hover info for a function parameter in a function call.
 * Parses text to find function calls and checks if symbol is a parameter name.
 */
export function getFunctionParamHover(
    text: string,
    symbol: string,
    position: Position,
    symbols?: Symbols,
): Hover | null {
    if (!isInitialized()) {
        return null;
    }

    const tree = parseWithCache(text);
    if (!tree) {
        return null;
    }

    // Parse local function definitions as fallback for functions not in the global index
    const localFunctions = parseHeader(text, "");

    // Find function calls and check if symbol is a parameter name
    const result = findParamInFunctionCalls(tree.rootNode, symbol, position, localFunctions, symbols);
    if (!result) {
        return null;
    }

    const { paramType, defaultValue, description, required } = result;

    // Build hover content - hide default value for required params
    const showDefault = defaultValue !== undefined && !required;
    const signature = showDefault ? `${paramType} ${symbol} = ${defaultValue}` : `${paramType} ${symbol}`;

    // Build markdown documentation
    let value = buildSignatureBlock(signature, LANG_WEIDU_TP2_TOOLTIP);
    if (description) {
        value += "\n\n" + description;
    }

    return {
        contents: {
            kind: MarkupKind.Markdown,
            value,
        },
    };
}

/**
 * Find a parameter in function calls within the AST.
 * Returns param info if found, null otherwise.
 * Only returns a match if the position is within the function call node's range.
 */
function findParamInFunctionCalls(
    node: import("web-tree-sitter").Node,
    symbol: string,
    position: Position,
    localFunctions: FunctionInfo[],
    symbols?: Symbols,
): { paramType: string; defaultValue?: string; description?: string; required?: boolean } | null {
    const type = node.type;

    // Check if this is a function call (LAF or LPF)
    if (type === SyntaxType.ActionLaunchFunction || type === SyntaxType.PatchLaunchFunction) {
        // Check if the cursor position is within this function call node's range
        const startPos = node.startPosition;
        const endPos = node.endPosition;

        const isWithinRange =
            position.line >= startPos.row &&
            position.line <= endPos.row &&
            (position.line > startPos.row || position.character >= startPos.column) &&
            (position.line < endPos.row || position.character <= endPos.column);

        if (isWithinRange) {
            const nameNode = node.childForFieldName("name");
            if (nameNode) {
                const funcName = stripStringDelimiters(nameNode.text);

                // Try unified symbol storage first (.tph headers)
                const indexedSymbol = symbols?.lookup(funcName);
                if (indexedSymbol && isCallableSymbol(indexedSymbol) && indexedSymbol.callable.params) {
                    const result = findParamInCallableInfo(indexedSymbol.callable, symbol);
                    if (result) {
                        return result;
                    }
                }

                // Fall back to local definitions (same file)
                const localFunc = localFunctions.find((f) => f.name === funcName);
                if (localFunc?.params) {
                    const result = findParamInFuncInfo(localFunc, symbol);
                    if (result) {
                        return result;
                    }
                }
            }
        }
    }

    // Recurse to children
    for (const child of node.children) {
        const result = findParamInFunctionCalls(child, symbol, position, localFunctions, symbols);
        if (result) {
            return result;
        }
    }

    return null;
}

/**
 * Find a parameter by name in function info.
 * Returns type and default value if found.
 */
function findParamInFuncInfo(
    funcInfo: FunctionInfo,
    symbol: string,
): { paramType: string; defaultValue?: string; description?: string; required?: boolean } | null {
    if (!funcInfo.params) {
        return null;
    }

    const paramInfoMap = buildParamInfoMap(funcInfo.jsdoc);
    const retsMap = buildRetsMap(funcInfo.jsdoc?.rets);
    const info = paramInfoMap.get(symbol);

    // Check INT_VAR
    for (const param of funcInfo.params.intVar) {
        if (param.name === symbol) {
            return {
                paramType: "int",
                defaultValue: param.defaultValue,
                description: info?.description,
                required: info?.required,
            };
        }
    }

    // Check STR_VAR
    for (const param of funcInfo.params.strVar) {
        if (param.name === symbol) {
            return {
                paramType: "string",
                defaultValue: param.defaultValue,
                description: info?.description,
                required: info?.required,
            };
        }
    }

    // Check RET - prefer @return info from rets[], fall back to @param info
    for (const param of funcInfo.params.ret) {
        if (param === symbol) {
            const retInfo = retsMap.get(symbol);
            if (retInfo) {
                return { paramType: retInfo.type, description: retInfo.description };
            }
            return { paramType: "any", description: info?.description, required: info?.required };
        }
    }

    // Check RET_ARRAY - prefer @return-array info from rets[], fall back to @param info
    for (const param of funcInfo.params.retArray) {
        if (param === symbol) {
            const retInfo = retsMap.get(symbol);
            if (retInfo) {
                return { paramType: retInfo.type, description: retInfo.description };
            }
            return { paramType: "array", description: info?.description, required: info?.required };
        }
    }

    return null;
}

/**
 * Find a parameter by name in CallableInfo (from Symbols).
 * CallableInfo.params already has JSDoc data merged (type, description, required).
 */
function findParamInCallableInfo(
    callable: CallableInfo,
    symbol: string,
): { paramType: string; defaultValue?: string; description?: string; required?: boolean } | null {
    if (!callable.params) {
        return null;
    }

    // Check INT_VAR - CallableParam already has JSDoc merged
    for (const param of callable.params.intVar) {
        if (param.name === symbol) {
            return {
                paramType: param.type ?? "int",
                defaultValue: param.defaultValue,
                description: param.description,
                required: param.required,
            };
        }
    }

    // Check STR_VAR
    for (const param of callable.params.strVar) {
        if (param.name === symbol) {
            return {
                paramType: param.type ?? "string",
                defaultValue: param.defaultValue,
                description: param.description,
                required: param.required,
            };
        }
    }

    // Check RET - just names, no JSDoc metadata in params
    for (const name of callable.params.ret) {
        if (name === symbol) {
            return { paramType: "any" };
        }
    }

    // Check RET_ARRAY
    for (const name of callable.params.retArray) {
        if (name === symbol) {
            return { paramType: "array" };
        }
    }

    return null;
}
