/**
 * Compiling an edited script back to the compiled file it came from.
 *
 * The grammar's loading and caching is `script-view/parser.ts`, shared with the `.int` view.
 */

import { compileBaf, writeBcs } from "../../../compilers/bcs/src/index";
import { loadParser } from "../script-view/parser";
import type { BcsNaming } from "./document";

/**
 * Compiles `text` into the bytes that replace the script on disk.
 *
 * BCS is ASCII, and latin1 is the byte-preserving encoding of it - the same reading the file was decompiled
 * through, so a quoted field holding a high byte survives the round trip rather than becoming a replacement
 * character.
 */
export async function compileForSave(extensionPath: string, text: string, naming: BcsNaming): Promise<Buffer> {
    const parser = await loadParser(extensionPath, "tree-sitter-baf.wasm");
    return Buffer.from(writeBcs(compileBaf(parser, text, naming.compileSymbols, naming.engine)), "latin1");
}
