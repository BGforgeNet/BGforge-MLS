import * as vscode from "vscode";
import { BinaryEditorProvider, type GameResolvers } from "./provider";

/** Register the worker-backed binary editor provider. */
export function registerBinaryEditor(context: vscode.ExtensionContext, gameLookups: GameResolvers): vscode.Disposable {
    const provider = new BinaryEditorProvider(context, gameLookups);
    return vscode.window.registerCustomEditorProvider(BinaryEditorProvider.viewType, provider, {
        supportsMultipleEditorsPerDocument: true,
        webviewOptions: { retainContextWhenHidden: true },
    });
}
