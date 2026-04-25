/**
 * TSSL transpiler - TypeScript to Fallout SSL.
 * Transpiles TypeScript files with .tssl extension to Fallout SSL scripts.
 * Entry points:
 *   compile() - LSP: bundles, converts, writes .ssl file to disk
 *   transpile() - CLI: bundles, converts, returns SSL string without writing
 * Handles enum transformation before bundling to avoid esbuild's IIFE conversion.
 *
 * Unlike TBAF/TD, TSSL always bundles (no hasImports() optimization) because:
 * 1. Enums are a first-class TSSL feature, not just a library-import side effect.
 *    TBAF/TD skip enum transformation for import-free files since enums there are
 *    only useful with library imports (ielib/iets).
 * 2. Inline function extraction (extractInlineFunctionsFromFiles) needs bundling
 *    to track which functions are used across files.
 * 3. Enum property access expansion requires accumulating enum names from all
 *    bundled files (main + imports) via bundleResult.allEnumNames.
 */

import * as path from "path";
import { Project, SyntaxKind } from "ts-morph";
import { EXT_TSSL } from "../../common/extensions";
import { bundleWithEsbuild } from "../../common/esbuild-utils";
import { conlog, type TsslContext, type MainFileData } from "./types";
import { convertOperatorsAST } from "./convert-operators";
import { extractInlineFunctionsFromFiles, extractJsDocs, type InlineFunctionCache } from "./inline-functions";
import { exportSSL } from "./emit";
// Generated from server/data/fallout-ssl-base.yml by generate-data.sh.
// Inlined by esbuild at bundle time.
import engineProcedureNames from "../../../server/out/fallout-ssl-engine-procedures.json";
import { transformEnums } from "../../common/enum-transform";
import { createTranspiler, type TranspilerEvent } from "../../common/transpiler-pipeline";

/** Marker to identify start of user code in esbuild output */
const TSSL_CODE_MARKER = "/* __TSSL_CODE_START__ */";

/**
 * Shared state for batch transpilation (CLI directory mode).
 * Reusing a Project avoids re-initializing the TypeScript compiler for each file.
 * The inline function cache avoids re-parsing shared imports (e.g., folib).
 */
export interface TranspileBatchState {
    readonly project: Project;
    readonly inlineFunctionCache: InlineFunctionCache;
}

/** Create a batch state for processing multiple TSSL files efficiently. */
export function createBatchState(): TranspileBatchState {
    return {
        project: new Project(),
        inlineFunctionCache: new Map(),
    };
}

const tssl = createTranspiler<string, TranspileBatchState | undefined>({
    sourceExtension: EXT_TSSL,
    targetExtension: ".ssl",
    name: "TSSL",

    async transpileCore(filePath, text, traTag, batch) {
        // Pre-transform enums for extracting constants/let vars.
        // Pass enumNames to the shared bundler to skip redundant re-transformation.
        const { code: enumTransformedText, enumNames } = transformEnums(text);

        // Reuse project from batch state, or create a fresh one (LSP / single-file mode)
        const project = batch?.project ?? new Project();

        // Extract includes, constants, and let vars from the enum-transformed source
        const { constants, letVars } = extractTopLevelVars(project, enumTransformedText);
        const mainFileData: MainFileData = {
            constants,
            letVars,
            // Extract includes from original text (enums don't affect includes)
            includes: extractIncludes(text),
        };

        // Create context for this compilation (enumNames populated after bundling)
        const ctx: TsslContext = {
            inlineFunctions: new Map(),
            definedFunctions: new Set(),
            functionJsDocs: new Map(),
            doStatementCounter: 0,
            enumNames: new Set(),
        };

        // Extract JSDoc from main source file before bundling (esbuild strips them).
        // In batch mode, the file may already be in the project from a previous run.
        const mainSource = project.getSourceFile(filePath) ?? project.addSourceFileAtPath(filePath);
        extractJsDocs(mainSource, ctx);
        conlog(`Extracted JSDoc for ${ctx.functionJsDocs.size} functions from main file`);

        const preserveFunctions = extractPreserveFunctions(text);
        const preserveCode = `\n// Preserve functions\nif ((globalThis as any).__preserve__) { console.log(${preserveFunctions.join(", ")}); }`;

        const bundleResult = await bundleWithEsbuild({
            filePath,
            sourceText: enumTransformedText,
            preTransformed: { enumNames },
            marker: TSSL_CODE_MARKER,
            target: "es2022",
            sourcefile: path.basename(filePath).replace(".tssl", ".ts"),
            metafile: true,
            appendCode: preserveCode,
            originalConstants: mainFileData.constants,
        });

        // All enum names (main file + imported files) for inline function expansion
        ctx.enumNames = bundleResult.allEnumNames;

        // Create source file in memory from cleaned bundled code
        const sourceFile = project.createSourceFile("bundled.ts", bundleResult.code, { overwrite: true });

        // Extract inline functions from files that were actually bundled.
        // In batch mode, the cache avoids re-parsing shared imports (e.g., folib).
        ctx.inlineFunctions = extractInlineFunctionsFromFiles(
            project,
            bundleResult.inputFiles,
            batch?.inlineFunctionCache,
        );
        conlog(`Found ${ctx.inlineFunctions.size} inline functions`);

        return exportSSL(sourceFile, path.parse(filePath).base, mainFileData, ctx, traTag);
    },

    getOutput: (result) => result,
});

