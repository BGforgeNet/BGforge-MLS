/**
 * Inline function extraction and macro generation for TSSL transpiler.
 * Handles @inline-tagged functions: extraction from source, usage detection, and macro output.
 */

import type { SourceFile, Node } from "ts-morph";
import {
    SyntaxKind,
    sslName,
    type InlineArg,
    type InlineBody,
    type InlineCall,
    type InlineFunc,
    type TsslContext,
} from "./types";
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

        const callFrom = (call: Node): InlineCall => {
            const callExpr = call.asKindOrThrow(SyntaxKind.CallExpression);
            const args: InlineArg[] = callExpr.getArguments().map((arg) => {
                const argText = arg.getText();
                if (paramNames.has(argText)) return { type: "param", value: argText };
                // Convert operators to SSL syntax (| -> bwor, etc.), keeping the TypeScript spelling
                // for the consumer that re-parses rather than splices.
                return { type: "constant", value: convertOperatorsAST(arg), source: argText };
            });
            return { targetFunc: callExpr.getExpression().getText(), args };
        };

        // The body must BE what the macro stands for, matched exactly rather than searched for: reaching
        // in for the first call in a body that holds anything else would expand that one and drop the
        // rest, silently, since both front ends read this extraction and so agree on the truncation.
        //
        // Three shapes qualify. A sequence of calls expands to the same sequence, which is why a body of
        // several statements can inline at all - the reference compiler takes a semicolon-separated macro
        // body, though not a `begin ... end` one. A single returned call expands to that call. Anything
        // else returned expands as a parenthesised expression, which is what lets a comparison inline; a
        // value-returning body cannot hold a sequence, SSL having no expression form for one.
        const statements = body.asKind(SyntaxKind.Block)?.getStatements() ?? [];
        let inlineBody: InlineBody | undefined;
        const sole = statements.length === 1 ? statements[0] : undefined;
        if (sole?.getKind() === SyntaxKind.ReturnStatement) {
            let returnExpr = sole.asKindOrThrow(SyntaxKind.ReturnStatement).getExpression();
            // Every assertion, not one: `sfall_func2(...) as ObjectPtr` wraps the call once, but folib's
            // `inven_count` writes `critter_inven_obj(...) as unknown as number`, where peeling a single
            // layer leaves another assertion and the call underneath is never found.
            while (returnExpr?.getKind() === SyntaxKind.AsExpression) {
                returnExpr = returnExpr.asKindOrThrow(SyntaxKind.AsExpression).getExpression();
            }
            if (returnExpr?.getKind() === SyntaxKind.CallExpression) {
                inlineBody = { kind: "calls", calls: [callFrom(returnExpr)] };
            } else if (returnExpr) {
                // Exactly the layer emission re-adds, so an author who wrapped their own expression gets
                // one pair rather than two. Only the outermost: a redundant pair is not always inert in
                // SSL, and anything the author wrote inside is theirs.
                const inner = returnExpr.asKind(SyntaxKind.ParenthesizedExpression)?.getExpression();
                const expression = inner ?? returnExpr;
                inlineBody = {
                    kind: "expression",
                    value: convertOperatorsAST(expression),
                    source: expression.getText(),
                };
            }
        } else if (statements.length > 0) {
            const bodyCalls = statements.map((statement) =>
                statement.asKind(SyntaxKind.ExpressionStatement)?.getExpression().asKind(SyntaxKind.CallExpression),
            );
            // All or nothing: one statement this cannot read makes the whole body unexpandable.
            if (bodyCalls.every((call) => call !== undefined)) {
                inlineBody = { kind: "calls", calls: bodyCalls.map((call) => callFrom(call)) };
            }
        }

        // A body this cannot read leaves an ordinary procedure, the tag having no effect.
        if (!inlineBody) continue;

        result.set(funcName, { body: inlineBody, params });
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
        // Semicolons for a sequence, not `begin ... end`: the reference compiler refuses the block form
        // where a macro body is spliced, and takes the sequence. An expression is parenthesised so it
        // cannot re-associate with whatever surrounds the call site.
        const body =
            inline.body.kind === "expression"
                ? `(${expandEnumAccess(inline.body.value, enumNames)})`
                : inline.body.calls
                      .map((call) => {
                          const argList = call.args
                              .map((a) => (a.type === "constant" ? expandEnumAccess(a.value, enumNames) : a.value))
                              .join(", ");
                          // `targetFunc` is the callee's raw source text, so it carries the TypeScript
                          // spelling of a name the output states differently.
                          return `${sslName(call.targetFunc)}(${argList})`;
                      })
                      .join("; ");
        macros.push(`#define ${funcName}${paramList} ${body}`);
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
