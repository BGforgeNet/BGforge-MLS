/**
 * WeiDU TP2 file parser.
 * Extracts both symbol definitions and cross-file references from a single
 * tree-sitter AST parse, returning a unified ParseResult.
 *
 * Symbol-building pattern: Helper functions isolating conversion logic.
 * Exposes `functionInfoToSymbol()` and `variableInfoToSymbol()` helpers that
 * convert parsed AST data into IndexedSymbol with WeiDU-specific formatting
 * (INT_VAR/STR_VAR tables, TP2 code fences). This is the best pattern among
 * all providers - helpers are independently testable, reusable by both
 * header-parser and local-symbols, and cleanly separate parsing from symbol
 * construction. Future providers should follow this approach.
 */

import type { Node as SyntaxNode } from "web-tree-sitter";
import { type Location, CompletionItemKind, type Hover, type MarkupContent } from "vscode-languageserver/node";
import { computeDisplayPath, extractFilename } from "../core/location-utils";
import { type ParseResult, EMPTY_PARSE_RESULT } from "../core/parse-result";
import { makeRange } from "../core/position-utils";
import { findPrecedingDocComment } from "../core/doc-comment";
import * as jsdoc from "../shared/jsdoc";
import { parseWithCache, isInitialized } from "../../../shared/parsers/weidu-tp2";
import { SyntaxType } from "./syntax-type";
import { isPhantomAssignment, looksLikeConstant, stripStringDelimiters } from "./tree-utils";
import { FUNCTION_CALL_TYPES } from "./callable-symbols";

// ============================================
// Types
// ============================================

/** Parameter info extracted from function definitions. */
interface FunctionParams {
    intVar: ParamInfo[];
    strVar: ParamInfo[];
    ret: string[];
    retArray: string[];
}

/** Single parameter with optional default value. */
interface ParamInfo {
    name: string;
    defaultValue?: string;
}

/** Complete function/macro definition info. */
export interface FunctionInfo {
    name: string;
    context: CallableContext;
    dtype: CallableDefType;
    location: Location;
    jsdoc?: jsdoc.JSdoc;
    params?: FunctionParams;
}

/** Variable definition info from header files. */
export interface VariableInfo {
    name: string;
    location: Location;
    jsdoc?: jsdoc.JSdoc;
    value?: string; // Source text from AST, truncated if long
    declarationKind: DeclarationKind;
    inferredType: "int" | "string"; // Derived: "set"/assignment -> "int", "sprint"/"text_sprint" -> "string"
}

/** Node types for function/macro definitions. */
const FUNCTION_DEF_TYPES = new Set([
    SyntaxType.ActionDefineFunction,
    SyntaxType.ActionDefinePatchFunction,
    SyntaxType.ActionDefineDimorphicFunction,
    SyntaxType.ActionDefineMacro,
    SyntaxType.ActionDefinePatchMacro,
]);

/**
 * Node types for variable declarations (file-scope, outside function/macro bodies).
 *
 * Narrower than `VARIABLE_DECL_TYPES` in `weidu-tp2/variable-symbols.ts`: this set
 * tracks file-scope decls only and intentionally omits loop variables, parameter
 * declarations, array definitions, and `READ_2DA_*` reads - those are valid only
 * inside function/macro bodies.
 */
const VARIABLE_TYPES = new Set([
    SyntaxType.ActionOuterSet,
    SyntaxType.ActionOuterSprint,
    SyntaxType.ActionOuterTextSprint,
    SyntaxType.PatchSet,
    SyntaxType.PatchSprint,
    SyntaxType.PatchTextSprint,
    SyntaxType.PatchAssignment,
    SyntaxType.PatchReadByte,
    SyntaxType.PatchReadShort,
    SyntaxType.PatchReadLong,
    SyntaxType.PatchReadAscii,
    SyntaxType.PatchReadStrref,
]);

/** Node types for parameter declarations (mapping from node type to parameter category). */
const PARAM_DECL_TYPES = {
    int_var_decl: "intVar",
    str_var_decl: "strVar",
    ret_decl: "ret",
    ret_array_decl: "retArray",
} as const;

// ============================================
// Parsing functions
// ============================================

/**
 * Parse a TP2 file and extract all function/macro definitions.
 */
