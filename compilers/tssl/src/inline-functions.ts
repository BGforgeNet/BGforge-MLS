/**
 * Inline function extraction and macro generation for TSSL transpiler.
 * Handles @inline-tagged functions: extraction from source, usage detection, and macro output.
 */

import type { SourceFile, Node } from "ts-morph";
import { SyntaxKind, sslName, type InlineFunc, type InlineArg, type TsslContext } from "./types";
import { convertOperatorsAST } from "./convert-operators";

/** Cache for inline functions extracted from imported files, keyed by absolute path. */
export type InlineFunctionCache = Map<string, Map<string, InlineFunc>>;

/**
 * Extract functions marked with the @inline JSDoc tag from one source file, through the cache when the
 * file was already seen - folib is imported by every TSSL file and only needs the walk once per batch.
 */
export function extractInlineFunctions(source: SourceFile, cache?: InlineFunctionCache): Map<string, InlineFunc> {
    const filePath = source.getFilePath();
    const cached = cache?.get(filePath);
    if (cached) return cached;
    const result = new Map<string, InlineFunc>();
    extractInlineFunctionsFromSource(source, result);
    cache?.set(filePath, result);
    return result;
}

function extractInlineFunctionsFromSource(source: SourceFile, result: Map<string, InlineFunc>) {
    for (const stmt of source.getStatements()) {
        if (stmt.getKind() !== SyntaxKind.FunctionDeclaration) continue;

        const func = stmt.asKind(SyntaxKind.FunctionDeclaration);
        if (!func) continue;

        // The tag itself, not the substring: a description mentioning @inline - or a tag named
        // @inlineable - is not a request to expand the function at its call sites.
        const jsDocs = func.getJsDocs();
        const hasInlineTag = jsDocs.some((doc) => doc.getTags().some((tag) => tag.getTagName() === "inline"));
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
                    // Convert operators to SSL syntax (| -> bwor, etc.), keeping the TypeScript spelling
                    // for the consumer that re-parses rather than splices.
                    inlineArgs.push({ type: "constant", value: convertOperatorsAST(arg), source: argText });
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
        // `targetFunc` is the callee's raw source text, so it carries the TypeScript spelling of a name
        // the output states differently.
        macros.push(`#define ${funcName}${paramList} ${sslName(inline.targetFunc)}(${argList})`);
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
    return value.replaceAll(/\b(\w+)\.(\w+)\b/g, (match, obj: string, prop: string) =>
        enumNames.has(obj) ? `${obj}_${prop}` : match,
    );
}

/**
 * Extract JSDoc comments from a single source file for all functions.
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
