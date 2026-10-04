import * as vscode from "vscode";
import { BinaryEditorProvider, type GameResolvers } from "./provider";

/** Register the worker-backed binary editor provider. */
export function registerBinaryEditor(context: vscode.ExtensionContext, gameLookups: GameResolvers): vscode.Disposable {
    const provider = new BinaryEditorProvider(context, gameLookups);
    const registration = vscode.window.registerCustomEditorProvider(BinaryEditorProvider.viewType, provider, {
        supportsMultipleEditorsPerDocument: true,
        webviewOptions: { retainContextWhenHidden: true },
    });
    return vscode.Disposable.from(registration, provider);
}
