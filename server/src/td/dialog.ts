/**
 * TD dialog parser for preview.
 * Transpiles TD to D in memory (without writing files), then parses the D output
 * with the existing D parser.
 */

import { Project, SourceFile } from "ts-morph";
import { uriToPath } from "../common";
import { extractTraTag } from "../../../transpilers/common/transpiler-utils";
import { bundle } from "../../../transpilers/common/bundle";
import { emitD } from "../../../transpilers/td/src/emit";
import { parse } from "../../../transpilers/td/src/parse";
import type { DDialogData } from "../../../shared/dialog-types";
import { parseDDialog } from "../weidu-d/dialog";
import { isInitialized } from "../weidu-d/parser";

// Reused across calls to avoid re-initializing the TypeScript compiler.
// The previous source file is removed before creating a new one.
const project = new Project({ useInMemoryFileSystem: true });
let prevSourceFile: SourceFile | undefined;

/**
 * Transpile TD source and parse it into DDialogData for dialog tree preview.
 *
 * @param uri VSCode URI of the .td file
 * @param text TD source text
 * @returns DDialogData suitable for the D tree HTML builder
 */
export async function parseTDDialog(uri: string, text: string): Promise<DDialogData> {
    // Bail out early if the D tree-sitter parser isn't ready yet,
    // rather than wasting work on transpilation that can't be visualized.
    if (!isInitialized()) {
        return { blocks: [], states: [] };
    }

    const filePath = uriToPath(uri);

    // Extract @tra tag before bundling (esbuild strips comments).
    // Required for emitD to produce valid D output that parseDDialog can parse.
    const traTag = extractTraTag(text);

    // 1. Bundle imports
    const bundled = await bundle(filePath, text);

    // 2. Parse bundled code with ts-morph (reuse cached project)
    if (prevSourceFile) {
        project.removeSourceFile(prevSourceFile);
    }
    const sourceFile = project.createSourceFile("bundled.ts", bundled);
    prevSourceFile = sourceFile;

    // 3. Parse AST to IR
    const ir = { ...parse(sourceFile), sourceFile: filePath, traTag };

    // 4. Emit D text
    const dText = emitD(ir);

    // 5. Parse D text with the existing D dialog parser
    return parseDDialog(dText);
}
