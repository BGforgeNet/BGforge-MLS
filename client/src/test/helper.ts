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
    await ext.activate();
    try {
        const doc = await vscode.workspace.openTextDocument(docUri);
        await vscode.window.showTextDocument(doc);
        await sleep(2000); // Wait for server activation
    } catch (e) {
        console.error(e);
    }
}

async function sleep(ms: number) {
    return new Promise((resolve) => { setTimeout(resolve, ms); });
}

const getDocPath = (p: string) => {
    return path.resolve(__dirname, "../../testFixture", p);
};
export const getDocUri = (p: string) => {
    return vscode.Uri.file(getDocPath(p));
};
