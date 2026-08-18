/**
 * TBAF Transpiler - Main Entry Point
 *
 * Transpiles TypeScript BAF (.tbaf) to BAF format.
 * Uses the shared transpiler pipeline for orchestration.
 */

import { Project } from "ts-morph";
import { EXT_TBAF } from "../../common/extensions";
import { applyHelperFixups } from "../../common/transpiler-utils";
import { createTranspiler, type TranspilerEvent } from "../../common/transpiler-pipeline";
import { bundle } from "../../common/bundle";
import { TranspileError } from "../../common/transpile-error";
import type { SourcePosition } from "../../common/line-map";
import { emitBAF, type EmittedBAF } from "./emit";
import { type BAFScript, isOrGroup } from "./ir";
import { TBAFTransformer } from "./transform";

/** Generated BAF, plus where each of its lines came from in the files the author wrote. */
export interface TBAFResult {
    output: string;
    sourceMap: ReadonlyArray<SourcePosition | undefined>;
}

const tbaf = createTranspiler<TBAFResult>({
    sourceExtension: EXT_TBAF,
    targetExtension: ".baf",
    name: "TBAF",

    async transpileCore(filePath, text, traTag) {
        // 1. Bundle imports (skips bundling internally for files without imports)
        const { code: bundled, origins } = await bundle(filePath, text);

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
    // a single call (as in parseExpressionFromText). Here the bundled
    // source flows through the full transform -> emit pipeline, and a
    // concurrent transpile would overwrite the virtual file mid-walk.
    // Fresh-Project construction at this granularity (one per compile) is
    // a small fraction of total compile time.
    const project = new Project({ useInMemoryFileSystem: true });
    const sourceFile = project.createSourceFile("bundled.ts", bundled);

    // 3. Transform AST to IR
    const transformer = new TBAFTransformer();
    const ir = { ...transformer.transform(sourceFile), sourceFile: filePath, traTag };

    // 4. Apply BAF-specific fixups to IR
    applyBAFFixups(ir);

    // 5. Emit BAF text
    return emitBAF(ir);
}

export interface TBAFCompileResult {
    bafPath: string;
    events: readonly TranspilerEvent[];
    /** For each line of the generated BAF, the file and 0-based line the author wrote it on. */
    sourceMap: ReadonlyArray<SourcePosition | undefined>;
}

/**
 * Compile a TBAF file to BAF, writing the output to disk.
 * Used by the LSP compile handler.
 */
export async function compile(uri: string, text: string): Promise<TBAFCompileResult> {
    const { outPath, events, result } = await tbaf.compile(uri, text);
    return { bafPath: outPath, events, sourceMap: result.sourceMap };
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
 * Apply BAF-specific fixups to the IR.
 * Handles LOCALS/GLOBAL quoting, $obj(), $tra(), point notation replacements.
 */
export function applyBAFFixups(script: BAFScript): void {
    for (const block of script.blocks) {
        // Fix conditions
        for (const cond of block.conditions) {
            if (isOrGroup(cond)) {
                for (const c of cond.conditions) {
                    c.args = fixupArgs(c.args);
                }
            } else {
                cond.args = fixupArgs(cond.args);
            }
        }

        // Fix actions
        for (const action of block.actions) {
            action.args = fixupArgs(action.args);
        }
    }
}

/**
 * Apply WeiDU helper fixups to argument list using shared resolution logic.
 * Returns a new array with fixups applied.
 */
function fixupArgs(args: readonly string[]): string[] {
    return args.map((arg) => applyHelperFixups(arg));
}
