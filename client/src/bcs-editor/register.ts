/**
 * Wiring that makes opening a `.bcs` open its decompiled source.
 *
 * Same shape as the `.int` view: a custom editor claims the pattern, hands the file to a text editor on the
 * scheme below, and closes itself - which is what makes a plain double-click in the explorer, or a click in
 * the game-resources tree, land on script rather than on a wall of markers and numbers.
 *
 * The language is set explicitly because the document is named `<file>.bcs.baf` and lives on a custom scheme;
 * leaving it to the extension mapping would work today and break the moment anything else claims `.baf`.
 */

import * as vscode from "vscode";
import { BCS_SCHEME, viewPath } from "./document";
import { BcsFileSystemProvider, type SymbolsFor } from "./filesystem";

/** Opens the file as source, then disposes itself so no empty custom-editor tab is left behind. */
class BcsEditorProvider implements vscode.CustomReadonlyEditorProvider {
    static readonly viewType = "bgforge.bcsEditor";

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
            const view = vscode.Uri.from({ scheme: BCS_SCHEME, path: viewPath(document.uri.fsPath) });
            const text = await vscode.workspace.openTextDocument(view);
            await vscode.languages.setTextDocumentLanguage(text, "weidu-baf");
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

export function registerBcsEditor(context: vscode.ExtensionContext, symbolsFor: SymbolsFor): vscode.Disposable {
    const files = new BcsFileSystemProvider(symbolsFor, context.extensionPath);
    return vscode.Disposable.from(
        files,
        // Not `isReadonly`: a script with a game behind it saves back over itself, and one without says so
        // per document through `stat` instead - the scheme itself is writable either way.
        vscode.workspace.registerFileSystemProvider(BCS_SCHEME, files, { isCaseSensitive: true }),
        vscode.window.registerCustomEditorProvider(BcsEditorProvider.viewType, new BcsEditorProvider(), {
            supportsMultipleEditorsPerDocument: false,
        }),
    );
}
