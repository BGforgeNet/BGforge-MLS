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
import { emitBAF } from "./emit";
import { type BAFScript, isOrGroup } from "./ir";
import { TBAFTransformer } from "./transform";

const tbaf = createTranspiler<string>({
    sourceExtension: EXT_TBAF,
    targetExtension: ".baf",
    name: "TBAF",

    async transpileCore(filePath, text, traTag) {
        // 1. Bundle imports (skips bundling internally for files without imports)
        const bundled = await bundle(filePath, text);

        // 2. Parse bundled code
        const project = new Project({ useInMemoryFileSystem: true });
        const sourceFile = project.createSourceFile("bundled.ts", bundled);

        // 3. Transform AST to IR
        const transformer = new TBAFTransformer();
        const ir = { ...transformer.transform(sourceFile), sourceFile: filePath, traTag };

        // 4. Apply BAF-specific fixups to IR
        applyBAFFixups(ir);

        // 5. Emit BAF text
        return emitBAF(ir);
    },

    getOutput: (result) => result,
});

export interface TBAFCompileResult {
    bafPath: string;
    events: readonly TranspilerEvent[];
}

/**
 * Compile a TBAF file to BAF, writing the output to disk.
 * Used by the LSP compile handler.
 */
export async function compile(uri: string, text: string): Promise<TBAFCompileResult> {
    const { outPath, events } = await tbaf.compile(uri, text);
    return { bafPath: outPath, events };
}

/**
 * Transpile TBAF to BAF, returning the output string without writing to disk.
 * Used by the CLI where the caller controls file I/O.
 */
export async function transpile(filePath: string, text: string): Promise<string> {
    return tbaf.transpile(filePath, text);
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
