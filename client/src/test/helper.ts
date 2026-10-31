/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 * ------------------------------------------------------------------------------------------ */

import * as path from "path";
import * as vscode from "vscode";

/**
 * Activates the vscode.lsp-sample extension
 */
export async function activate(docUri: vscode.Uri) {
    // The extensionId is `publisher.name` from package.json
    const ext = vscode.extensions.getExtension("bgforge.bgforge-mls")!;
    // Activation resolves once the language client has started, so the server is ready; the client sends the
    // document's open notification before any later request, so the tests need no extra wait.
    await ext.activate();
    const doc = await vscode.workspace.openTextDocument(docUri);
    await vscode.window.showTextDocument(doc);
}

const getDocPath = (p: string) => {
    return path.resolve(__dirname, "../../testFixture", p);
};
export const getDocUri = (p: string) => {
    return vscode.Uri.file(getDocPath(p));
};
