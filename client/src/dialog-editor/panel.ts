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
import { modelFromD, modelFromSSL, type DialogMessages, type DialogModel } from "../../../shared/dialog-model";
import type { DDialogData, SSLDialogData } from "../../../shared/dialog-types";
import { generateNonce, getCachedJsAsset } from "../webview-assets";
import { buildDialogWebviewHtml } from "./dialog-webview-html";
import { computeDialogSourceEdit } from "./dialog-source-edit";
import { EchoGuard } from "./edit-origin";
import { SerialQueue } from "./serial-queue";

// The languageIds that ARE dialog files. `.td`/`.tssl` are contributed as languageId "typescript" (so the TS
// language service + the tssl/td plugins run), so they are recognized by EXTENSION, not languageId - see
// isDialogDocument. (The old set listed "tssl"/"td" as languageIds; those never matched - the live-open bug.)
const DIALOG_LANGS = new Set(["fallout-ssl", "weidu-d"]);

/** Whether a document is an editable dialog file: a real dialog language, or a `.td`/`.tssl` (languageId typescript). */
function isDialogDocument(doc: vscode.TextDocument): boolean {
    return DIALOG_LANGS.has(doc.languageId) || (doc.languageId === "typescript" && /\.(tssl|td)$/i.test(doc.uri.path));
}

/** Discriminate the parse payload by shape (D has `blocks`, SSL has `nodes`). */
function toModel(data: unknown): DialogModel | null {
    if (data && typeof data === "object") {
        if ("blocks" in data) return modelFromD(data as DDialogData);
        if ("nodes" in data) return modelFromSSL(data as SSLDialogData);
    }
    return null;
}

/** The message of a caught unknown - `Error.message`, else its string form. */
function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
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
    /** Set once the panel is disposed. A queued/in-flight edit captured this session before the WeakMap entry
     *  was removed, so it re-checks this flag after each await rather than acting on a dead panel. */
    disposed: boolean;
}

