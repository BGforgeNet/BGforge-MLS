/**
 * Dialog editor webview panel host.
 *
 * Opens beside the text editor (the document of record). On open and on edits it
 * runs the existing LSP parse command, maps the result into the format-neutral
 * DialogModel via the shared adapters, and posts it to the Svelte Flow webview.
 * On a save message it splices the edits back into the .d surgically and persists
 * @N text edits to the .tra. WeiDU D is editable; SSL is view-only.
 */

import * as vscode from "vscode";
import { type LanguageClient, type ExecuteCommandParams, ExecuteCommandRequest } from "vscode-languageclient/node";
import { LSP_COMMAND_PARSE_DIALOG, LSP_COMMAND_SAVE_TRA } from "../../../shared/protocol";
import { modelFromD, modelFromSSL, type DialogModel } from "../../../shared/dialog-model";
import { applyDialogEdits, pendingInserts, verifyDialogEditApplied } from "../../../shared/dialog-d-edit";
import type { DDialogData, SSLDialogData } from "../../../shared/dialog-types";
import { generateNonce } from "../webview-assets";

const DIALOG_LANGS = new Set(["fallout-ssl", "weidu-d", "tssl", "td"]);

/** Discriminate the parse payload by shape (D has `blocks`, SSL has `nodes`). */
function toModel(data: unknown): DialogModel | null {
    if (data && typeof data === "object") {
        if ("blocks" in data) return modelFromD(data as DDialogData);
        if ("nodes" in data) return modelFromSSL(data as SSLDialogData);
    }
    return null;
}

function buildHtml(webview: vscode.Webview, extensionUri: vscode.Uri): string {
    const base = vscode.Uri.joinPath(extensionUri, "client", "out", "dialog-editor", "webview");
    const jsUri = webview.asWebviewUri(vscode.Uri.joinPath(base, "main.js"));
    const cssUri = webview.asWebviewUri(vscode.Uri.joinPath(base, "main.css"));
    const nonce = generateNonce();
    // style-src needs 'unsafe-inline' here (not just a nonce) because Svelte Flow
    // positions nodes via runtime inline `transform` styles; the strict nonce-only
    // policy used elsewhere would block them and nodes would stack at the origin.
    const csp =
        `default-src 'none'; img-src ${webview.cspSource} data:; font-src ${webview.cspSource}; ` +
        `style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';`;
    return `<!doctype html><html lang="en"><head><meta charset="UTF-8" />
<meta http-equiv="Content-Security-Policy" content="${csp}" />
<link rel="stylesheet" href="${cssUri}" /></head>
<body><div id="app"></div><script nonce="${nonce}" src="${jsUri}"></script></body></html>`;
}

