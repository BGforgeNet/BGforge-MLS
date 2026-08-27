/**
 * Dialog editor: a CustomTextEditorProvider bound to the .d / .ssl source document.
 *
 * Opens beside (or instead of) the text editor over the same document, so VS Code owns
 * dirty tracking, undo/redo, and save. On open (and on "ready" from the webview) it runs
 * the existing LSP parse command, maps the result into the format-neutral DialogModel via
 * the shared adapters, and posts it to the Svelte Flow webview. On an edit message it
 * splices the change back into the LIVE document via a WorkspaceEdit and persists @N text
 * edits to the .tra (D) or .msg (SSL) via a debounced write-through. WeiDU D is fully
 * editable; for Fallout SSL the faithful nodes are structurally editable (the rest stay
 * view-only).
 *
 * The session logic (parse -> model enrichment -> edit splice -> reparse post -> debounced
 * message flush) lives in host-core.ts, host-agnostic; this file binds it to the real VS
 * Code runtime (WorkspaceEdit, toasts, LSP requests) and keeps the vscode-only concerns:
 * webview HTML, the reveal-source command, and notification routing.
 */

import * as path from "node:path";
import * as vscode from "vscode";
import { type LanguageClient, type ExecuteCommandParams, ExecuteCommandRequest } from "vscode-languageclient/node";
import { LANG_FALLOUT_SSL, LANG_TYPESCRIPT, LANG_WEIDU_D } from "../../../shared/languages";
import { LSP_COMMAND_PARSE_DIALOG, LSP_COMMAND_SAVE_TRA } from "../../../shared/protocol";
import type { DialogMessages } from "../../../shared/dialog-model";
import { surfaceWebviewRuntimeError } from "../webview-error";
import { buildDialogHostHtml } from "./webview-host-html";
import { DialogHostCore, errorMessage, type DialogHostIO } from "./host-core";
import { isWebviewToHost } from "./webview/messages";

// The languageIds that ARE dialog files. `.td`/`.tssl` are contributed as languageId "typescript" (so the TS
// language service + the tssl/td plugins run), so they are recognized by EXTENSION, not languageId - see
// isDialogDocument. (The old set listed "tssl"/"td" as languageIds; those never matched - the live-open bug.)
const DIALOG_LANGS: ReadonlySet<string> = new Set([LANG_FALLOUT_SSL, LANG_WEIDU_D]);

/** Whether a document is an editable dialog file: a real dialog language, or a `.td`/`.tssl` (languageId typescript). */
function isDialogDocument(doc: vscode.TextDocument): boolean {
    return (
        DIALOG_LANGS.has(doc.languageId) || (doc.languageId === LANG_TYPESCRIPT && /\.(tssl|td)$/i.test(doc.uri.path))
    );
}

// Exported for the integration test (client/test/dialog-panel.test.ts), which drives resolveCustomTextEditor
// through a mocked vscode to exercise the session-lifecycle wiring - the SerialQueue serialization of
// back-to-back edits and the disposed-mid-flight guard - that the SerialQueue/EchoGuard unit tests can't cover
// in isolation. `registerDialogEditor` remains the production entry point.
export class DialogEditorProvider implements vscode.CustomTextEditorProvider {
    private readonly context: vscode.ExtensionContext;
    private readonly client: LanguageClient;

    constructor(context: vscode.ExtensionContext, client: LanguageClient) {
        this.context = context;
        this.client = client;
    }

