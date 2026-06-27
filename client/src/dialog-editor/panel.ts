/**
 * Dialog editor webview panel host.
 *
 * Opens beside the text editor (the document of record). On open and on edits it
 * runs the existing LSP parse command, maps the result into the format-neutral
 * DialogModel via the shared adapters, and posts it to the Svelte Flow webview.
 * On a save message it splices the edits back into the .d / .ssl surgically and persists
 * @N text edits to the .tra (D) or .msg (SSL). WeiDU D is fully editable; for Fallout SSL the
 * faithful nodes are structurally editable (the rest stay view-only).
 */

import * as vscode from "vscode";
import { type LanguageClient, type ExecuteCommandParams, ExecuteCommandRequest } from "vscode-languageclient/node";
import { LSP_COMMAND_PARSE_DIALOG, LSP_COMMAND_SAVE_TRA } from "../../../shared/protocol";
import { modelFromD, modelFromSSL, type DialogModel } from "../../../shared/dialog-model";
import { applyDialogEdits, pendingInserts, verifyDialogEditApplied } from "../../../shared/dialog-d-edit";
import { applySSLDialogEdits, verifySSLEditApplied } from "../../../shared/dialog-ssl-edit";
import { allocateNodeIds, allocateOptionIds } from "../../../shared/dialog-ssl-ids";
import type { DDialogData, SSLDialogData } from "../../../shared/dialog-types";
import { generateNonce, getCachedJsAsset } from "../webview-assets";
import { buildDialogWebviewHtml } from "./dialog-webview-html";

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
    // Resolve the vscode/webview-bound inputs here; the pure HTML assembly (CSP shape +
    // verbatim inline of the bundle) lives in buildDialogWebviewHtml, which is unit-tested
    // without the vscode runtime (dialog-panel-html.test.ts).
    const base = vscode.Uri.joinPath(extensionUri, "client", "out", "dialog-editor", "webview");
    const cssUri = webview.asWebviewUri(vscode.Uri.joinPath(base, "main.css")).toString();
    const nonce = generateNonce();
    const scriptBody = getCachedJsAsset(
        "dialog-editor",
        extensionUri.fsPath,
        "client/out/dialog-editor/webview/main.js",
    );
    return buildDialogWebviewHtml({ cspSource: webview.cspSource, cssUri, nonce, scriptBody });
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
        let data: unknown;
        try {
            data = await client.sendRequest(ExecuteCommandRequest.type, params);
        } catch (error) {
            // Surface the failure instead of leaving the webview stuck on "Parsing dialog...".
            const message = error instanceof Error ? error.message : String(error);
            void panel?.webview.postMessage({ type: "error", message: `Dialog parse request failed: ${message}` });
            return;
        }
        if (!panel) return; // disposed while the request was in flight
        const model = toModel(data);
        if (model) {
            void panel.webview.postMessage({ type: "model", model });
        } else {
            // The server returned nothing usable (no open document, unrecognized language, or a
            // parse error logged server-side). Tell the webview rather than hang indefinitely.
            void panel.webview.postMessage({
                type: "error",
                message:
                    data == null
                        ? "The language server returned no dialog data for this file. Make sure it is a recognized, open dialog file."
                        : "The parsed dialog data could not be interpreted.",
            });
        }
        // Verify a just-saved edit round-tripped faithfully: the server's re-parse of the
        // saved document (`model`) must match what `save` wrote (`pendingVerify`). A mismatch
        // means the serializer produced text that does not reproduce the edit - warn rather
        // than let a silent corruption stand.
        if (model && pendingVerify) {
            const ssl = pendingVerify.format === "fallout-ssl";
            const verdict = ssl
                ? verifySSLEditApplied(pendingVerify, model)
                : verifyDialogEditApplied(pendingVerify, model);
            pendingVerify = undefined;
            if (!verdict.ok) {
                void vscode.window.showWarningMessage(
                    `Dialog save may not have applied cleanly: ${verdict.reason}. Review the ${ssl ? ".ssl" : ".d"} source.`,
                );
            }
        }
    }

    function scheduleRefresh(): void {
        if (refreshTimer) clearTimeout(refreshTimer);
        refreshTimer = setTimeout(() => void refresh(), 300);
    }

    /**
     * Persist edits from the webview back to disk. WeiDU D structure is edited surgically
     * (applyDialogEdits splices only the changed states, preserving comments, patch blocks,
     * CHAIN syntax, and untouched states); faithful SSL nodes get their structural ops (retarget,
     * reorder, add/remove unconditional options, add/delete nodes, entry-toggle, rename) spliced
     * back via applySSLDialogEdits, non-faithful nodes staying read-only; newly-added options/nodes
     * allocate `.msg` ids here (allocateNodeIds + allocateOptionIds). Message-text edits (NPC lines
     * and player replies) are written to the resolved `.tra` (D) or `.msg` (SSL) via the server,
     * which owns translation-file resolution. Editing SSL conditions (`if` wrappers) is not yet
     * supported - those nodes/edits stay source-only.
     */
    async function save(edited: DialogModel): Promise<void> {
        if (!docUri) return;
        if (edited.format === "weidu-d" || edited.format === "fallout-ssl") {
            const doc = await vscode.workspace.openTextDocument(vscode.Uri.parse(docUri));
            const text = doc.getText();
            // Re-parse the on-disk text to recover the ORIGINAL model (before the webview's
            // edits). The splicers compare against it so unchanged content keeps its exact bytes
            // (D: @N refs, ++ shorthand, comments; SSL: everything but the moved/retargeted option
            // spans). The document itself is unchanged by webview edits.
            const params: ExecuteCommandParams = { command: LSP_COMMAND_PARSE_DIALOG, arguments: [{ uri: docUri }] };
            const data = await client.sendRequest(ExecuteCommandRequest.type, params);
            const original = toModel(data) ?? undefined;
            // Allocate .msg ids for newly-added SSL content from the on-disk message set (the source of the
            // current max), mutating each new reply/option's text to its @id so the spliced SSL and the
            // appended .msg entries agree. NODE ids first (a new node's reply + its options), then OPTION ids
            // for any new options added to existing nodes, against the merged set so ids never collide. New
            // entries merge into edited.messages, which the SAVE_TRA path writes (rewrite + append). Runs
            // before the splice, which reads the assigned @id.
            if (edited.format === "fallout-ssl" && original) {
                const node = allocateNodeIds(edited, original.messages ?? {});
                const opt = allocateOptionIds(edited, { ...original.messages, ...node.newMessages });
                edited.messages = { ...edited.messages, ...node.newMessages, ...opt };
            }
            // SSL needs the original parse to gate on per-node faithfulness; without it, leave the
            // structure untouched (message text still persists below).
            const newText =
                edited.format === "weidu-d"
                    ? applyDialogEdits(text, edited, original)
                    : original
                      ? applySSLDialogEdits(text, edited, original)
                      : text;
            if (newText !== text) {
                const ws = new vscode.WorkspaceEdit();
                ws.replace(doc.uri, new vscode.Range(doc.positionAt(0), doc.positionAt(text.length)), newText);
                await vscode.workspace.applyEdit(ws);
                // The document change triggers a debounced refresh; have it verify this edit
                // round-tripped (the saved text re-parses to exactly what we saved).
                pendingVerify = edited;
            }
        }
        // Message text persists for both formats (D -> .tra, SSL -> .msg).
        if (edited.messages && Object.keys(edited.messages).length > 0) {
            const traParams: ExecuteCommandParams = {
                command: LSP_COMMAND_SAVE_TRA,
                arguments: [{ uri: docUri, messages: edited.messages }],
            };
            await client.sendRequest(ExecuteCommandRequest.type, traParams);
        }
        const added = edited.format === "weidu-d" ? pendingInserts(edited).length : 0;
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