export function parseHeader(text: string, uri: string): FunctionInfo[] {
    if (!isInitialized()) {
        return [];
    }

    const tree = parseWithCache(text);
    if (!tree) {
        return [];
    }

    return extractFunctions(tree.rootNode, uri);
}

/**
 * Parse a TP2 file and extract all top-level variable definitions with JSDoc.
 */
export function parseHeaderVariables(text: string, uri: string): VariableInfo[] {
    if (!isInitialized()) {
        return [];
    }

    const tree = parseWithCache(text);
    if (!tree) {
        return [];
    }

    return extractVariables(tree.rootNode, uri);
}

interface ExtractAllResult {
    functions: FunctionInfo[];
    variables: VariableInfo[];
    refs: ReadonlyMap<string, readonly Location[]>;
}

/**
 * Single-walk extraction of function defs, variables, and function/call refs.
 * The three extraction concerns share a single recursive pass for hot-path
 * performance (parseFile is called per keystroke on open TP2 files).
 *
 * Extraction rules:
 * - Functions: top-level (direct root children) matching FUNCTION_DEF_TYPES only.
 * - Variables: any depth, but not inside function/macro bodies (separate WeiDU scope).
 * - Refs: any depth including inside function/macro bodies; covers both def and call nodes.
 */
function extractAll(root: SyntaxNode, uri: string): ExtractAllResult {
    const functions: FunctionInfo[] = [];
    const variables: VariableInfo[] = [];
    const refs = new Map<string, Location[]>();

    const addRef = (name: string, loc: Location): void => {
        let locs = refs.get(name);
        if (!locs) {
            locs = [];
            refs.set(name, locs);
        }
        locs.push(loc);
    };

    // Top-level function and macro defs (direct root children only).
    for (let i = 0; i < root.childCount; i++) {
        const node = root.child(i);
        if (!node) continue;
        if (FUNCTION_DEF_TYPES.has(node.type as SyntaxType)) {
            const info = extractFunctionInfo(node, uri);
            if (info) functions.push(info);
        }
    }

    // Recursive visit for variables and refs.
    function visit(node: SyntaxNode, inFunctionBody: boolean): void {
        const type = node.type as SyntaxType;

        if (FUNCTION_DEF_TYPES.has(type)) {
            const nameNode = node.childForFieldName("name");
            if (nameNode) {
                const name = stripStringDelimiters(nameNode.text);
                addRef(name, { uri, range: makeRange(nameNode) });
            }
            // Variables inside function/macro bodies are not file-scope.
            for (const child of node.children) visit(child, true);
            return;
        }

        if (FUNCTION_CALL_TYPES.has(type)) {
            const nameNode = node.childForFieldName("name");
            if (nameNode) {
                const name = stripStringDelimiters(nameNode.text);
                addRef(name, { uri, range: makeRange(nameNode) });
            }
        } else if (!inFunctionBody && VARIABLE_TYPES.has(type) && !isPhantomAssignment(node)) {
            const info = extractVariableInfo(node, uri);
            if (info) variables.push(info);
        }

        for (const child of node.children) visit(child, inFunctionBody);
    }

    visit(root, false);

    return { functions, variables, refs };
}

// Backwards-compatible helpers for non-hot callers (parseHeader / parseHeaderVariables).
function extractFunctions(root: SyntaxNode, uri: string): FunctionInfo[] {
    return extractAll(root, uri).functions;
}

function extractVariables(root: SyntaxNode, uri: string): VariableInfo[] {
    return extractAll(root, uri).variables;
}

/**
 * Extract info from a single function/macro definition node.
 */
function extractFunctionInfo(node: SyntaxNode, uri: string): FunctionInfo | null {
    const nameNode = node.childForFieldName("name");
    if (!nameNode) {
        return null;
    }

    // Strip WeiDU string delimiters (tildes, quotes, percent signs) from function name
    const name = stripStringDelimiters(nameNode.text);
    const { context, dtype } = parseDefType(node.type);

    const location: Location = { uri, range: makeRange(nameNode) };

    const info: FunctionInfo = { name, context, dtype, location };

    // Extract JSDoc from preceding comment
    // TP2 has named returns only (RET/RET_ARRAY), so use 'named' returnMode
    const docComment = findPrecedingDocComment(node);
    if (docComment) {
        info.jsdoc = jsdoc.parse(docComment, { returnMode: "named" });
    }

    // Extract parameters (only for functions, macros don't have params)
    if (dtype === CallableDefType.Function) {
        info.params = extractParams(node);
    }

    return info;
}

