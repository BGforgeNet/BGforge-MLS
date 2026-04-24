/**
 * Inline function extraction and macro generation for TSSL transpiler.
 * Handles @inline-tagged functions: extraction from source, usage detection, and macro output.
 */

import * as fs from "fs";
import { Project, SourceFile, Node } from "ts-morph";
import { SyntaxKind, type InlineFunc, type InlineArg, type TsslContext } from "./types";
import { convertOperatorsAST } from "./convert-operators";

/** Cache for inline functions extracted from imported files, keyed by absolute path. */
export type InlineFunctionCache = Map<string, Map<string, InlineFunc>>;

/**
 * Extract functions marked with @inline JSDoc tag from bundled source files.
 * Uses the list of input files from esbuild's metafile.
 * When a cache is provided, avoids re-parsing files already seen (e.g., folib
 * is imported by every TSSL file but only needs to be parsed once).
 * @param project ts-morph Project instance to reuse
 * @param inputFiles List of input file paths from esbuild metafile
 * @param cache Optional cache to avoid re-parsing shared imports across files
 */
export function extractInlineFunctionsFromFiles(
    project: Project,
    inputFiles: readonly string[],
    cache?: InlineFunctionCache,
): Map<string, InlineFunc> {
    const result = new Map<string, InlineFunc>();

    for (const filePath of inputFiles) {
        const cached = cache?.get(filePath);
        if (cached) {
            for (const [k, v] of cached) result.set(k, v);
            continue;
        }
        if (!fs.existsSync(filePath)) continue;
        // Reuse already-parsed source file if present in the project (batch mode)
        const source = project.getSourceFile(filePath) ?? project.addSourceFileAtPath(filePath);
        const fileResult = new Map<string, InlineFunc>();
        extractInlineFunctionsFromSource(source, fileResult);
        if (cache) cache.set(filePath, fileResult);
        for (const [k, v] of fileResult) result.set(k, v);
    }

    return result;
}

function extractInlineFunctionsFromSource(source: SourceFile, result: Map<string, InlineFunc>) {
    for (const stmt of source.getStatements()) {
        if (stmt.getKind() !== SyntaxKind.FunctionDeclaration) continue;

        const func = stmt.asKind(SyntaxKind.FunctionDeclaration);
        if (!func) continue;

        // Check for @inline JSDoc tag
        const jsDocs = func.getJsDocs();
        const hasInlineTag = jsDocs.some((doc) => doc.getText().includes("@inline"));
        if (!hasInlineTag) continue;

        const funcName = func.getName();
        if (!funcName) continue;

        // Extract the call from the body
        const body = func.getBody();
        if (!body) continue;

        // Get parameter names to identify which args are params vs constants
        const paramNames = new Set(func.getParameters().map((p) => p.getName()));
        const params = func.getParameters().map((p) => p.getName());

        let targetFunc: string | undefined;
        const inlineArgs: InlineArg[] = [];

        // Helper to extract call info
        const extractCallInfo = (call: Node) => {
            const callExpr = call.asKindOrThrow(SyntaxKind.CallExpression);
            targetFunc = callExpr.getExpression().getText();
            const args = callExpr.getArguments();

            for (const arg of args) {
                const argText = arg.getText();
                if (paramNames.has(argText)) {
                    inlineArgs.push({ type: "param", value: argText });
                } else {
                    // Convert operators to SSL syntax (| -> bwor, etc.)
                    inlineArgs.push({ type: "constant", value: convertOperatorsAST(arg) });
                }
            }
        };

        // Look for return statement first
        const returnStmt = body.getFirstDescendantByKind(SyntaxKind.ReturnStatement);
        if (returnStmt) {
            let returnExpr = returnStmt.getExpression();
            // Unwrap AsExpression (e.g., `sfall_func2(...) as ObjectPtr`)
            if (returnExpr?.getKind() === SyntaxKind.AsExpression) {
                returnExpr = returnExpr.asKindOrThrow(SyntaxKind.AsExpression).getExpression();
            }
            if (returnExpr?.getKind() === SyntaxKind.CallExpression) {
                extractCallInfo(returnExpr);
            }
        } else {
            // Check for expression statement (void functions)
            const exprStmt = body.getFirstDescendantByKind(SyntaxKind.ExpressionStatement);
            if (exprStmt) {
                const expr = exprStmt.getExpression();
                if (expr.getKind() === SyntaxKind.CallExpression) {
                    extractCallInfo(expr);
                }
            }
        }

        if (!targetFunc) continue;

        result.set(funcName, { targetFunc, args: inlineArgs, params });
    }
}

/**
 * Generate #define macros from inline functions that are actually used.
 * Expands enum property accesses (e.g. STAT.ch -> STAT_ch) in constant args,
 * since inline function bodies are extracted before enum expansion runs.
 * @param inlineFuncs Map of function names to InlineFunc metadata
 * @param usedFuncs Set of function names that are actually called in the code
 * @param enumNames Set of known enum names for property access expansion
 * @returns Array of #define statements
 */
export function generateInlineMacros(
    inlineFuncs: Map<string, InlineFunc>,
    usedFuncs: Set<string>,
    enumNames: ReadonlySet<string>,
): string[] {
    const macros: string[] = [];
    for (const [funcName, inline] of inlineFuncs) {
        if (!usedFuncs.has(funcName)) continue;
        const paramList = inline.params.length > 0 ? `(${inline.params.join(", ")})` : "";
        const argList = inline.args
            .map((a) => (a.type === "constant" ? expandEnumAccess(a.value, enumNames) : a.value))
            .join(", ");
        macros.push(`#define ${funcName}${paramList} ${inline.targetFunc}(${argList})`);
    }
    return macros;
}

/**
 * Replace EnumName.Member with EnumName_Member in a string expression.
 * Only replaces when the object name is a known enum.
 */
function expandEnumAccess(value: string, enumNames: ReadonlySet<string>): string {
    if (enumNames.size === 0) {
        return value;
    }
    // Match word.word patterns where the first word is a known enum name
    return value.replace(/\b(\w+)\.(\w+)\b/g, (match, obj: string, prop: string) =>
        enumNames.has(obj) ? `${obj}_${prop}` : match,
    );
}

/**
 * Find all inline functions that are actually used in the source file.
 */
export function findUsedInlineFunctions(source: SourceFile, inlineFuncs: Map<string, InlineFunc>): Set<string> {
    const used = new Set<string>();

    function visit(node: Node) {
        if (node.getKind() === SyntaxKind.CallExpression) {
            const call = node.asKindOrThrow(SyntaxKind.CallExpression);
            const fnName = call.getExpression().getText();
            if (inlineFuncs.has(fnName)) {
                used.add(fnName);
            }
        }
        node.forEachChild(visit);
    }

    source.forEachChild(visit);
    return used;
}

/**
 * Extract JSDoc comments from a single source file for all functions.
 * This must be done before bundling since esbuild strips JSDoc.
 */
export function extractJsDocs(sourceFile: SourceFile, ctx: TsslContext): void {
    sourceFile.getFunctions().forEach((func) => {
        const name = func.getName();
        if (!name) return;

        const jsDocs = func.getJsDocs();
        if (jsDocs.length > 0) {
            // Keep the original JSDoc format - SSL supports it
            const jsDocText = jsDocs.map((doc) => doc.getText()).join("\n");
            if (jsDocText) {
                ctx.functionJsDocs.set(name, jsDocText);
            }
        }
    });
}
