/**
 * Read-only viewer for compiled Infinity Engine dialogs (`.dlg`).
 *
 * Why this is a second provider rather than another selector on `bgforge.dialogEditor`: that viewType is a
 * `CustomTextEditorProvider` bound to a `TextDocument`, and a `.dlg` is binary. One viewType cannot be both.
 * Everything downstream is shared - the same webview, the same `model` message - so the webview cannot tell
 * which producer fed it.
 *
 * Read-only for now (see `nodeEditable`): a DLG has no source text, so there are no byte ranges for the
 * editing path to splice. The structure is fully readable without a game; only the spoken text needs one.
 */

import * as vscode from "vscode";
import { readDlg } from "@bgforge/binary";
import { modelFromDlg } from "../../../shared/dialog-model-dlg";
import type { DialogMessages } from "../../../shared/dialog-model";
import type { StrrefResolver } from "../ie-resources/game-lookups";
import { buildDialogHostHtml } from "./webview-host-html";

/**
 * The game lookups the viewer needs. `strref` is `registerIeResources`'s own resolver, taken in its existing
 * shape (uri first) rather than re-wrapped: the uri is how it finds which game the document came from.
 */
export interface DlgHostDeps {
    strref?: StrrefResolver;
}

/** The bytes a custom document carries. `openCustomDocument` reads them once; the view never writes. */
export interface DlgDocument extends vscode.CustomDocument {
    readonly bytes: Uint8Array;
}

/**
 * Collect every strref the model references and resolve what the game can name, keyed by the `@N` id space
 * the renderer already uses for `.msg` and `.tra`. An unresolvable id is simply absent, so the view falls
 * back to showing the bare ref rather than inventing text for it.
 */
function resolveMessages(strrefs: Iterable<number>, uri: vscode.Uri, resolve: DlgHostDeps["strref"]): DialogMessages {
    const messages: DialogMessages = {};
    if (!resolve) return messages;
    for (const id of strrefs) {
        const text = resolve(uri, id);
        if (text !== undefined) messages[String(id)] = text;
    }
    return messages;
}

export class DlgDialogEditorProvider implements vscode.CustomReadonlyEditorProvider<DlgDocument> {
    private readonly context: vscode.ExtensionContext;
    private readonly deps: DlgHostDeps;

    constructor(context: vscode.ExtensionContext, deps: DlgHostDeps) {
        this.context = context;
        this.deps = deps;
    }

    async openCustomDocument(uri: vscode.Uri): Promise<DlgDocument> {
        const bytes = await vscode.workspace.fs.readFile(uri);
        return { uri, bytes, dispose: () => {} };
    }

    async resolveCustomEditor(
        document: DlgDocument,
        panel: vscode.WebviewPanel,
        _token: vscode.CancellationToken,
    ): Promise<void> {
        panel.webview.options = {
            enableScripts: true,
            localResourceRoots: [vscode.Uri.joinPath(this.context.extensionUri, "client", "out")],
        };
        panel.webview.html = buildDialogHostHtml(panel.webview, this.context.extensionUri);

        const post = (msg: unknown): void => void panel.webview.postMessage(msg);

        panel.webview.onDidReceiveMessage((raw: unknown) => {
            // Same reject-and-ignore posture as the other editors: an unrecognized message changes nothing.
            if (typeof raw !== "object" || raw === null || !("type" in raw)) return;
            switch ((raw as { type: unknown }).type) {
                case "ready":
                    this.postModel(document, post);
                    break;
                // The webview offers "Open game" when strrefs could not resolve. It cannot run a command
                // itself, so it asks the host; the tree view owns the picker and the session.
                case "openGame":
                    void vscode.commands.executeCommand("bgforge.ieResources.openGame");
                    break;
                default:
                    break;
            }
        });
    }

    private postModel(document: DlgDocument, post: (msg: unknown) => void): void {
        let dlg;
        try {
            dlg = readDlg(document.bytes);
        } catch (error) {
            post({ type: "error", message: `Could not read this DLG: ${String(error)}` });
            return;
        }
        if (dlg.signature !== "DLG " || dlg.version !== "V1.0") {
            post({
                type: "error",
                message: `Not a DLG v1.0 file: signature ${JSON.stringify(dlg.signature + dlg.version)}`,
            });
            return;
        }

        // The resref is the filename: a DLG does not record its own name, and its transitions address a
        // same-file jump by that name, so the target-is-internal test needs it from here.
        const resref = (document.uri.path.split("/").pop() ?? "").replace(/\.[^.]+$/, "");
        const model = modelFromDlg({ ...dlg, resref });

        const strrefs = new Set<number>();
        for (const state of dlg.states) strrefs.add(state.text);
        for (const transition of dlg.transitions) {
            if (transition.hasText) strrefs.add(transition.text);
            if (transition.hasJournalEntry) strrefs.add(transition.journalText);
        }
        const messages = resolveMessages(strrefs, document.uri, this.deps.strref);

        post({ type: "model", model: { ...model, messages, sourceName: resref } });
    }
}

export function registerDlgDialogEditor(context: vscode.ExtensionContext, deps: DlgHostDeps): vscode.Disposable {
    return vscode.window.registerCustomEditorProvider("bgforge.dlgViewer", new DlgDialogEditorProvider(context, deps), {
        webviewOptions: { retainContextWhenHidden: true },
        supportsMultipleEditorsPerDocument: false,
    });
}