/**
 * Extract info from a single variable definition node.
 * Includes all variables; JSDoc is optional.
 */
function extractVariableInfo(node: SyntaxNode, uri: string): VariableInfo | null {
    const varNode = node.childForFieldName("var");
    if (!varNode) {
        return null;
    }

    const name = stripStringDelimiters(varNode.text);
    const location: Location = { uri, range: makeRange(varNode) };

    // Determine declaration kind and inferred type from node type
    let declarationKind: VariableInfo["declarationKind"];
    let inferredType: VariableInfo["inferredType"];

    switch (node.type as SyntaxType) {
        case SyntaxType.ActionOuterSet:
        case SyntaxType.PatchSet:
        case SyntaxType.PatchAssignment:
            declarationKind = DeclarationKind.Set;
            inferredType = "int";
            break;
        case SyntaxType.ActionOuterSprint:
        case SyntaxType.PatchSprint:
            declarationKind = DeclarationKind.Sprint;
            inferredType = "string";
            break;
        case SyntaxType.ActionOuterTextSprint:
        case SyntaxType.PatchTextSprint:
            declarationKind = DeclarationKind.TextSprint;
            inferredType = "string";
            break;
        case SyntaxType.PatchReadAscii:
        case SyntaxType.PatchReadStrref:
            declarationKind = DeclarationKind.Sprint;
            inferredType = "string";
            break;
        default:
            declarationKind = DeclarationKind.Set;
            inferredType = "int";
    }

    const info: VariableInfo = { name, location, declarationKind, inferredType };

    // Extract value from AST
    const valueNode = node.childForFieldName("value");
    if (valueNode) {
        let valueText = valueNode.text;
        // Truncate to 50 chars + "..." if longer
        const MAX_VALUE_LENGTH = 50;
        if (valueText.length > MAX_VALUE_LENGTH) {
            valueText = valueText.slice(0, MAX_VALUE_LENGTH) + "...";
        }
        info.value = valueText;
    }

    // Extract JSDoc from preceding comment (optional)
    // TP2 has named returns only (RET/RET_ARRAY), so use 'named' returnMode
    const docComment = findPrecedingDocComment(node);
    if (docComment) {
        info.jsdoc = jsdoc.parse(docComment, { returnMode: "named" });
    }

    return info;
}

/**
 * Parse definition type string to context and dtype.
 */
function parseDefType(type: string): { context: CallableContext; dtype: CallableDefType } {
    const context = type.includes("dimorphic")
        ? CallableContext.Dimorphic
        : type.includes("patch")
          ? CallableContext.Patch
          : CallableContext.Action;
    const dtype = type.includes("macro") ? CallableDefType.Macro : CallableDefType.Function;
    return { context, dtype };
}

/**
 * Extract parameter declarations from a function node.
 */
function extractParams(node: SyntaxNode): FunctionParams {
    const params: FunctionParams = {
        intVar: [],
        strVar: [],
        ret: [],
        retArray: [],
    };

    for (const child of node.children) {
        if (!Object.hasOwn(PARAM_DECL_TYPES, child.type)) continue;
        const paramType = PARAM_DECL_TYPES[child.type as keyof typeof PARAM_DECL_TYPES];

        if (paramType === "ret" || paramType === "retArray") {
            // RET and RET_ARRAY just have identifiers
            for (const paramChild of child.children) {
                if (paramChild.type === SyntaxType.Identifier) {
                    params[paramType].push(paramChild.text);
                }
            }
        } else {
            // INT_VAR and STR_VAR have name = default pairs
            extractVarParams(child, params[paramType]);
        }
    }

    return params;
}

/**
 * Extract INT_VAR/STR_VAR parameters with optional default values.
 * Grammar structure: INT_VAR name1 = value1 name2 = value2 ...
 */
