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
 */

import * as vscode from "vscode";
import { type LanguageClient, type ExecuteCommandParams, ExecuteCommandRequest } from "vscode-languageclient/node";
import { LSP_COMMAND_PARSE_DIALOG, LSP_COMMAND_SAVE_TRA } from "../../../shared/protocol";
import { modelFromD, modelFromSSL, type DialogModel } from "../../../shared/dialog-model";
import type { DDialogData, SSLDialogData } from "../../../shared/dialog-types";
import { generateNonce, getCachedJsAsset } from "../webview-assets";
import { buildDialogWebviewHtml } from "./dialog-webview-html";
import { computeDialogSourceEdit } from "./dialog-source-edit";
import { EchoGuard } from "./edit-origin";
import { SerialQueue } from "./serial-queue";

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

/** Per-open-panel session state: the echo guard, latest model (for the .tra flush), the debounce timer, and
 *  the serial edit queue that keeps back-to-back webview edits from racing the same document. */
interface Session {
    guard: EchoGuard;
    latest: DialogModel | undefined;
    traTimer: ReturnType<typeof setTimeout> | undefined;
    edits: SerialQueue;
}

class DialogEditorProvider implements vscode.CustomTextEditorProvider {
    private readonly sessions = new WeakMap<vscode.WebviewPanel, Session>();
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
        panel.webview.html = buildHtml(panel.webview, this.context.extensionUri);
        const session: Session = {
            guard: new EchoGuard(),
            latest: undefined,
            traTimer: undefined,
            edits: new SerialQueue(),
        };
        this.sessions.set(panel, session);

        panel.webview.onDidReceiveMessage(
            (msg: { type?: string; model?: DialogModel; offset?: number; text?: string; level?: string }) => {
                if (msg?.type === "ready") void this.postModel(document, panel);
                // "Go to source" (F4 in the tree): open the text editor at the state's/option's byte offset.
                else if (msg?.type === "revealSource" && typeof msg.offset === "number") {
                    void this.revealSource(document, msg.offset);
                }
                // A user-facing notice from the webview (e.g. Del pressed on a non-deletable node): surface it
                // as a VS Code notification so a blocked action explains itself instead of silently doing nothing.
                else if (msg?.type === "notify" && typeof msg.text === "string") {
                    if (msg.level === "warn") void vscode.window.showWarningMessage(msg.text);
                    else void vscode.window.showInformationMessage(msg.text);
                }
                // The webview emits one "edit" (the whole model) per user action; each applies to the live
                // document as a single WorkspaceEdit (one native undo step). Serialize them through the session
                // queue: two edits fired back-to-back would otherwise run applyEdit concurrently and their
                // WorkspaceEdits race the document (VS Code rejects the second, "applySplices: overlapping ops").
                else if (msg?.type === "edit" && msg.model) {
                    const model = msg.model;
                    session.edits.enqueue(
                        () => this.applyEdit(document, panel, model),
                        (error) => {
                            const message = error instanceof Error ? error.message : String(error);
                            void vscode.window.showErrorMessage(`Dialog edit failed: ${message}`);
                        },
                    );
                }
            },
        );

