/**
 * TSSL dialog parser for preview.
 * Transpiles TSSL to SSL in memory (without writing files), then parses the SSL output
 * with the existing Fallout SSL dialog parser.
 */

import { uriToPath } from "../common";
import { parseDialog, type DialogData } from "../dialog";
import { isInitialized } from "../../../shared/parsers/fallout-ssl";
import { transpile } from "../../../transpilers/tssl/src/index";

/**
 * Transpile TSSL source and parse it into DialogData for dialog tree preview.
 *
 * @param uri VSCode URI of the .tssl file
 * @param text TSSL source text
 * @returns DialogData suitable for the SSL tree HTML builder
 */
export async function parseTSSLDialog(uri: string, text: string): Promise<DialogData> {
    // Bail out early if the SSL tree-sitter parser isn't ready yet,
    // rather than wasting work on transpilation that can't be visualized.
    if (!isInitialized()) {
        return { nodes: [], entryPoints: [] };
    }

    const filePath = uriToPath(uri);
    const sslText = await transpile(filePath, text);
    return parseDialog(sslText);
}