function extractVarParams(node: SyntaxNode, target: ParamInfo[]): void {
    let currentName: string | null = null;
    let expectingDefault = false;

    for (const child of node.children) {
        // Skip the keyword itself (INT_VAR, STR_VAR)
        if (child.type === node.type || child.text === "INT_VAR" || child.text === "STR_VAR") {
            continue;
        }

        if (child.text === "=") {
            // Next value will be the default
            expectingDefault = true;
            continue;
        }

        // Value types that can be parameter names or default values
        const isValue = ["identifier", "string", "number", "variable_ref", "binary_expr", "value"].includes(child.type);

        if (!isValue) {
            continue;
        }

        if (expectingDefault && currentName !== null) {
            // This is a default value for currentName
            target.push({ name: currentName, defaultValue: child.text });
            currentName = null;
            expectingDefault = false;
            continue;
        }

        // Otherwise this is a new parameter name; flush any pending default-less
        // name first.
        if (currentName !== null) {
            target.push({ name: currentName });
        }
        currentName = child.text;
    }

    // Don't forget the last parameter if no default value
    if (currentName !== null) {
        target.push({ name: currentName });
    }
}

// ============================================
// Symbol conversion for unified Symbols
// ============================================

import {
    type CallableSymbol,
    type VariableSymbol,
    type IndexedSymbol,
    remapSourceType,
    type CallableInfo,
    type VariableInfoData,
    SymbolKind,
    ScopeLevel,
    SourceType,
    CallableContext,
    CallableDefType,
    DeclarationKind,
} from "../core/symbol";
import { CompletionCategory, type Tp2CompletionItem } from "./completion/types";
import { buildFunctionHover, buildVariableHover } from "./hover";

/**
 * Map callable context + def type to the appropriate CompletionCategory.
 * Macros get their own categories; functions use ActionFunctions/PatchFunctions, or
 * DimorphicFunctions for a DEFINE_DIMORPHIC_FUNCTION - launchable via both LAF and LPF,
 * so it is offered in both launch contexts (the same category the static YAML dimorphic
 * builtins use). There are no dimorphic macros.
 */
function getCompletionCategory(context: CallableContext, dtype: CallableDefType): CompletionCategory {
    if (dtype === CallableDefType.Macro) {
        return context === CallableContext.Action ? CompletionCategory.ActionMacros : CompletionCategory.PatchMacros;
    }
    if (context === CallableContext.Dimorphic) {
        return CompletionCategory.DimorphicFunctions;
    }
    return context === CallableContext.Action ? CompletionCategory.ActionFunctions : CompletionCategory.PatchFunctions;
}

/** Helper to extract MarkupContent from hover contents */
function extractMarkupContent(contents: Hover["contents"]): MarkupContent | undefined {
    if (typeof contents === "object" && "kind" in contents && "value" in contents) {
        return contents;
    }
    return undefined;
}

/**
 * Convert FunctionInfo to CallableSymbol for unified index storage.
 * This enables all provider methods to find header functions via Symbols.
 *
 * @param func Function definition info
 * @param displayPath Workspace-relative path for display (optional)
 */
function functionInfoToSymbol(func: FunctionInfo, displayPath?: string | null): CallableSymbol {
    const hover = buildFunctionHover(func, displayPath);
    const doc = extractMarkupContent(hover.contents);

    // For completion labelDetails, show path only if displayPath is not null
    const completionDescription =
        displayPath === null ? undefined : (displayPath ?? extractFilename(func.location.uri));

    const completion: Tp2CompletionItem = {
        label: func.name,
        kind: func.dtype === CallableDefType.Macro ? CompletionItemKind.Snippet : CompletionItemKind.Function,
        documentation: doc,
        labelDetails: {
            description: completionDescription,
        },
        category: getCompletionCategory(func.context, func.dtype),
    };

    // Build JSDoc arg lookup map for type overrides and descriptions
    const jsdocArgs = new Map<string, { type?: string; description?: string; required?: boolean }>();
    if (func.jsdoc?.args) {
        for (const arg of func.jsdoc.args) {
            jsdocArgs.set(arg.name, {
                type: arg.type,
                description: arg.description,
                required: arg.required,
            });
        }
    }

    // Convert FunctionParams to CallableInfo format with JSDoc data
    const callable: CallableInfo = {
        context: func.context,
        dtype: func.dtype,
        description: func.jsdoc?.desc,
        params: func.params
            ? {
                  intVar: func.params.intVar.map((p) => {
                      const jsdocArg = jsdocArgs.get(p.name);
                      return {
                          name: p.name,
                          type: jsdocArg?.type ?? "int",
                          defaultValue: p.defaultValue,
                          description: jsdocArg?.description,
                          required: jsdocArg?.required,
                      };
                  }),
                  strVar: func.params.strVar.map((p) => {
                      const jsdocArg = jsdocArgs.get(p.name);
                      return {
                          name: p.name,
                          type: jsdocArg?.type ?? "string",
                          defaultValue: p.defaultValue,
                          description: jsdocArg?.description,
                          required: jsdocArg?.required,
                      };
                  }),
                  ret: func.params.ret,
                  retArray: func.params.retArray,
              }
            : undefined,
    };

    return {
        name: func.name,
        kind: func.dtype === CallableDefType.Macro ? SymbolKind.Macro : SymbolKind.Function,
        location: func.location,
        scope: { level: ScopeLevel.Workspace },
        source: {
            type: SourceType.Workspace,
            uri: func.location.uri,
            displayPath: displayPath ?? extractFilename(func.location.uri),
        },
        completion,
        hover,
        callable,
    };
}

