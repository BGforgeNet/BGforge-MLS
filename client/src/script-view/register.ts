/**
 * Wiring that makes opening any compiled script open its decompiled source.
 *
 * VS Code decides what a `file:` URI opens as, and an extension cannot change how one is read - so a custom
 * editor claims every format in the registry, and its only job is to hand the file to a text editor on the
 * view scheme and close itself. Registering it as the DEFAULT editor for those patterns is what makes a plain
 * double-click in the explorer, or a click in the game-resources tree, land on script rather than on markers
 * and numbers, with no command to run and nothing to choose.
 *
 * The language is set explicitly rather than left to the file-extension mapping: the document is named
 * `<file><suffix>` on a custom scheme, and two of this extension's languages claim `.ssl`, so the name alone
 * would not settle which one a decompiled script is.
 */

import * as vscode from "vscode";
import { bcsScriptView, type SymbolsFor } from "../bcs-editor/filesystem";
import { intScriptView } from "../int-editor/filesystem";
import { ScriptViewFileSystemProvider, scriptViewUri, type ScriptView } from "./filesystem";
import {
    SCRIPT_EDITOR_VIEW_TYPE,
    SCRIPT_FORMATS,
    SCRIPT_VIEW_SCHEME,
    scriptFormatForPath,
    type ScriptFormatKind,
} from "./formats";

/** Opens the file as source, then disposes itself so no empty custom-editor tab is left behind. */
class ScriptEditorProvider implements vscode.CustomReadonlyEditorProvider {
    static readonly viewType = SCRIPT_EDITOR_VIEW_TYPE;

    openCustomDocument(uri: vscode.Uri): vscode.CustomDocument {
        return {
            uri,
            dispose() {
                /* the document is the URI; the text editor that replaces this owns everything else */
            },
        };
    }

    async resolveCustomEditor(document: vscode.CustomDocument, panel: vscode.WebviewPanel): Promise<void> {
        try {
            const format = scriptFormatForPath(document.uri.path);
            if (format === undefined) throw new Error("not a compiled script this editor serves");
            const text = await vscode.workspace.openTextDocument(scriptViewUri(document.uri));
            await vscode.languages.setTextDocumentLanguage(text, format.language);
            // Into the group this panel occupies, so the source lands where the file was opened rather than
            // beside it. Disposing comes last: VS Code still reads the panel while resolving, and taking it
            // away first fails the open with "OverlayWebview has been disposed".
            await vscode.window.showTextDocument(text, { preview: false, viewColumn: panel.viewColumn });
        } catch (error) {
            const reason = error instanceof Error ? error.message : String(error);
            void vscode.window.showErrorMessage(`Could not open ${document.uri.fsPath}: ${reason}`);
        }
        panel.dispose();
    }
}

/**
 * The renderer and compiler a format kind is served by.
 *
 * Exhaustive on purpose: a format added to the registry with a new kind stops this compiling until it has an
 * implementation, and one reusing an existing kind needs no code at all. That is what makes the registry the
 * only place a format has to be named.
 */
function viewForKind(kind: ScriptFormatKind, symbolsFor: SymbolsFor, extensionPath: string): ScriptView {
    switch (kind) {
        case "fallout-int":
            return intScriptView(extensionPath);
        case "infinity-bcs":
            return bcsScriptView(symbolsFor, extensionPath);
        default: {
            const unhandled: never = kind;
            throw new Error(`no script view for format kind ${String(unhandled)}`);
        }
    }
}

export function registerScriptViews(context: vscode.ExtensionContext, symbolsFor: SymbolsFor): vscode.Disposable {
    const views = new Map<string, ScriptView>(
        SCRIPT_FORMATS.map((format) => [format.ext, viewForKind(format.kind, symbolsFor, context.extensionPath)]),
    );
    const files = new ScriptViewFileSystemProvider(views);
    return vscode.Disposable.from(
        files,
        // Not `isReadonly`: a script with everything it needs behind it saves back over itself, and one
        // without says so per document through `stat` instead - the scheme itself is writable either way.
        vscode.workspace.registerFileSystemProvider(SCRIPT_VIEW_SCHEME, files, { isCaseSensitive: true }),
        vscode.window.registerCustomEditorProvider(ScriptEditorProvider.viewType, new ScriptEditorProvider(), {
            supportsMultipleEditorsPerDocument: false,
        }),
    );
}
