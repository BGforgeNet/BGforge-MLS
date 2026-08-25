/**
 * Compiling an edited decompiled script back to the bytecode it came from.
 *
 * The grammar's loading and caching is `script-view/parser.ts`, shared with the `.bcs` view.
 */

import { buildProgram, emitProgram } from "../../../compilers/ssl/src/compile";
import { decompileToProgram } from "../../../compilers/ssl/src/int/decompile";
import { preserveStringOrder } from "../../../compilers/ssl/src/int/string-order";
import { loadParser } from "../script-view/parser";

/**
 * Compiles `text` into the bytecode that replaces `previous`.
 *
 * The string table is laid out as `previous` had it, so saving a script whose text has not changed
 * reproduces the file it was opened from rather than an equivalent one with the table rebuilt in the
 * printer's order. A file that cannot be decompiled has no order to preserve and simply compiles fresh
 * - it is only ever reached when the previous bytes came from somewhere other than this editor.
 */
export async function compileForSave(extensionPath: string, text: string, previous: Uint8Array): Promise<Uint8Array> {
    const parser = await loadParser(extensionPath, "tree-sitter-ssl.wasm");
    const program = buildProgram(parser, text);
    try {
        const before = decompileToProgram(previous).stringLiterals;
        if (before) program.stringLiterals = preserveStringOrder(program.stringLiterals ?? [], before);
    } catch {
        // Not a decompilable script, so there is no previous layout to match. The compile itself is
        // unaffected; only the table's order would have been.
    }
    return emitProgram(program);
}