        const changeSub = vscode.workspace.onDidChangeTextDocument((e) => {
            if (e.document.uri.toString() !== document.uri.toString()) return;
            // A metadata-only notification (dirty-flag flip, etc.) carries no content changes and is never a
            // text edit to re-project for. Skip it BEFORE the guard: a single applyEdit fires TWO change events
            // - the real one (>=1 content change) plus an empty follow-up - and consulting the guard on the
            // empty one consumes a phantom "external edit" it never marked, firing a spurious re-project that
            // closes the inspector mid-add and surfaces the raw `@N` before its .msg text has landed.
            if (e.contentChanges.length === 0) return;
            // Self-originated (our own WorkspaceEdit) -> the guard consumes it and we do not re-project, so the
            // webview keeps its in-progress selection. An external text edit re-projects the graph.
            if (this.sessions.get(panel)?.guard.shouldReproject()) void this.postModel(document, panel);
        });
        const saveSub = vscode.workspace.onDidSaveTextDocument((doc) => {
            if (doc.uri.toString() === document.uri.toString()) void this.flushTra(document, panel);
        });
        panel.onDidDispose(() => {
            const s = this.sessions.get(panel);
            if (s?.traTimer) clearTimeout(s.traTimer);
            changeSub.dispose();
            saveSub.dispose();
            this.sessions.delete(panel);
        });
    }

    /** Parse the bound document and post the model (or an error) to the webview. */
    private async postModel(document: vscode.TextDocument, panel: vscode.WebviewPanel): Promise<void> {
        const params: ExecuteCommandParams = {
            command: LSP_COMMAND_PARSE_DIALOG,
            arguments: [{ uri: document.uri.toString() }],
        };
        let data: unknown;
        try {
            data = await this.client.sendRequest(ExecuteCommandRequest.type, params);
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            void panel.webview.postMessage({ type: "error", message: `Dialog parse request failed: ${message}` });
            return;
        }
        const model = toModel(data);
        const session = this.sessions.get(panel);
        if (session) session.latest = model ?? undefined;
        if (model) {
            // The adapter does not know the file name; supply it here (from the document URI) so the webview
            // can label states by speaker - the base name is the NPC for SSL and a fallback speaker for D.
            model.sourceName =
                document.uri.path
                    .split("/")
                    .pop()
                    ?.replace(/\.[^.]+$/, "") || undefined;
            void panel.webview.postMessage({ type: "model", model });
        } else {
            void panel.webview.postMessage({
                type: "error",
                message:
                    data == null
                        ? "The language server returned no dialog data for this file. Make sure it is a recognized, open dialog file."
                        : "The parsed dialog data could not be interpreted.",
            });
        }
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
     * Apply one webview action to the LIVE document as a single full-range WorkspaceEdit (one edit == one native
     * undo step). Message text is a side-write: it is not stored in the source for D/SSL, so a text-only action
     * produces no source edit - it is persisted to .tra on a short debounce (write-through) and again on native
     * save. Accepted non-atomicity (per the design spec): a structural edit dirties the source (not yet on disk)
     * while its companion text write-through has already landed in .tra; a discard-on-close can leave an orphan
     * .tra entry. This is the lower-risk text class the spec accepts giving up native undo on.
     */
    private async applyEdit(
        document: vscode.TextDocument,
        panel: vscode.WebviewPanel,
        edited: DialogModel,
    ): Promise<void> {
        const session = this.sessions.get(panel);
        if (!session) return;
        if (edited.format === "weidu-d" || edited.format === "fallout-ssl") {
            const text = document.getText();
            let data: unknown;
            try {
                const params: ExecuteCommandParams = {
                    command: LSP_COMMAND_PARSE_DIALOG,
                    arguments: [{ uri: document.uri.toString() }],
                };
                data = await this.client.sendRequest(ExecuteCommandRequest.type, params);
            } catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                void vscode.window.showErrorMessage(`Dialog edit failed: ${message}`);
                return;
            }
            const original = toModel(data);
            const { newText, messages, allocations } = computeDialogSourceEdit(text, edited, original);
            edited.messages = messages;
            if (newText !== null) {
                const ws = new vscode.WorkspaceEdit();
                ws.replace(
                    document.uri,
                    new vscode.Range(document.positionAt(0), document.positionAt(text.length)),
                    newText,
                );
                session.guard.markSelfEdit();
                const applied = await vscode.workspace.applyEdit(ws);
                if (!applied) {
                    session.guard.unmarkSelfEdit();
                    void vscode.window.showErrorMessage("Dialog edit could not be applied to the document.");
                    // The webview model is now ahead of the (unchanged) document; the next successful edit
                    // re-splices the full model against the live text, so the divergence self-heals. The
                    // toast above makes the failed edit visible in the meantime.
                    return;
                }
                // Reconcile the webview's still-pending new items with what we just committed. The echo guard
                // (correctly) suppresses the re-project that would give a freshly-added option its real source
                // span, so without this the webview keeps treating it as pending and the NEXT save re-splices
                // it (duplicating the option). This targeted message stamps each item's allocated `@N` and its
                // .msg text in place - no re-project, so selection and any in-progress text survive.
                if (Object.keys(allocations).length > 0) {
                    void panel.webview.postMessage({ type: "reconcile", allocations, messages });
                }
                // Faithfulness of the round-trip is covered by unit tests (computeDialogSourceEdit's own
                // suite, plus the verifySSLEditApplied/verifyDialogEditApplied unit tests) and by live
                // verification. A runtime cross-check used to live here, but it rode on the
                // onDidChangeTextDocument re-projection that the echo guard now intentionally suppresses
                // for self-originated edits - so it could never observe this edit's result - and a
                // still-pending check would instead misfire against the next external edit's re-parse (a
                // different model).
            }
        }
        session.latest = edited;
        this.scheduleTraFlush(document, panel);
    }

    /** Debounced .tra write-through so rapid message edits collapse to one flush. */
    private scheduleTraFlush(document: vscode.TextDocument, panel: vscode.WebviewPanel): void {
        const session = this.sessions.get(panel);
        if (!session) return;
        if (session.traTimer) clearTimeout(session.traTimer);
        session.traTimer = setTimeout(() => void this.flushTra(document, panel), 400);
    }

    /** Persist message text to the resolved .tra/.msg via the server. A failure surfaces (fail loud). */
    private async flushTra(document: vscode.TextDocument, panel: vscode.WebviewPanel): Promise<void> {
        const session = this.sessions.get(panel);
        if (!session) return;
        if (session.traTimer) {
            clearTimeout(session.traTimer);
            session.traTimer = undefined;
        }
        const messages = session.latest?.messages;
        if (!messages || Object.keys(messages).length === 0) return;
        try {
            const params: ExecuteCommandParams = {
                command: LSP_COMMAND_SAVE_TRA,
                arguments: [{ uri: document.uri.toString(), messages }],
            };
            await this.client.sendRequest(ExecuteCommandRequest.type, params);
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            void vscode.window.showErrorMessage(`Saving dialog message text failed: ${message}`);
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
        if (!active || !DIALOG_LANGS.has(active.document.languageId)) {
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
