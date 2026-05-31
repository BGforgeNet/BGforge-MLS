import * as vscode from "vscode";
import { BinaryEditorProvider } from "./provider";

/**
 * Register the worker-backed binary editor provider plus its add-entry command.
 * The returned disposable composes the registration and command so extension teardown
 * cleans everything in one push to `context.subscriptions`.
 */
export function registerBinaryEditor(context: vscode.ExtensionContext): vscode.Disposable {
    const provider = new BinaryEditorProvider(context);
    const editorRegistration = vscode.window.registerCustomEditorProvider(BinaryEditorProvider.viewType, provider, {
        supportsMultipleEditorsPerDocument: true,
        webviewOptions: { retainContextWhenHidden: true },
    });

    const addCommand = vscode.commands.registerCommand("bgforge.binaryEditor.addEntry", async () => {
        const document = provider.getActiveDocument();
        if (!document) return;
        // Placeholder target: full selection tracking arrives in Plan 3. A fixed
        // "Global Variables" array exercises the structure-op path end to end.
        const response = await document.bridge.send({
            type: "structureOp",
            sessionId: document.sessionId,
            op: { op: "add", namePath: ["Global Variables"] },
        });
        if (response.type === "structure") document.pushEdit("Add entry");
    });

    return vscode.Disposable.from(editorRegistration, addCommand);
}