// Exported for the integration test (client/test/dialog-panel.test.ts), which drives resolveCustomTextEditor
// through a mocked vscode to exercise the session-lifecycle wiring - the SerialQueue serialization of
// back-to-back edits and the disposed-mid-flight guard - that the SerialQueue/EchoGuard unit tests can't cover
// in isolation. `registerDialogEditor` remains the production entry point.
export class DialogEditorProvider implements vscode.CustomTextEditorProvider {
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
            disposed: false,
        };
        this.sessions.set(panel, session);

        panel.webview.onDidReceiveMessage(
            (msg: {
                type?: string;
                model?: DialogModel;
                offset?: number;
                text?: string;
                level?: string;
                seq?: number;
            }) => {
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
                    const seq = msg.seq ?? 0;
                    session.edits.enqueue(
                        () => this.applyEdit(document, panel, model, seq),
                        (error) => {
                            void vscode.window.showErrorMessage(`Dialog edit failed: ${errorMessage(error)}`);
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
            // Self-originated (our own WorkspaceEdit) -> the guard consumes it here; applyEdit already posts the
            // authoritative re-parse (with the seq/allocations the webview needs to remap selection), so a second
            // re-project from this handler would be a redundant duplicate. An external text edit (someone typing
            // in a "Reopen with Text" split) re-projects the graph so the tree stays a faithful view of source.
            if (this.sessions.get(panel)?.guard.shouldReproject()) void this.postModel(document, panel);
        });
        const saveSub = vscode.workspace.onDidSaveTextDocument((doc) => {
            if (doc.uri.toString() === document.uri.toString()) void this.flushTra(document, panel);
        });
        panel.onDidDispose(() => {
            const s = this.sessions.get(panel);
            if (s) {
                // Mark BEFORE deleting the map entry: an in-flight applyEdit captured `s` and only sees the
                // dispose via this flag (the map lookup would already be gone).
                s.disposed = true;
                if (s.traTimer) clearTimeout(s.traTimer);
            }
            changeSub.dispose();
            saveSub.dispose();
            this.sessions.delete(panel);
        });
    }

    /**
     * Parse the bound document and post the model (or an error) to the webview. Two callers:
     *  - the initial load and an external text-side edit (no `reparse` opts) -> a plain `{type:"model"}` the
     *    webview adopts as the authoritative view (App.svelte's reduceDialogView -> the model prop);
     *  - `applyEdit`, right after it splices a self-edit (`reparse` opts set) -> the SAME faithful parse, but
     *    tagged `reparse:true` and carrying the `seq` of the edit that produced it plus the pending items'
     *    allocated `@N` ids and their not-yet-flushed .msg text. The webview keys off those to remap a
     *    just-added option's selection (its id changes across the parse) and to render freshly-typed text
     *    before the debounced .tra flush lands. App.svelte ignores a `reparse:true` post; DialogGraph's own
     *    listener handles it so it can preserve selection / an in-progress inline edit instead of resetting.
     */
    private async postModel(
        document: vscode.TextDocument,
        panel: vscode.WebviewPanel,
        reparse?: { seq: number; allocations: Record<string, string>; messages: DialogMessages },
    ): Promise<void> {
        const parsed = await this.requestParse(document);
        if ("error" in parsed) {
            void panel.webview.postMessage({ type: "error", message: `Dialog parse request failed: ${parsed.error}` });
            return;
        }
        const model = toModel(parsed.data);
        const session = this.sessions.get(panel);
        // Disposed while the parse was in flight (the session is removed on dispose): don't post to a dead webview.
        if (!session || session.disposed) return;
        session.latest = model ?? undefined;
        if (model) {
            // Refine the render-family sourceLang the adapter set (d/ssl) to the actual transpiler source
            // language for a .td/.tssl document. `editable` is the D-family BLANKET-editable flag; TD/TSSL are
            // deliberately NOT blanket-editable - their field/structural edits are gated per node by the
            // faithfulness tier and sourceLang (see model-to-flow `fieldEditable` / DialogGraph `structEditable`)
            // and written back to the TS source by the td/tssl writers. So keep `editable=false` and let the
            // tier gating drive editing; renderFamily keeps rendering it as D/SSL.
            const lowerPath = document.uri.path.toLowerCase();
            if (lowerPath.endsWith(".td")) {
                model.sourceLang = "td";
                model.editable = false;
            } else if (lowerPath.endsWith(".tssl")) {
                model.sourceLang = "tssl";
                model.editable = false;
            }
            // The adapter does not know the file name; supply it here (from the document URI) so the webview
            // can label states by speaker - the base name is the NPC for SSL and a fallback speaker for D.
            model.sourceName =
                document.uri.path
                    .split("/")
                    .pop()
                    ?.replace(/\.[^.]+$/, "") || undefined;
            void panel.webview.postMessage(
                reparse
                    ? {
                          type: "model",
                          reparse: true,
                          model,
                          seq: reparse.seq,
                          allocations: reparse.allocations,
                          messages: reparse.messages,
                      }
                    : { type: "model", model },
            );
        } else {
            void panel.webview.postMessage({
                type: "error",
                message:
                    parsed.data == null
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
        seq: number,
    ): Promise<void> {
        const session = this.sessions.get(panel);
        if (!session) return;
        if (
            edited.sourceLang === "d" ||
            edited.sourceLang === "ssl" ||
            edited.sourceLang === "tssl" ||
            edited.sourceLang === "td"
        ) {
            const text = document.getText();
            const parsed = await this.requestParse(document);
            if ("error" in parsed) {
                void vscode.window.showErrorMessage(`Dialog edit failed: ${parsed.error}`);
                return;
            }
            // The panel may have been disposed while the parse request was in flight. A captured session
            // survives the WeakMap delete, so re-check its flag before touching the document or the webview -
            // otherwise a mid-flight edit lands a WorkspaceEdit and posts to a closed panel.
            if (session.disposed) return;
            const original = toModel(parsed.data);
            // A parse that yields NO model for an already-open document is a real failure (the server threw on
            // parse or translation resolution and returned null), NOT a from-scratch state - a valid open doc
            // always parses to at least an empty model. Proceeding would no-op the ssl/tssl/td writer against a
            // null original and silently discard the edit, so surface it and stop. The webview keeps its
            // optimistic model; the next successful edit re-syncs against live text.
            if (original === null) {
                void vscode.window.showErrorMessage(
                    "Dialog edit not saved: the document could not be parsed. Fix the source and try again.",
                );
                return;
            }
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
                // A REJECTED applyEdit (extension-host error, not a `false` return) must still unmark the self-edit
                // token, or the echo guard swallows the NEXT genuine external edit as if it were our own. Unmark on
                // throw, then let the SerialQueue's onError surface the failure toast.
                let applied: boolean;
                try {
                    applied = await vscode.workspace.applyEdit(ws);
                } catch (error) {
                    session.guard.unmarkSelfEdit();
                    throw error;
                }
                if (!applied) {
                    session.guard.unmarkSelfEdit();
                    void vscode.window.showErrorMessage("Dialog edit could not be applied to the document.");
                    // The webview model is now ahead of the (unchanged) document; the next successful edit
                    // re-splices the full model against the live text, so the divergence self-heals. The
                    // toast above makes the failed edit visible in the meantime.
                    return;
                }
                // Post the faithful re-parse of the just-spliced document so the webview adopts it (real source
                // spans -> F4 resolves; the tree stays a pure view of source). The `seq` lets the webview drop a
                // stale re-parse that a newer optimistic edit has already superseded; `allocations`/`messages`
                // let it remap a just-added option's selection (its id changes across the parse) and render the
                // freshly-typed text before the debounced .tra flush. While the user is mid inline-edit the
                // webview keeps its draft and only stamps the `@N` in place from these same fields (see
                // DialogGraph's re-parse listener) - the enriched post serves both cases.
                await this.postModel(document, panel, { seq, allocations, messages });
            }
        }
        // Record the EDITED model (with the user's just-typed messages) as the session's latest, deliberately
        // OVERRIDING the source-accurate reparse postModel stored above: the .tra flush below is debounced, so the
        // reparse's messages still hold the OLD on-disk .tra text while `edited.messages` holds what the user
        // typed. flushTra reads session.latest.messages, so this must be the edited model or the flush writes
        // stale text. (Not a redundant write - the reparse and the edited model diverge until the flush lands.)
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
            void vscode.window.showErrorMessage(`Saving dialog message text failed: ${errorMessage(error)}`);
        }
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
