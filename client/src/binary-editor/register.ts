import * as vscode from "vscode";
import type { SlotLabelResolver, StrrefResolver } from "../ie-resources/strref";
import { BinaryEditorProvider } from "./provider";

/** Register the worker-backed binary editor provider. */
export function registerBinaryEditor(
    context: vscode.ExtensionContext,
    gameLookups: { strref: StrrefResolver; slotLabel: SlotLabelResolver },
): vscode.Disposable {
    const provider = new BinaryEditorProvider(context, gameLookups);
    return vscode.window.registerCustomEditorProvider(BinaryEditorProvider.viewType, provider, {
        supportsMultipleEditorsPerDocument: true,
        webviewOptions: { retainContextWhenHidden: true },
    });
}
