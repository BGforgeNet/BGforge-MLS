/**
 * Where the compile command sends a document.
 *
 * A decompiled script has no source file to compile from - it IS the compiled file, rendered - and
 * saving it already compiles the text back over that file. Compiling therefore routes to the save, so
 * the two entry points share one implementation rather than a second one writing the same bytes.
 *
 * The outcome is always reported. Success here writes a file the editor never shows, so without a
 * message the command is indistinguishable from one that did nothing - which is exactly how it read
 * before. A refused save says nothing extra: the refusal already carries its own reason.
 */

import * as path from "path";
import * as vscode from "vscode";
import { sourceUriOf } from "./filesystem";
import { SCRIPT_VIEW_SCHEME } from "./formats";

export async function routeCompile(document: vscode.TextDocument, toServer: () => Promise<void>): Promise<void> {
    // Every compiled format, not one of them: this asks whether the document IS a rendering of a compiled
    // file, which the scheme answers for all of them at once. Naming a single format's scheme here left the
    // command silently doing nothing on the others - the server refuses a compile for any URI that is not a
    // file on disk, and says so only in the log.
    if (document.uri.scheme !== SCRIPT_VIEW_SCHEME) {
        await toServer();
        return;
    }
    const name = path.basename(sourceUriOf(document.uri).fsPath);
    // Not a rewrite of identical bytes: an unedited document already matches the file, and rewriting
    // would move its timestamp and wake every watcher for nothing. Saying so is the useful part.
    if (!document.isDirty) {
        void vscode.window.showInformationMessage(`${name} is already up to date`);
        return;
    }
    if (await document.save()) {
        void vscode.window.showInformationMessage(`Compiled ${name}`);
    }
}