export function registerDialogEditor(context: vscode.ExtensionContext, client: LanguageClient): vscode.Disposable {
    let panel: vscode.WebviewPanel | undefined;
    let docUri: string | undefined;
    let refreshTimer: ReturnType<typeof setTimeout> | undefined;
    /** The model just written by `save`, awaiting verification against the next re-parse. */
    let pendingVerify: DialogModel | undefined;

    async function refresh(): Promise<void> {
        if (!panel || !docUri) return;
        const params: ExecuteCommandParams = { command: LSP_COMMAND_PARSE_DIALOG, arguments: [{ uri: docUri }] };
        const data = await client.sendRequest(ExecuteCommandRequest.type, params);
        if (!panel) return; // disposed while the request was in flight
        const model = toModel(data);
        if (model) void panel.webview.postMessage({ type: "model", model });
        // Verify a just-saved edit round-tripped faithfully: the server's re-parse of the
        // saved document (`model`) must match what `save` wrote (`pendingVerify`). A mismatch
        // means the serializer produced text that does not reproduce the edit - warn rather
        // than let a silent corruption stand.
        if (model && pendingVerify) {
            const verdict = verifyDialogEditApplied(pendingVerify, model);
            pendingVerify = undefined;
            if (!verdict.ok) {
                void vscode.window.showWarningMessage(
                    `Dialog save may not have applied cleanly: ${verdict.reason}. Review the .d source.`,
                );
            }
        }
    }

    function scheduleRefresh(): void {
        if (refreshTimer) clearTimeout(refreshTimer);
        refreshTimer = setTimeout(() => void refresh(), 300);
    }

    /**
     * Persist edits from the webview back to disk. The .d is edited surgically
     * (applyDialogEdits splices only the changed states, preserving comments, patch
     * blocks, CHAIN syntax, and untouched states); @N text edits are written to the
     * .tra via the server, which owns translation-file resolution. Only WeiDU D is
     * editable - SSL is view-only.
     */
    async function save(edited: DialogModel): Promise<void> {
        if (!docUri || edited.format !== "weidu-d") return;
        const doc = await vscode.workspace.openTextDocument(vscode.Uri.parse(docUri));
        const text = doc.getText();
        // Re-parse the on-disk text to recover the ORIGINAL model (before the webview's
        // edits). applyDialogEdits compares against it so unchanged states keep their exact
        // bytes (@N refs, ++ shorthand, comments) and deletions are detected. The document
        // itself is unchanged by webview edits.
        const params: ExecuteCommandParams = { command: LSP_COMMAND_PARSE_DIALOG, arguments: [{ uri: docUri }] };
        const data = await client.sendRequest(ExecuteCommandRequest.type, params);
        const original = toModel(data) ?? undefined;
        const newText = applyDialogEdits(text, edited, original);
        if (newText !== text) {
            const ws = new vscode.WorkspaceEdit();
            ws.replace(doc.uri, new vscode.Range(doc.positionAt(0), doc.positionAt(text.length)), newText);
            await vscode.workspace.applyEdit(ws);
            // The document change triggers a debounced refresh; have it verify this edit
            // round-tripped (the serializer reproduced exactly what we saved).
            pendingVerify = edited;
        }
        if (edited.messages && Object.keys(edited.messages).length > 0) {
            const traParams: ExecuteCommandParams = {
                command: LSP_COMMAND_SAVE_TRA,
                arguments: [{ uri: docUri, messages: edited.messages }],
            };
            await client.sendRequest(ExecuteCommandRequest.type, traParams);
        }
        const added = pendingInserts(edited).length;
        void vscode.window.showInformationMessage(`Dialog saved${added ? ` (${added} new state(s) added)` : ""}.`);
    }

    const open = vscode.commands.registerCommand("extension.bgforge.dialogEditor", () => {
        const editor = vscode.window.activeTextEditor;
        if (!editor || !DIALOG_LANGS.has(editor.document.languageId)) {
            void vscode.window.showInformationMessage("Open a dialog file (.d / .ssl / .td / .tssl) first.");
            return;
        }
        docUri = editor.document.uri.toString();

        if (panel) {
            panel.reveal(vscode.ViewColumn.Beside);
            void refresh();
            return;
        }

        panel = vscode.window.createWebviewPanel("bgforge.dialogEditor", "Dialog Editor", vscode.ViewColumn.Beside, {
            enableScripts: true,
            retainContextWhenHidden: true,
            localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, "client", "out")],
        });
        panel.webview.html = buildHtml(panel.webview, context.extensionUri);

        // The webview posts {type:"ready"} once mounted; send the model then.
        panel.webview.onDidReceiveMessage((msg: { type?: string; model?: DialogModel }) => {
            if (msg?.type === "ready") void refresh();
            else if (msg?.type === "save" && msg.model) void save(msg.model);
        });
        panel.onDidDispose(() => {
            panel = undefined;
            if (refreshTimer) clearTimeout(refreshTimer);
        });
    });

    const onSave = vscode.workspace.onDidSaveTextDocument((doc) => {
        if (doc.uri.toString() === docUri) scheduleRefresh();
    });
    const onChange = vscode.workspace.onDidChangeTextDocument((e) => {
        if (e.document.uri.toString() === docUri) scheduleRefresh();
    });

    return vscode.Disposable.from(open, onSave, onChange, { dispose: () => panel?.dispose() });
}
