/**
 * TSSL transpiler - TypeScript to Fallout SSL.
 * Transpiles TypeScript files with .tssl extension to Fallout SSL scripts.
 * Entry points:
 *   compile() - LSP: resolves, converts, writes .ssl file to disk
 *   transpile() - CLI: resolves, converts, returns SSL string without writing
 *
 * The pipeline is ts-morph end to end: the entry parses under a shadow .ts name so the TypeScript
 * checker resolves its imports (folib's package.json `exports` and re-export barrels included), the
 * program model works out what is reachable, and the emitter renders those declarations as SSL. No
 * bundler sits in the middle, so float literals, JSDoc and identifiers reach the output exactly as
 * written, and every emitted line knows the file and line it came from first-hand.
 */

import * as path from "path";
import { EXT_TSSL } from "../../../transpilers/common/extensions";
import { conlog, type TsslContext } from "./types";
import { createBatchState, prepareEntry, type TranspileBatchState } from "./batch";
import { extractInlineFunctions, extractJsDocs } from "./inline-functions";
import { exportSSL } from "./emit";
import { buildProgramModel } from "./program-model";
// Generated from server/data/fallout-ssl-base.yml by generate-data.sh.
// Inlined by esbuild at bundle time.
import engineProcedureNames from "../../../server/out/fallout-ssl-engine-procedures.json";
import type { SourcePosition } from "../../../transpilers/common/line-map";
import { createTranspiler, type TranspilerEvent } from "../../../transpilers/common/transpiler-pipeline";

// Part of the package's public surface: a caller compiling more than once passes one of these in.
export { createBatchState, type TranspileBatchState } from "./batch";

/** Generated SSL, plus where each of its lines came from in the files the author wrote. */
export interface TSSLResult {
    output: string;
    sourceMap: ReadonlyArray<SourcePosition | undefined>;
}

const tssl = createTranspiler<TSSLResult, TranspileBatchState | undefined>({
    sourceExtension: EXT_TSSL,
    targetExtension: ".ssl",
    name: "TSSL",

    async transpileCore(filePath, text, traTag, batch) {
        // Reuse the caller's project, or stand one up for this compile alone (single-file mode).
        const state = batch ?? createBatchState();
        const entrySource = prepareEntry(state, filePath, text);

        const program = buildProgramModel(
            state.project,
            entrySource,
            filePath,
            engineProcedureNames,
            (source) => extractInlineFunctions(source, state.inlineFunctionCache),
            state.moduleWalkCache,
        );
        conlog(`Found ${program.inlineFunctions.size} inline functions`);

        const ctx: TsslContext = {
            inlineFunctions: program.inlineFunctions,
            definedFunctions: program.definedFunctions,
            functionJsDocs: new Map(),
            doStatementCounter: 0,
            localEnumNames: program.localEnumNames,
            externEnumNames: program.externEnumNames,
            // Swapped per module by the emitter; empty until it starts.
            importRenames: new Map(),
        };
        extractJsDocs(entrySource, ctx);

        const emitted = exportSSL(program, path.parse(filePath).base, extractIncludes(text), ctx, traTag);
        return { output: emitted.text, sourceMap: emitted.origins };
    },

    getOutput: (result) => result.output,
});

export interface TSSLCompileResult {
    sslPath: string;
    events: readonly TranspilerEvent[];
    /** For each line of the generated SSL, the file and 0-based line the author wrote it on. */
    sourceMap: ReadonlyArray<SourcePosition | undefined>;
}

/**
 * Convert TSSL to SSL, writing the output to disk.
 * Used by the LSP compile handler.
 */
export async function compile(uri: string, text: string): Promise<TSSLCompileResult> {
    // No batch state on the LSP compile path - TSSL CLI directory mode is the only batch consumer.
    // eslint-disable-next-line unicorn/no-useless-undefined -- the third arg is a non-optional rest tuple element typed `TranspileBatchState | undefined`; omitting fails the typecheck
    const { outPath, events, result } = await tssl.compile(uri, text, undefined);
    return { sslPath: outPath, events, sourceMap: result.sourceMap };
}

/**
 * Transpile TSSL to SSL, returning the output string without writing to disk.
 * Used by the CLI where the caller controls file I/O. The source map is not returned here: the CLI writes
 * a file and reports the compiler's own output, with no editor to place a diagnostic in.
 * @param batch Optional shared state for batch processing (pass createBatchState() result)
 */
export async function transpile(filePath: string, text: string, batch?: TranspileBatchState): Promise<string> {
    const result = await tssl.transpile(filePath, text, batch);
    return result.output;
}

/**
 * As `transpile`, keeping the record of where each generated line came from.
 * Used by the LSP compile handler, which places the SSL compiler's errors back on the author's lines.
 */
export async function transpileWithSourceMap(
    filePath: string,
    text: string,
    batch?: TranspileBatchState,
): Promise<TSSLResult> {
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
