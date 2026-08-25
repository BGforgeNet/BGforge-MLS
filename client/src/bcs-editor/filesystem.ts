/**
 * The `.bcs` script view: a compiled Infinity Engine script served as editable BAF.
 *
 * Only what makes this view differ from the `.int` one lives here - the rendering, the compile, and the two
 * reasons a script has nothing to compile into. Everything else is `script-view/filesystem.ts`.
 */

import * as vscode from "vscode";
import { BcsCompileError } from "../../../compilers/bcs/src/index";
import { ScriptViewFileSystemProvider, type ScriptView, type ScriptViewProblem } from "../script-view/filesystem";
import { compileForSave } from "./compiler";
import { BCS_SCHEME, VIEW_SUFFIX, render, type BcsNaming } from "./document";

/**
 * Resolves the install's naming tables and engine for a document, or undefined when it has no game behind it.
 *
 * Asked about the SOURCE, never a view URI: which game a document belongs to is decided by the source's own
 * scheme and query (a tree-opened script names its game there), and a resolver that has never heard of a
 * scheme answers "no game" for every script on it.
 */
export type SymbolsFor = (source: vscode.Uri) => BcsNaming | undefined;

export function bcsScriptView(symbolsFor: SymbolsFor, extensionPath: string): ScriptView {
    /**
     * Why a save could not write this document back, or undefined when it can.
     *
     * ONE definition, read by `stat` to mark the tab readonly and by `writeFile` to refuse: what the tab shows
     * in these cases is a notice rather than source, and compiling a notice would write a script with no
     * blocks over the source. Two predicates that drifted apart would leave exactly that gap.
     */
    const refuseFile = async (source: vscode.Uri): Promise<string | undefined> => {
        if (symbolsFor(source) === undefined) {
            return (
                `${source.fsPath} cannot be saved without the game it belongs to: every name in it is a number ` +
                `that install's own tables give a meaning to. Open a game, then reopen this file.`
            );
        }
        // A zero-byte file is a real thing an install ships, and is not a script with no blocks.
        const stats = await vscode.workspace.fs.stat(source);
        if (stats.size === 0) return `${source.fsPath} holds no script, so there is nothing to compile into it.`;
        return undefined;
    };

    return {
        scheme: BCS_SCHEME,
        diagnostics: "bgforge-bcs",
        viewSuffix: VIEW_SUFFIX,
        render: (source) => render(source, symbolsFor(source)),
        refuseFile,
        problemsOf: (error): readonly ScriptViewProblem[] =>
            error instanceof BcsCompileError ? error.diagnostics : [],
        detailOf: (error) => (error instanceof Error ? error.message : String(error)),
        // Established by `refuseFile`, which the shared provider runs before this and is the only thing that
        // reports a document with no game.
        compile: (source, text) => compileForSave(extensionPath, text, symbolsFor(source)!),
    };
}

export class BcsFileSystemProvider extends ScriptViewFileSystemProvider {
    constructor(symbolsFor: SymbolsFor, extensionPath: string) {
        super(bcsScriptView(symbolsFor, extensionPath));
    }
}