    async resolveCustomTextEditor(
        document: vscode.TextDocument,
        panel: vscode.WebviewPanel,
        _token: vscode.CancellationToken,
    ): Promise<void> {
        panel.webview.options = {
            enableScripts: true,
            localResourceRoots: [vscode.Uri.joinPath(this.context.extensionUri, "client", "out")],
        };
        panel.webview.html = buildDialogHostHtml(panel.webview, this.context.extensionUri);

        const io: DialogHostIO = {
            getText: () => document.getText(),
            requestParse: () => this.requestParse(document),
            replaceText: async (newText) => {
                // One whole-document replace == one native undo step. The range spans the document's CURRENT
                // text (not the snapshot the splice was computed against) so the replacement is total even if
                // the document moved under the in-flight parse.
                const ws = new vscode.WorkspaceEdit();
                ws.replace(
                    document.uri,
                    new vscode.Range(document.positionAt(0), document.positionAt(document.getText().length)),
                    newText,
                );
                return vscode.workspace.applyEdit(ws);
            },
            postToWebview: (msg) => void panel.webview.postMessage(msg),
            showError: (message) => void vscode.window.showErrorMessage(message),
            saveMessages: async (messages: DialogMessages) => {
                const params: ExecuteCommandParams = {
                    command: LSP_COMMAND_SAVE_TRA,
                    arguments: [{ uri: document.uri.toString(), messages }],
                };
                await this.client.sendRequest(ExecuteCommandRequest.type, params);
            },
        };
        const core = new DialogHostCore(io, document.uri.path);

        panel.webview.onDidReceiveMessage((raw: unknown) => {
            // Same reject-and-ignore posture as the binary editor's isWebviewToHost: an unrecognized
            // or malformed message changes nothing rather than acting on partial data.
            if (!isWebviewToHost(raw)) return;
            switch (raw.type) {
                case "ready":
                    core.handleReady();
                    break;
                // "Go to source" (F4 in the tree): open the text editor at the state's/option's byte offset.
                case "revealSource":
                    void this.revealSource(document, raw.offset);
                    break;
                // A user-facing notice from the webview (e.g. Del pressed on a non-deletable node): surface it
                // as a VS Code notification so a blocked action explains itself instead of silently doing nothing.
                case "notify":
                    if (raw.level === "warn") void vscode.window.showWarningMessage(raw.text);
                    else void vscode.window.showInformationMessage(raw.text);
                    break;
                // The webview emits one "edit" (the whole model) per user action; the core serializes and
                // applies them (see host-core.ts).
                case "edit":
                    core.handleEdit(raw.model, raw.seq ?? 0);
                    break;
                // A fatal error caught by the webview's installFatalErrorHandler (see main.ts). Parity with
                // the binary editor's "runtimeError" case (provider.ts): surface through the same
                // operator-visible channels (output channel + toast) instead of leaving a silently blank panel.
                case "runtimeError": {
                    const file = path.basename(document.uri.fsPath);
                    surfaceWebviewRuntimeError({
                        editor: "Dialog editor",
                        file,
                        message: raw.message,
                        stack: raw.stack,
                    });
                    break;
                }
            }
        });

        const changeSub = vscode.workspace.onDidChangeTextDocument((e) => {
            if (e.document.uri.toString() !== document.uri.toString()) return;
            core.handleDocumentChanged(e.contentChanges.length);
        });
        const saveSub = vscode.workspace.onDidSaveTextDocument((doc) => {
            if (doc.uri.toString() === document.uri.toString()) core.handleDocumentSaved();
        });
        panel.onDidDispose(() => {
            core.dispose();
            changeSub.dispose();
            saveSub.dispose();
        });
    }

    /**
     * "Go to source" (F4 from the tree): reveal the .ssl/.d text editor with the caret on the state's/option's
     * source line. If the document is already open in a text editor, reveal THAT one in place (never spawn a
     * fresh tab each time); otherwise open it in the active column full-width, not split beside the dialog
     * editor. Tree-sitter ranges are UTF-8 BYTE offsets while `positionAt` wants a UTF-16 CHAR offset, so
     * convert through the document's own text (offsets land on token boundaries, so the byte prefix never
     * splits a character).
     */
    private async revealSource(document: vscode.TextDocument, byteOffset: number): Promise<void> {
        const text = document.getText();
        const charOffset = Buffer.from(text, "utf8").subarray(0, byteOffset).toString("utf8").length;
        const pos = document.positionAt(charOffset);
        const range = new vscode.Range(pos, pos);
        const uri = document.uri.toString();
        // Prefer an existing text editor for this document (in whatever column it already lives); else the
        // active column (full width). ViewColumn.Beside is intentionally avoided - it split a new pane and
        // opened a duplicate tab on every F4.
        const existing = vscode.window.visibleTextEditors.find((e) => e.document.uri.toString() === uri);
        const editor = await vscode.window.showTextDocument(document, {
            viewColumn: existing?.viewColumn ?? vscode.ViewColumn.Active,
            preview: false,
            selection: range,
        });
        editor.revealRange(range, vscode.TextEditorRevealType.InCenter);
    }

    /**
     * Send the LSP parse-dialog request for `document`. Returns the raw command result, or an error message
     * when the request itself failed - each caller surfaces that its own way (a webview `error` post from
     * postModel, a VS Code toast from applyEdit), so the shared step is only the request, not the reporting.
     */
    private async requestParse(document: vscode.TextDocument): Promise<{ data: unknown } | { error: string }> {
        const params: ExecuteCommandParams = {
            command: LSP_COMMAND_PARSE_DIALOG,
            arguments: [{ uri: document.uri.toString() }],
        };
        try {
            return { data: await this.client.sendRequest(ExecuteCommandRequest.type, params) };
        } catch (error) {
            return { error: errorMessage(error) };
        }
    }
}

export function registerDialogEditor(context: vscode.ExtensionContext, client: LanguageClient): vscode.Disposable {
    const provider = new DialogEditorProvider(context, client);
    const editor = vscode.window.registerCustomEditorProvider("bgforge.dialogEditor", provider, {
        webviewOptions: { retainContextWhenHidden: true },
        supportsMultipleEditorsPerDocument: false,
    });
    // Keep the command + Ctrl+Shift+V: open the active dialog file in the custom editor beside the source.
    const open = vscode.commands.registerCommand("extension.bgforge.dialogEditor", async () => {
        const active = vscode.window.activeTextEditor;
        if (!active || !isDialogDocument(active.document)) {
            void vscode.window.showInformationMessage("Open a dialog file (.d / .ssl / .td / .tssl) first.");
            return;
        }
        await vscode.commands.executeCommand(
            "vscode.openWith",
            active.document.uri,
            "bgforge.dialogEditor",
            vscode.ViewColumn.Active,
        );
    });
    return vscode.Disposable.from(editor, open);
}