export interface TSSLCompileResult {
    sslPath: string;
    events: readonly TranspilerEvent[];
}

/**
 * Convert TSSL to SSL, writing the output to disk.
 * Used by the LSP compile handler.
 */
export async function compile(uri: string, text: string): Promise<TSSLCompileResult> {
    // No batch state on the LSP compile path — TSSL CLI directory mode is the only batch consumer.
    const { outPath, events } = await tssl.compile(uri, text, undefined);
    return { sslPath: outPath, events };
}

/**
 * Transpile TSSL to SSL, returning the output string without writing to disk.
 * Used by the CLI where the caller controls file I/O.
 * @param batch Optional shared state for batch processing (pass createBatchState() result)
 */
export async function transpile(filePath: string, text: string, batch?: TranspileBatchState): Promise<string> {
    return tssl.transpile(filePath, text, batch);
}

/**
 * Extract #include directives from magic comments.
 * Looks for lines like: // #include "path/to/header.h"
 * @param sourceText The original TypeScript source text
 * @returns Array of include paths
 */
function extractIncludes(sourceText: string): string[] {
    const includes: string[] = [];
    const regex = /^\/\/\s*#include\s+["']([^"']+)["']\s*$/gm;
    let match;
    while ((match = regex.exec(sourceText)) !== null) {
        const inc = match[1];
        if (inc) includes.push(inc);
    }
    return includes;
}

/**
 * Extract top-level constants and let variables from source.
 * Constants become #define, let variables become SSL variable declarations.
 * @param project ts-morph Project instance to reuse
 * @param sourceText The original TypeScript source text
 * @returns Object with constants map and letVars set
 */
function extractTopLevelVars(
    project: Project,
    sourceText: string,
): { constants: Map<string, string>; letVars: Set<string> } {
    const constants = new Map<string, string>();
    const letVars = new Set<string>();
    const tempSourceFile = project.createSourceFile("temp-vars.ts", sourceText, { overwrite: true });

    for (const stmt of tempSourceFile.getStatements()) {
        if (stmt.getKind() === SyntaxKind.VariableStatement) {
            const varStmt = stmt.asKind(SyntaxKind.VariableStatement);
            if (!varStmt) continue;

            const declList = varStmt.getDeclarationList();
            const keywordNode = declList.getFirstChild();
            const keywordKind = keywordNode ? keywordNode.getKind() : undefined;

            if (keywordKind === SyntaxKind.ConstKeyword) {
                for (const decl of declList.getDeclarations()) {
                    const name = decl.getName();
                    const initializer = decl.getInitializer();
                    if (initializer) {
                        // Skip compat objects (enum-generated `as const` objects)
                        // These have object literal initializers and shouldn't become #define
                        if (
                            initializer.isKind(SyntaxKind.AsExpression) ||
                            initializer.isKind(SyntaxKind.ObjectLiteralExpression)
                        ) {
                            continue;
                        }
                        // Convert operators to SSL syntax (| -> bwor, etc.)
                        const value = convertOperatorsAST(initializer);
                        constants.set(name, value);
                    }
                }
            } else if (keywordKind === SyntaxKind.LetKeyword) {
                for (const decl of declList.getDeclarations()) {
                    letVars.add(decl.getName());
                }
            }
        }
    }

    return { constants, letVars };
}

/**
 * Extract function names that should be preserved from tree-shaking.
 * Includes engine procedures and any function passed to register_hook_proc.
 */
function extractPreserveFunctions(text: string): string[] {
    const preserve = [...engineProcedureNames];
    // Extract functions passed to register_hook_proc or register_hook_proc_spec
    const hookRegex = /register_hook_proc(?:_spec)?\s*\([^,]+,\s*(\w+)\s*\)/g;
    let match;
    while ((match = hookRegex.exec(text)) !== null) {
        const fn = match[1];
        if (fn) preserve.push(fn);
    }
    return preserve;
}
