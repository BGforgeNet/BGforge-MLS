/**
 * Compiling an edited script back to the compiled file it came from.
 *
 * Same shape as the `.int` editor's compiler beside it: the parser is built once and kept, because loading
 * the grammar costs more than every compile that follows and a save must not pay it. It is built lazily
 * rather than at activation because most sessions never open a compiled script, and `Language.load` is the
 * same WASM setup the server serialises for its own parsers - doing it eagerly here would compete with that
 * for no benefit.
 *
 * The grammar is read from the server's build output, which is the one copy of it the extension ships; a
 * second copy under the client would be one more thing for a grammar change to leave stale.
 */

import * as fs from "fs";
import * as path from "path";
import { Language, Parser } from "web-tree-sitter";
import { compileBaf, writeBcs } from "../../../compilers/bcs/src/index";
import type { BcsNaming } from "./document";

let ready: Promise<Parser> | undefined;

function load(extensionPath: string): Promise<Parser> {
    const wasm = (name: string): string => path.join(extensionPath, "server", "out", name);
    return (async () => {
        await Parser.init({ wasmBinary: fs.readFileSync(wasm("web-tree-sitter.wasm")) });
        const parser = new Parser();
        parser.setLanguage(await Language.load(wasm("tree-sitter-baf.wasm")));
        return parser;
    })();
}

/**
 * Compiles `text` into the bytes that replace the script on disk.
 *
 * BCS is ASCII, and latin1 is the byte-preserving encoding of it - the same reading the file was decompiled
 * through, so a quoted field holding a high byte survives the round trip rather than becoming a replacement
 * character.
 */
export async function compileForSave(extensionPath: string, text: string, naming: BcsNaming): Promise<Buffer> {
    ready ??= load(extensionPath);
    const parser = await ready;
    return Buffer.from(writeBcs(compileBaf(parser, text, naming.compileSymbols, naming.engine)), "latin1");
}
