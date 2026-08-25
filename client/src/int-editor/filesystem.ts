/**
 * The `.int` script view: a compiled Fallout script served as editable SSL.
 *
 * Only what makes this view differ from the `.bcs` one lives here - the rendering, the compile, and the one
 * refusal a disassembly listing needs. Everything else is `script-view/filesystem.ts`.
 */

import * as vscode from "vscode";
import { problemsOf } from "../../../compilers/ssl/src/problems";
import { ScriptViewFileSystemProvider, type ScriptView } from "../script-view/filesystem";
import { compileForSave } from "./compiler";
import { INT_SCHEME, LISTING_MARKER, VIEW_SUFFIX, render } from "./document";

export function intScriptView(extensionPath: string): ScriptView {
    return {
        scheme: INT_SCHEME,
        diagnostics: "bgforge-int",
        viewSuffix: VIEW_SUFFIX,
        render,
        problemsOf,
        // A listing describes the code, it is not the code - so compiling the comments back would write an
        // empty script over the source. Keyed off the TEXT rather than the source: the same `.int` renders as
        // source the moment it can be decompiled.
        refuseText: (source, text) =>
            text.includes(LISTING_MARKER)
                ? `${source.fsPath} opened as a disassembly listing because it could not be decompiled, so ` +
                  `there is no source to compile back. Edit the original .ssl and compile it instead.`
                : undefined,
        compile: async (source, text) =>
            compileForSave(extensionPath, text, await vscode.workspace.fs.readFile(source)),
    };
}

export class IntFileSystemProvider extends ScriptViewFileSystemProvider {
    constructor(extensionPath: string) {
        super(intScriptView(extensionPath));
    }
}
