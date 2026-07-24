import * as vscode from "vscode";
import { ImageEditorProvider } from "./provider";

/** Register the FRM/BAM animation custom editor. */
export function registerImageEditor(context: vscode.ExtensionContext): vscode.Disposable {
    const provider = new ImageEditorProvider(context);
    return vscode.window.registerCustomEditorProvider(ImageEditorProvider.viewType, provider, {
        supportsMultipleEditorsPerDocument: true,
        webviewOptions: { retainContextWhenHidden: true },
    });
}
