/**
 * The tree-sitter parser a script view compiles through.
 *
 * One loader for every such view rather than a copy per editor: the `Parser.init` / `Language.load` dance is
 * identical apart from which grammar it loads, and both views want the same thing from it - build it once and
 * keep it, because loading a grammar costs more than every compile that follows and a save must not pay it.
 *
 * Built lazily rather than at activation because most sessions never open a compiled script, and `Language.load`
 * is the same WASM setup the server serialises for its own parsers - doing it eagerly would compete with that
 * for no benefit. The grammar is read from the server's build output, which is the one copy of it the extension
 * ships; a second copy under the client would be one more thing for a grammar change to leave stale.
 */

import * as fs from "fs";
import * as path from "path";
import { Language, Parser } from "web-tree-sitter";

/** One in-flight or settled load per grammar, so two views never load the same wasm twice. */
const loading = new Map<string, Promise<Parser>>();

async function load(extensionPath: string, wasm: string): Promise<Parser> {
    const at = (name: string): string => path.join(extensionPath, "server", "out", name);
    await Parser.init({ wasmBinary: fs.readFileSync(at("web-tree-sitter.wasm")) });
    const parser = new Parser();
    parser.setLanguage(await Language.load(at(wasm)));
    return parser;
}

/**
 * The parser for `wasm`, loaded once per session.
 *
 * A FAILED load is dropped from the cache rather than kept: a rejected promise left in place fails every later
 * save with the same error for the rest of the session, so a transient cause - a file not yet written by a
 * concurrent build, a partially extracted install - could never recover without reloading the window.
 */
export function loadParser(extensionPath: string, wasm: string): Promise<Parser> {
    let ready = loading.get(wasm);
    if (ready === undefined) {
        ready = load(extensionPath, wasm).catch((error: unknown) => {
            loading.delete(wasm);
            throw error;
        });
        loading.set(wasm, ready);
    }
    return ready;
}
