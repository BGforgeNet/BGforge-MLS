/**
 * Document symbol provider for WeiDU TP2 files.
 * Extracts function/macro definitions (with body variables as children)
 * and file-level variables. Two-level nesting max: global symbols and
 * their direct children.
 */

import { DocumentSymbol, SymbolKind } from "vscode-languageserver/node";
import type { Node } from "web-tree-sitter";
import { makeRange } from "../core/position-utils";
import { parseWithCache, isInitialized } from "../../../shared/parsers/weidu-tp2";
import { isFunctionDef } from "@bgforge/format";
import { looksLikeConstant } from "./tree-utils";
import { SyntaxType } from "./tree-sitter.d";

/** Macro definition types (subset of function defs). */
const MACRO_DEF_TYPES: ReadonlySet<string> = new Set([SyntaxType.ActionDefineMacro, SyntaxType.ActionDefinePatchMacro]);

/** Array definition types — shown with Array icon in outline. */
const ARRAY_DEF_TYPES: ReadonlySet<string> = new Set([
    SyntaxType.ActionDefineArray,
    SyntaxType.ActionDefineAssociativeArray,
    SyntaxType.PatchDefineArray,
    SyntaxType.PatchDefineAssociativeArray,
]);

/** File-level variable assignment types and how to extract the variable name. */
const FILE_LEVEL_VAR_TYPES: ReadonlySet<string> = new Set([
    SyntaxType.ActionOuterSet,
    SyntaxType.ActionOuterSprint,
    SyntaxType.ActionOuterSprintf,
    SyntaxType.ActionOuterTextSprint,
    SyntaxType.ActionDefineArray,
    SyntaxType.ActionDefineAssociativeArray,
    SyntaxType.ActionForEach,
]);

/** File-level loop types that introduce two variables (key + value). */
const FILE_LEVEL_LOOP_TYPES: ReadonlySet<string> = new Set([SyntaxType.ActionPhpEach]);

/** Types using varNodes (array) to hold the variable name. */
const VAR_NODES_TYPES: ReadonlySet<string> = new Set([
    SyntaxType.ActionOuterSet,
    SyntaxType.PatchSet,
    SyntaxType.PatchAssignment,
    SyntaxType.LocalSet,
    SyntaxType.PatchReadByte,
    SyntaxType.PatchReadShort,
    SyntaxType.PatchReadLong,
]);

/** Types using nameNode to hold the variable name. */
const NAME_NODE_TYPES: ReadonlySet<string> = new Set([
    SyntaxType.ActionDefineArray,
    SyntaxType.ActionDefineAssociativeArray,
    SyntaxType.PatchDefineArray,
    SyntaxType.PatchDefineAssociativeArray,
]);

/**
 * All variable-assigning node types that can appear in function/macro bodies.
 * Action bodies use OUTER_SET/OUTER_SPRINT/etc., patch bodies use SET/SPRINT/etc.,
 * macro bodies additionally allow LOCAL_SET/LOCAL_SPRINT.
 */
const BODY_VAR_TYPES: ReadonlySet<string> = new Set([
    // Patch-level (patch function/macro bodies)
    SyntaxType.PatchSet,
    SyntaxType.PatchAssignment,
    SyntaxType.PatchSprint,
    SyntaxType.PatchSprintf,
    SyntaxType.PatchTextSprint,
    SyntaxType.PatchDefineArray,
    SyntaxType.PatchDefineAssociativeArray,
    SyntaxType.PatchForEach,
    SyntaxType.PatchReadByte,
    SyntaxType.PatchReadShort,
    SyntaxType.PatchReadLong,
    SyntaxType.PatchReadAscii,
    SyntaxType.PatchReadStrref,
    SyntaxType.PatchRead_2daEntriesNow,
    SyntaxType.PatchRead_2daEntry,
    SyntaxType.PatchRead_2daEntryFormer,
    // Action-level (action function/macro bodies)
    SyntaxType.ActionOuterSet,
    SyntaxType.ActionOuterSprint,
    SyntaxType.ActionOuterSprintf,
    SyntaxType.ActionOuterTextSprint,
    SyntaxType.ActionDefineArray,
    SyntaxType.ActionDefineAssociativeArray,
    SyntaxType.ActionForEach,
    // Macro-only (LOCAL_SET/LOCAL_SPRINT at top of macro bodies)
    SyntaxType.LocalSet,
    SyntaxType.LocalSprint,
]);

