import * as vscode from "vscode";
import type { GameResourceBytes } from "./document";
import { ImageEditorProvider } from "./provider";

/**
 * Register the FRM/BAM animation custom editor. `resourceBytes` lets a BAM v2 resolve PVRZ pages
 * out of the open game when they do not sit beside the opened file.
 */
export function registerImageEditor(
    context: vscode.ExtensionContext,
    resourceBytes?: GameResourceBytes,
): vscode.Disposable {
    const provider = new ImageEditorProvider(context, resourceBytes);
    return vscode.window.registerCustomEditorProvider(ImageEditorProvider.viewType, provider, {
        supportsMultipleEditorsPerDocument: true,
        webviewOptions: { retainContextWhenHidden: true },
    });
}
