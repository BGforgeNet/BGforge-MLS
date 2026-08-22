/**
 * Compiling an edited decompiled script back to the bytecode it came from.
 *
 * The parser is built once and kept: loading the grammar costs more than every compile that follows,
 * and a save must not pay it. It is built lazily rather than at activation because most sessions never
 * open a compiled script, and `Language.load` is the same WASM setup the server serialises for its own
 * parsers - doing it eagerly here would compete with that for no benefit.
 *
 * The grammar is read from the server's build output, which is the one copy of it the extension ships;
 * a second copy under the client would be one more thing for a grammar change to leave stale.
 */

import * as fs from "fs";
import * as path from "path";
import { Language, Parser } from "web-tree-sitter";
import { buildProgram, emitProgram } from "../../../compilers/ssl/src/compile";
import { decompileToProgram } from "../../../compilers/ssl/src/int/decompile";
import { preserveStringOrder } from "../../../compilers/ssl/src/int/string-order";

let ready: Promise<Parser> | undefined;

function load(extensionPath: string): Promise<Parser> {
    const wasm = (name: string) => path.join(extensionPath, "server", "out", name);
    return (async () => {
        await Parser.init({ wasmBinary: fs.readFileSync(wasm("web-tree-sitter.wasm")) });
        const parser = new Parser();
        parser.setLanguage(await Language.load(wasm("tree-sitter-ssl.wasm")));
        return parser;
    })();
}

/**
 * Compiles `text` into the bytecode that replaces `previous`.
 *
 * The string table is laid out as `previous` had it, so saving a script whose text has not changed
 * reproduces the file it was opened from rather than an equivalent one with the table rebuilt in the
 * printer's order. A file that cannot be decompiled has no order to preserve and simply compiles fresh
 * - it is only ever reached when the previous bytes came from somewhere other than this editor.
 */
export async function compileForSave(extensionPath: string, text: string, previous: Uint8Array): Promise<Uint8Array> {
    ready ??= load(extensionPath);
    const parser = await ready;
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