/** Loop types that introduce two variables (key + value) in function/macro bodies. */
const BODY_LOOP_TYPES: ReadonlySet<string> = new Set([SyntaxType.PatchPhpEach, SyntaxType.ActionPhpEach]);

/**
 * Extract the first Identifier node from a varNodes array field.
 * Skips dynamic EVAL/ArrayAccess entries that can't produce a meaningful symbol name.
 */
function firstIdentifierFromVarNodes(node: Node): Node | null {
    const varNodes = node.childrenForFieldName("var");
    for (const v of varNodes) {
        if (v.type === SyntaxType.Identifier) {
            return v;
        }
    }
    return null;
}

/**
 * Determine SymbolKind for a variable-assigning node.
 * Arrays → Array, constant-like names → Constant, rest → Variable.
 * Constant heuristic: first word fully uppercase (see tree-utils.ts:looksLikeConstant,
 * weidu-tp2.tmLanguage.yml:set-sprint-constant-vars, hover.ts:buildVariableHover).
 */
function varSymbolKind(nodeType: string, name: string): SymbolKind {
    if (ARRAY_DEF_TYPES.has(nodeType)) return SymbolKind.Array;
    if (looksLikeConstant(name)) return SymbolKind.Constant;
    return SymbolKind.Variable;
}

/** Create a DocumentSymbol for a variable, or null if the name is empty. */
function makeVarSymbol(node: Node, nameNode: Node, detail?: string): DocumentSymbol | null {
    const name = nameNode.text;
    if (!name) return null;
    return {
        name,
        detail,
        kind: varSymbolKind(node.type, name),
        range: makeRange(node),
        selectionRange: makeRange(nameNode),
    };
}

/** Extract variable name node from a variable-assigning node. */
function extractVarNameNode(node: Node): Node | null {
    if (VAR_NODES_TYPES.has(node.type)) {
        return firstIdentifierFromVarNodes(node);
    }
    if (NAME_NODE_TYPES.has(node.type)) {
        return node.childForFieldName("name");
    }
    // All other var types use the "var" field (singular)
    return node.childForFieldName("var");
}

/**
 * Extract file-level variable symbols from a node, recursing into children.
 * TP2 variables are global — assignments inside conditionals/loops are still file-level.
 * Skips function/macro definitions (those have their own scope via collectBodyVars).
 * Uses `seen` set to deduplicate — only the first occurrence of each variable is collected.
 */
function extractFileLevelVars(node: Node, seen: Set<string>): DocumentSymbol[] {
    const results: DocumentSymbol[] = [];

    // Skip variable extraction from error-recovery nodes — tree-sitter can wrap garbage
    // text in valid-looking node types (e.g. patch_assignment) with hasError set.
    // Still recurse into children: a parent ACTION_IF may have errors but contain valid vars.
    if (!node.hasError && FILE_LEVEL_VAR_TYPES.has(node.type)) {
        const nameNode = extractVarNameNode(node);
        if (nameNode && nameNode.text && !seen.has(nameNode.text)) {
            seen.add(nameNode.text);
            const sym = makeVarSymbol(node, nameNode);
            if (sym) results.push(sym);
        }
    } else if (!node.hasError && FILE_LEVEL_LOOP_TYPES.has(node.type)) {
        const keyNode = node.childForFieldName("key_var");
        const valueNode = node.childForFieldName("value_var");
        if (keyNode && keyNode.text && !seen.has(keyNode.text)) {
            seen.add(keyNode.text);
            const sym = makeVarSymbol(node, keyNode);
            if (sym) results.push(sym);
        }
        if (valueNode && valueNode.text && !seen.has(valueNode.text)) {
            seen.add(valueNode.text);
            const sym = makeVarSymbol(node, valueNode);
            if (sym) results.push(sym);
        }
    }

    // Recurse into children, skipping function/macro definitions (separate scope).
    for (const child of node.children) {
        if (!isFunctionDef(child.type)) {
            results.push(...extractFileLevelVars(child, seen));
        }
    }

    return results;
}

