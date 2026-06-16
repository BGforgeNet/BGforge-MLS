/**
 * TD dialog parser for preview.
 * Transpiles TD to D in memory (without writing files) via the public
 * @bgforge/transpile surface, then parses the D output with the existing D parser.
 */

import { uriToPath } from "../uri-utils";
// Consume the public @bgforge/transpile surface (the barrel), not the internal
// bundle/parse/emit modules. td() runs the same bundle -> parse -> emit pipeline
// and returns the D output. Imported by relative path so esbuild bundles it into
// the server rather than treating it as an external npm dependency.
import { td } from "../../../transpilers/src/index";
import type { DDialogData } from "../../../shared/dialog-types";
import { parseDDialog } from "../weidu-d/dialog";
import { isInitialized } from "../../../shared/parsers/weidu-d";

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
    const { output } = await td(filePath, text);
    return parseDDialog(output);
}
