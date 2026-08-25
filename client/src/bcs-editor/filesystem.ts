/**
 * The `.bcs` script view: a compiled Infinity Engine script served as editable BAF.
 *
 * Only what makes this view differ from the `.int` one lives here - the rendering, the compile, and the two
 * reasons a script has nothing to compile into. Everything else is `script-view/filesystem.ts`.
 */

import * as fs from "fs";
import { BcsCompileError } from "../../../compilers/bcs/src/index";
import { ScriptViewFileSystemProvider, type ScriptView, type ScriptViewProblem } from "../script-view/filesystem";
import { compileForSave } from "./compiler";
import { BCS_SCHEME, VIEW_SUFFIX, render, type BcsNaming } from "./document";

/**
 * Resolves the install's naming tables and engine for a document, or undefined when it has no game behind it.
 *
 * Asked about the SOURCE file, never a view URI: which game a document belongs to is decided by its scheme, and
 * a resolver that has never heard of `bgforge-bcs` answers "no game" for every script.
 */
export type SymbolsFor = (sourceFile: string) => BcsNaming | undefined;

export function bcsScriptView(symbolsFor: SymbolsFor, extensionPath: string): ScriptView {
    /**
     * Why a save could not write this document back, or undefined when it can.
     *
     * ONE definition, read by `stat` to mark the tab readonly and by `writeFile` to refuse: what the tab shows
     * in these cases is a notice rather than source, and compiling a notice would write a script with no
     * blocks over the file. Two predicates that drifted apart would leave exactly that gap.
     */
    const refuseFile = (file: string): string | undefined => {
        if (symbolsFor(file) === undefined) {
            return (
                `${file} cannot be saved without the game it belongs to: every name in it is a number that ` +
                `install's own tables give a meaning to. Open a game, then reopen this file.`
            );
        }
        // A zero-byte file is a real thing an install ships, and is not a script with no blocks.
        if (fs.statSync(file).size === 0) return `${file} holds no script, so there is nothing to compile into it.`;
        return undefined;
    };

    return {
        scheme: BCS_SCHEME,
        diagnostics: "bgforge-bcs",
        viewSuffix: VIEW_SUFFIX,
        render: (file) => render(file, symbolsFor(file)),
        refuseFile,
        problemsOf: (error): readonly ScriptViewProblem[] =>
            error instanceof BcsCompileError ? error.diagnostics : [],
        detailOf: (error) => (error instanceof Error ? error.message : String(error)),
        // Established by `refuseFile`, which the shared provider runs before this and is the only thing that
        // reports a document with no game.
        compile: (file, text) => compileForSave(extensionPath, text, symbolsFor(file)!),
    };
}

export class BcsFileSystemProvider extends ScriptViewFileSystemProvider {
    constructor(symbolsFor: SymbolsFor, extensionPath: string) {
        super(bcsScriptView(symbolsFor, extensionPath));
    }
}
