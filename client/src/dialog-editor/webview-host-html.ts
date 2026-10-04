/**
 * Binds the dialog webview's HTML to a live `vscode.Webview`.
 *
 * Extracted when the read-only `.dlg` viewer became a second host for the same webview: both providers must
 * produce byte-identical chrome (same CSP, same bundle, same stylesheet), and a copy would drift the moment
 * one of them changed. The pure assembly stays in `buildDialogWebviewHtml`, which is unit-tested without the
 * vscode runtime; this is only the resolution of the webview-bound inputs.
 */

import * as vscode from "vscode";
import { buildDialogWebviewHtml } from "./dialog-webview-html";
import type { DialogAssetsMessage } from "./webview/dialog-assets";
import { generateNonce, getCachedBase64Asset, getCachedJsAsset } from "../webview-assets";
import { DIALOG_ASSET_DIR, DIALOG_ASSET_FILES } from "./dialog-asset-files";

export function buildDialogHostHtml(webview: vscode.Webview, extensionUri: vscode.Uri): string {
    const base = vscode.Uri.joinPath(extensionUri, "client", "out", "dialog-editor", "webview");
    const cssUri = webview.asWebviewUri(vscode.Uri.joinPath(base, "main.css")).toString();
    const scriptBody = getCachedJsAsset(
        "dialog-editor",
        extensionUri.fsPath,
        "client/out/dialog-editor/webview/main.js",
    );
    return buildDialogWebviewHtml({ cspSource: webview.cspSource, cssUri, nonce: generateNonce(), scriptBody });
}

/**
 * Post the graph-layout worker and the regex wasm, which the bundle no longer embeds (see the webview's
 * dialog-assets.ts). Sent on every "ready": a reloaded webview starts with nothing.
 */
export function postDialogAssets(webview: vscode.Webview, extensionUri: vscode.Uri): void {
    const message: DialogAssetsMessage = {
        type: "assets",
        elkWorker: getCachedJsAsset(
            "dialog-elk-worker",
            extensionUri.fsPath,
            `${DIALOG_ASSET_DIR}/${DIALOG_ASSET_FILES.elkWorker.to}`,
        ),
        onigWasm: getCachedBase64Asset(
            "dialog-onig-wasm",
            extensionUri.fsPath,
            `${DIALOG_ASSET_DIR}/${DIALOG_ASSET_FILES.onigWasm.to}`,
        ),
    };
    void webview.postMessage(message);
}
