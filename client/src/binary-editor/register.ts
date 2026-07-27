import * as vscode from "vscode";
import type { StrrefResolver } from "../ie-resources/strref";
import { BinaryEditorProvider } from "./provider";

/** Register the worker-backed binary editor provider. */
export function registerBinaryEditor(
    context: vscode.ExtensionContext,
    resolveStrref: StrrefResolver,
): vscode.Disposable {
    const provider = new BinaryEditorProvider(context, resolveStrref);
    return vscode.window.registerCustomEditorProvider(BinaryEditorProvider.viewType, provider, {
        supportsMultipleEditorsPerDocument: true,
        webviewOptions: { retainContextWhenHidden: true },
    });
}
