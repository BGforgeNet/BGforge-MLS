/**
 * The text side of a compiled Infinity Engine script: which URI stands for it, and what it reads as.
 *
 * A `.bcs` is ASCII, so an editor will happily show it - as nested two-letter markers and bare numbers, which
 * says nothing. Decompiling it into a document named `<file>.baf` means the tab reads as script source and
 * every language feature keyed on the extension comes from the weidu-baf support that already exists.
 *
 * The view is READ-ONLY, unlike the `.int` one beside it. That is not a gap: recovering source from a `.bcs`
 * is a format read, but compiling BAF back is a compiler this repo does not have, and an editable buffer that
 * cannot be saved is worse than an honest viewer.
 */

import * as fs from "fs";
import { decompileBcs, readBcs, type BcsSymbols } from "../../../compilers/bcs/src/index";

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
export function render(file: string, symbols: BcsSymbols | undefined): string {
    const text = fs.readFileSync(file, "latin1");
    if (symbols === undefined) return noGameNotice(file);
    // An empty file is a real thing an install ships, and it is not a script with no blocks - the reader
    // refuses it, and a comment saying so is more use than an empty tab.
    if (text === "") return `// ${file} is empty - it holds no script at all.\n`;
    return decompileBcs(readBcs(text), symbols);
}
