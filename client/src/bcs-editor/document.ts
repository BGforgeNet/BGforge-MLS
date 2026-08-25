/**
 * The text side of a compiled Infinity Engine script: which URI stands for it, and what it reads as.
 *
 * A `.bcs` is ASCII, so an editor will happily show it - as nested two-letter markers and bare numbers, which
 * says nothing. Decompiling it into a document named `<file>.baf` means the tab reads as script source and
 * every language feature keyed on the extension comes from the weidu-baf support that already exists.
 *
 * The view is EDITABLE, like the `.int` one beside it: saving compiles the source back over the file it came
 * from. With no game open it stays read-only, because there is then nothing to resolve names against in
 * either direction - the tab shows why instead of the script.
 */

import * as fs from "fs";
import type { IeScriptStyle } from "../../../binary/src/index";
import {
    decompileBcs,
    readBcs,
    type BcsCompileSymbols,
    type BcsEngine,
    type BcsSymbols,
} from "../../../compilers/bcs/src/index";

/**
 * Everything the install decides about how a script reads and writes: the tables that give its numbers names,
 * the same tables read the other way for compiling, and the engine that says which field each number is. All
 * come from one open game, so they travel together - and resolving both directions from one game is what
 * stops a save from writing names a different install gave the numbers.
 */
export interface BcsNaming {
    readonly symbols: BcsSymbols;
    readonly compileSymbols: BcsCompileSymbols;
    readonly engine: BcsEngine;
}

/**
 * The BCS engine a detected script style names.
 *
 * The detector already reports the axis the decompiler needs - it is how the games themselves are told apart -
 * so this is a total mapping with no fallback. The two Baldur's Gate styles collapse because they share an
 * object layout and their naming differences live in the install's own tables, which are read either way.
 */
export function bcsEngineForScriptStyle(style: IeScriptStyle): BcsEngine {
    switch (style) {
        case "iwd1":
            return "iwd";
        case "iwd2":
            return "iwd2";
        case "pst":
            return "pst";
        default:
            return "bg";
    }
}

export const BCS_SCHEME = "bgforge-bcs";

/**
 * The suffix that makes the view document read as script source.
 *
 * This module deliberately imports no `vscode`: what a script renders as is the part worth testing, and the
 * client suite has no extension host to import that from. Building the URI itself stays in `register.ts`.
 */
export const VIEW_SUFFIX = ".baf";

export function viewPath(sourceFile: string): string {
    return `${sourceFile}${VIEW_SUFFIX}`;
}

export function sourcePath(view: { path: string }): string {
    return view.path.replace(/\.baf$/, "");
}

/**
 * Why a script cannot be shown without a game, as a BAF comment.
 *
 * Every name in a script - each trigger, action, and object field - is a number the install's own IDS tables
 * name, and editions and mods both change them. With no game there is nothing to resolve against, and the
 * honest output would be bare numbers: readable as neither script nor data. Saying so beats rendering it.
 */
function noGameNotice(file: string): string {
    return [
        `// ${file} is a compiled script, and decompiling one needs the game it belongs to.`,
        "//",
        "// Every trigger, action and object field is stored as a number that the install's own TRIGGER.IDS,",
        "// ACTION.IDS and friends give a name to - and those tables differ between editions and are extended",
        "// by mods, so there is no vendored copy to fall back on.",
        "//",
        "// Open a game in the BGforge IE Game Resources view, or set bgforge.weidu.gamePath, then reopen this",
        "// file.",
        "",
    ].join("\n");
}

/** The document body for a compiled script: its BAF source, or why there is none to show. */
export function render(file: string, naming: BcsNaming | undefined): string {
    const text = fs.readFileSync(file, "latin1");
    if (naming === undefined) return noGameNotice(file);
    // An empty file is a real thing an install ships, and it is not a script with no blocks - the reader
    // refuses it, and a comment saying so is more use than an empty tab.
    if (text === "") return `// ${file} is empty - it holds no script at all.\n`;
    return decompileBcs(readBcs(text), naming.symbols, naming.engine);
}