/** Parameter declaration types to collect as function children. */
const PARAM_DECL_TYPES: ReadonlySet<string> = new Set([SyntaxType.IntVarDecl, SyntaxType.StrVarDecl]);

/**
 * Collect INT_VAR and STR_VAR parameter names from a function definition node.
 * Adds collected names to `seen` so body vars with the same name are deduplicated.
 */
function collectFuncParams(funcNode: Node, funcName: string, seen: Set<string>): DocumentSymbol[] {
    const params: DocumentSymbol[] = [];
    for (const child of funcNode.children) {
        if (!PARAM_DECL_TYPES.has(child.type)) continue;
        for (const paramChild of child.children) {
            if (paramChild.type === SyntaxType.Identifier && paramChild.text && !seen.has(paramChild.text)) {
                seen.add(paramChild.text);
                // Use identifier node for range too — all params share the parent
                // decl node range, which causes VSCode to sort alphabetically.
                const sym = makeVarSymbol(paramChild, paramChild, funcName);
                if (sym) params.push(sym);
            }
        }
    }
    return params;
}

/**
 * Collect all variable declarations inside a function/macro body as flat children.
 * Walks recursively — variables inside conditionals/loops still belong to the function.
 * Uses `seen` set to deduplicate — only the first occurrence of each variable is collected.
 */
function collectBodyVars(node: Node, parentName: string, seen: Set<string> = new Set()): DocumentSymbol[] {
    const vars: DocumentSymbol[] = [];

    if (!node.hasError && BODY_VAR_TYPES.has(node.type)) {
        const nameNode = extractVarNameNode(node);
        if (nameNode && nameNode.text && !seen.has(nameNode.text)) {
            seen.add(nameNode.text);
            const sym = makeVarSymbol(node, nameNode, parentName);
            if (sym) vars.push(sym);
        }
    } else if (!node.hasError && BODY_LOOP_TYPES.has(node.type)) {
        const keyNode = node.childForFieldName("key_var");
        const valueNode = node.childForFieldName("value_var");
        if (keyNode && keyNode.text && !seen.has(keyNode.text)) {
            seen.add(keyNode.text);
            const sym = makeVarSymbol(node, keyNode, parentName);
            if (sym) vars.push(sym);
        }
        if (valueNode && valueNode.text && !seen.has(valueNode.text)) {
            seen.add(valueNode.text);
            const sym = makeVarSymbol(node, valueNode, parentName);
            if (sym) vars.push(sym);
        }
    }

    // Spread is fine here — TP2 ASTs are shallow (typically 3-5 levels deep).
    for (const child of node.children) {
        vars.push(...collectBodyVars(child, parentName, seen));
    }
    return vars;
}

export function getDocumentSymbols(text: string): DocumentSymbol[] {
    if (!isInitialized()) {
        return [];
    }

    const tree = parseWithCache(text);
    if (!tree) {
        return [];
    }

    const symbols: DocumentSymbol[] = [];
    const fileLevelSeen = new Set<string>();

    for (const node of tree.rootNode.children) {
        if (isFunctionDef(node.type)) {
            const nameNode = node.childForFieldName("name");
            if (nameNode && nameNode.text) {
                const seen = new Set<string>();
                const params = collectFuncParams(node, nameNode.text, seen);
                const bodyVars = collectBodyVars(node, nameNode.text, seen);
                const children = [...params, ...bodyVars];
                const kind = MACRO_DEF_TYPES.has(node.type) ? SymbolKind.Method : SymbolKind.Function;
                symbols.push({
                    name: nameNode.text,
                    kind,
                    range: makeRange(node),
                    selectionRange: makeRange(nameNode),
                    children: children.length > 0 ? children : undefined,
                });
            }
        } else {
            symbols.push(...extractFileLevelVars(node, fileLevelSeen));
        }
    }

    return symbols;
}
