/**
 * Wiring that makes opening a `.int` open its source.
 *
 * VS Code decides what a `file:` URI opens as, and an extension cannot change how one is read - so a
 * custom editor claims `*.int`, and its only job is to hand the file straight to a text editor on the
 * scheme below and close itself. Registering it as the DEFAULT editor for the pattern is what makes a
 * plain double-click in the explorer land on source rather than on the binary-file placeholder, with no
 * command to run and nothing to choose.
 *
 * The language is set explicitly because two of this extension's languages claim `.ssl`, so the name
 * alone does not settle which one a decompiled Fallout script is.
 */

import * as vscode from "vscode";
import { INT_SCHEME, viewUri } from "./document";
import { IntFileSystemProvider } from "./filesystem";

/** Opens the file as source, then disposes itself so no empty custom-editor tab is left behind. */
class IntEditorProvider implements vscode.CustomReadonlyEditorProvider {
    static readonly viewType = "bgforge.intEditor";

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
            const text = await vscode.workspace.openTextDocument(viewUri(document.uri));
            await vscode.languages.setTextDocumentLanguage(text, "fallout-ssl");
            // Into the group this panel occupies, so the source lands where the file was opened rather
            // than beside it. Disposing comes last: VS Code still reads the panel while resolving, and
            // taking it away first fails the open with "OverlayWebview has been disposed".
            await vscode.window.showTextDocument(text, { preview: false, viewColumn: panel.viewColumn });
        } catch (error) {
            const reason = error instanceof Error ? error.message : String(error);
            void vscode.window.showErrorMessage(`Could not open ${document.uri.fsPath}: ${reason}`);
        }
        panel.dispose();
    }
}

export function registerIntEditor(context: vscode.ExtensionContext): vscode.Disposable {
    const files = new IntFileSystemProvider(context.extensionPath);
    return vscode.Disposable.from(
        files,
        vscode.workspace.registerFileSystemProvider(INT_SCHEME, files, { isCaseSensitive: true }),
        vscode.window.registerCustomEditorProvider(IntEditorProvider.viewType, new IntEditorProvider(), {
            supportsMultipleEditorsPerDocument: false,
        }),
    );
}