/**
 * Convert VariableInfo to VariableSymbol for unified index storage.
 *
 * @param varInfo Variable definition info
 * @param displayPath Workspace-relative path for display (null to skip)
 */
function variableInfoToSymbol(varInfo: VariableInfo, displayPath?: string | null): VariableSymbol {
    const hover = buildVariableHover(varInfo, displayPath);
    const doc = extractMarkupContent(hover.contents);

    // For completion labelDetails, show path only if displayPath is not null
    const completionDescription =
        displayPath === null ? undefined : (displayPath ?? extractFilename(varInfo.location.uri));

    const completionKind = looksLikeConstant(varInfo.name) ? CompletionItemKind.Constant : CompletionItemKind.Variable;

    const completion: Tp2CompletionItem = {
        label: varInfo.name,
        kind: completionKind,
        documentation: doc,
        labelDetails: { description: completionDescription },
        category: CompletionCategory.Vars,
    };

    const variable: VariableInfoData = {
        type: varInfo.jsdoc?.type ?? varInfo.inferredType,
        value: varInfo.value,
        declarationKind: varInfo.declarationKind,
        description: varInfo.jsdoc?.desc,
    };

    return {
        name: varInfo.name,
        kind: SymbolKind.Variable,
        location: varInfo.location,
        scope: { level: ScopeLevel.Workspace },
        source: {
            type: SourceType.Workspace,
            uri: varInfo.location.uri,
            displayPath: completionDescription,
        },
        completion,
        hover,
        variable,
    };
}

/** Options for parseFile */
interface ParseSymbolsOptions {
    /** Workspace root path for computing relative displayPath */
    workspaceRoot?: string;
    /** Skip path in hover (for local symbols where path is redundant) */
    skipPath?: boolean;
    /** Override source type (default: Workspace). Use Navigation for non-header files. */
    sourceType?: SourceType;
}

/**
 * Parse a file and return both symbols and references from a single AST parse.
 * This is the preferred API - returns ParseResult for FileIndex storage.
 *
 * @param uri File URI
 * @param text File content
 * @param options Parse options (workspace root, source type, path-skipping)
 */
export function parseFile(uri: string, text: string, options?: ParseSymbolsOptions): ParseResult {
    if (!isInitialized()) {
        return EMPTY_PARSE_RESULT;
    }

    const tree = parseWithCache(text);
    if (!tree) {
        return EMPTY_PARSE_RESULT;
    }

    const { functions, variables, refs } = extractAll(tree.rootNode, uri);

    const opts: ParseSymbolsOptions = options ?? {};

    const displayPath = opts.skipPath ? null : computeDisplayPath(uri, opts.workspaceRoot);

    const symbols: IndexedSymbol[] = [
        ...functions.map((func) => functionInfoToSymbol(func, displayPath)),
        ...variables.map((varInfo) => variableInfoToSymbol(varInfo, displayPath)),
    ];

    // Remap source type when called for non-header files (e.g., Navigation for Ctrl+T)
    return { symbols: remapSourceType(symbols, opts.sourceType), refs };
}
