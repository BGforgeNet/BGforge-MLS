import * as vscode from "vscode";
import { BinaryEditorProvider } from "./provider";

/** Register the worker-backed binary editor provider. */
export function registerBinaryEditor(context: vscode.ExtensionContext): vscode.Disposable {
    const provider = new BinaryEditorProvider(context);
    return vscode.window.registerCustomEditorProvider(BinaryEditorProvider.viewType, provider, {
        supportsMultipleEditorsPerDocument: true,
        webviewOptions: { retainContextWhenHidden: true },
    });
}
