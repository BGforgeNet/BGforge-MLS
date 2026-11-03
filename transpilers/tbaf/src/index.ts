/**
 * TBAF Transpiler - Main Entry Point
 *
 * Transpiles TypeScript BAF (.tbaf) to BAF format.
 * Uses the shared transpiler pipeline for orchestration.
 */

import { Project } from "ts-morph";
import { EXT_TBAF } from "../../common/extensions";
import { createTranspiler } from "../../common/transpiler-pipeline";
import { bundle } from "../../common/bundle";
import { checkDeclarationKinds } from "../../common/compile-time-eval";
import { getSharedProject } from "../../common/shared-project";
import { TranspileError } from "../../common/transpile-error";
import type { SourcePosition } from "../../common/line-map";
import { emitBAF, type EmittedBAF } from "./emit";
import { TBAFTransformer } from "./transform";

/** Generated BAF, plus where each of its lines came from in the files the author wrote. */
export interface TBAFResult {
    output: string;
    sourceMap: ReadonlyArray<SourcePosition | undefined>;
}

const tbaf = createTranspiler<TBAFResult>({
    sourceExtension: EXT_TBAF,
    targetExtension: ".baf",

    async transpileCore(filePath, text, traTag) {
        // 1. Bundle imports (skips bundling internally for files without imports)
        const { code: bundled, origins } = await bundle(filePath, text, checkDeclarations);

        // Everything below reads the bundled text, so a failure's line is a line of THAT - restated
        // against the file it came from on the way out.
        try {
            const emitted = transformBundled(bundled, filePath, traTag);
            // The emitter reports bundled lines; the bundler says which file and line each of those was.
            // Composing them is what turns a position in the generated file into one the author can open.
            return {
                output: emitted.text,
                sourceMap: emitted.origins.map((line) => (line === undefined ? undefined : origins[line])),
            };
        } catch (error) {
            throw TranspileError.remap(error, origins);
        }
    },

    getOutput: (result) => result.output,
});

/** Parse the bundled text, transform it to IR, and emit BAF. */
function transformBundled(bundled: string, filePath: string, traTag: string | undefined): EmittedBAF {
    // 2. Parse bundled code.
    // Uses a per-compile Project rather than the module-scoped shared one
    // in transpilers/common/shared-project.ts. The shared pattern fits
    // short-lived source files whose AST is consumed synchronously within
    // a single call. Here the bundled source flows through the full
    // transform -> emit pipeline, and a concurrent transpile would
    // overwrite the virtual file mid-walk; the expressions the transformer
    // parses along the way live in this project too.
    // Fresh-Project construction at this granularity (one per compile) is
    // a small fraction of total compile time.
    // No lib files: the transformer reads the AST alone and never consults the type checker.
    const project = new Project({ useInMemoryFileSystem: true, skipLoadingLibFiles: true });
    const sourceFile = project.createSourceFile("bundled.ts", bundled);

    // 3. Transform AST to IR; arguments arrive formatted, so nothing rewrites them afterwards.
    const transformer = new TBAFTransformer();
    const ir = { ...transformer.transform(sourceFile), sourceFile: filePath, traTag };

    // 4. Emit BAF text
    return emitBAF(ir);
}

/**
 * Transpile TBAF to BAF, returning the output string without writing to disk.
 * Used by the CLI where the caller controls file I/O. The source map is not returned here: the CLI writes
 * a file and reports the compiler's own output, with no editor to place a diagnostic in.
 */
export async function transpile(filePath: string, text: string): Promise<string> {
    const result = await tbaf.transpile(filePath, text);
    return result.output;
}

/**
 * As `transpile`, keeping the record of where each generated line came from.
 * Used by the LSP compile handler, which places the BAF compiler's errors back on the author's lines.
 */
export async function transpileWithSourceMap(filePath: string, text: string): Promise<TBAFResult> {
    return tbaf.transpile(filePath, text);
}

/** Refuses a `let` or `var` in a source the author wrote, read before the bundler rewrites its declarations. */
function checkDeclarations(file: string, text: string): void {
    const source = getSharedProject().createSourceFile("tbaf-declaration-check.ts", text, { overwrite: true });
    try {
        checkDeclarationKinds(source);
    } catch (error) {
        throw TranspileError.wrap(error, { file });
    }
}
