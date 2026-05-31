import * as path from "node:path";
import * as vscode from "vscode";
import { generateNonce, getCachedHtmlAsset, getCachedJsAsset } from "../webview-assets";
import { BinaryEditorDocument } from "./document";
import { planSave } from "./save";
import type { HostToWebview, WebviewToHost } from "./webview/messages";

const WORKER_SCRIPT = path.join("client", "out", "binary-editor", "worker.js");
const WEBVIEW_HTML = path.join("client", "src", "binary-editor", "webview", "index.html");
const WEBVIEW_JS = path.join("client", "out", "binary-editor", "webview", "main.js");

/**
 * Custom editor backed by a per-document worker session. The host stays thin: it owns
 * the webview shell and message routing, and forwards all parse/edit/serialize work to
 * the worker via the document's bridge.
 */
export class BinaryEditorProvider implements vscode.CustomEditorProvider<BinaryEditorDocument> {
    static readonly viewType = "bgforge.binaryEditor";

    private readonly _onDidChangeCustomDocument = new vscode.EventEmitter<
        vscode.CustomDocumentEditEvent<BinaryEditorDocument>
    >();
    readonly onDidChangeCustomDocument = this._onDidChangeCustomDocument.event;

    /** Open panel-to-document map. */
    private readonly active = new Map<vscode.WebviewPanel, BinaryEditorDocument>();
    /** Most-recently-focused document, the target for editor commands (addEntry). */
    private activeDocument: BinaryEditorDocument | undefined;

    getActiveDocument(): BinaryEditorDocument | undefined {
        return this.activeDocument;
    }

    private readonly extensionUri: vscode.Uri;

    constructor(context: vscode.ExtensionContext) {
        this.extensionUri = context.extensionUri;
    }

    async openCustomDocument(
        uri: vscode.Uri,
        _openContext: vscode.CustomDocumentOpenContext,
        _token: vscode.CancellationToken,
    ): Promise<BinaryEditorDocument> {
        const workerScript = path.join(this.extensionUri.fsPath, WORKER_SCRIPT);
        const document = await BinaryEditorDocument.open(uri, workerScript);
        document.onDidChange((event) => this._onDidChangeCustomDocument.fire(event));
        return document;
    }

    async resolveCustomEditor(
        document: BinaryEditorDocument,
        panel: vscode.WebviewPanel,
        _token: vscode.CancellationToken,
    ): Promise<void> {
        panel.webview.options = { enableScripts: true, localResourceRoots: [] };
        panel.webview.html = this.getHtml();

        this.active.set(panel, document);
        if (panel.active) this.activeDocument = document;
        panel.onDidChangeViewState((event) => {
            if (event.webviewPanel.active) this.activeDocument = document;
        });
        panel.onDidDispose(() => {
            this.active.delete(panel);
            if (this.activeDocument === document) this.activeDocument = undefined;
        });

        panel.webview.onDidReceiveMessage(async (message: WebviewToHost) => {
            if (message.type === "ready") {
                this.post(panel, { type: "init", open: document.openResult });
            } else if (message.type === "editField") {
                const edited = await document.bridge.send({
                    type: "editField",
                    sessionId: document.sessionId,
                    nodeId: message.nodeId,
                    value: message.value,
                });
                if (edited.type === "error") {
                    this.post(panel, { type: "error", message: edited.message });
                    return;
                }
                document.pushEdit("Edit field");
                const window = await document.bridge.send({
                    type: "getWindow",
                    sessionId: document.sessionId,
                    start: 0,
                    end: 500,
                });
                if (window.type === "window") {
                    this.post(panel, { type: "window", rows: window.rows, dirty: window.dirty });
                }
            } else if (message.type === "requestSave") {
                await vscode.commands.executeCommand("workbench.action.files.save");
            }
        });
    }

    async saveCustomDocument(document: BinaryEditorDocument, _token: vscode.CancellationToken): Promise<void> {
        await this.writeSave(document, document.uri.fsPath, document.uri);
    }

    async saveCustomDocumentAs(
        document: BinaryEditorDocument,
        destination: vscode.Uri,
        _token: vscode.CancellationToken,
    ): Promise<void> {
        await this.writeSave(document, destination.fsPath, destination);
    }

    async revertCustomDocument(_document: BinaryEditorDocument, _token: vscode.CancellationToken): Promise<void> {
        // Plan 3: re-open the session from disk and refresh the webview. A no-op revert is
        // acceptable for the placeholder editor, which has no in-webview dirty state yet.
    }

    async backupCustomDocument(
        document: BinaryEditorDocument,
        context: vscode.CustomDocumentBackupContext,
        _token: vscode.CancellationToken,
    ): Promise<vscode.CustomDocumentBackup> {
        const bytes = await document.getBytes();
        await vscode.workspace.fs.writeFile(context.destination, bytes);
        return {
            id: context.destination.toString(),
            delete: () =>
                vscode.workspace.fs.delete(context.destination).then(
                    () => {},
                    () => {},
                ),
        };
    }

    private async writeSave(
        document: BinaryEditorDocument,
        targetPath: string,
        primaryDestination: vscode.Uri,
    ): Promise<void> {
        const bytes = await document.getBytes();
        const snapshotJson = await document.getSnapshotJson();
        const autoDumpJson = vscode.workspace
            .getConfiguration("bgforge.binaryEditor")
            .get<boolean>("autoDumpJson", false);
        for (const write of planSave({ targetPath, bytes, snapshotJson, autoDumpJson })) {
            // The primary artifact reuses the caller's URI (preserving its scheme); sidecars
            // are always plain filesystem paths.
            const target = write.path === targetPath ? primaryDestination : vscode.Uri.file(write.path);
            // Sequential by design: the main artifact must land before the JSON sidecar so a
            // crash never leaves a snapshot newer than the file it describes. The list is at
            // most two entries, so serial writes cost nothing.
            // eslint-disable-next-line no-await-in-loop
            await vscode.workspace.fs.writeFile(target, write.bytes);
        }
    }

    private post(panel: vscode.WebviewPanel, message: HostToWebview): void {
        void panel.webview.postMessage(message);
    }

    private getHtml(): string {
        const extensionPath = this.extensionUri.fsPath;
        const html = getCachedHtmlAsset("binary-editor-v2", extensionPath, WEBVIEW_HTML);
        const script = getCachedJsAsset("binary-editor-v2", extensionPath, WEBVIEW_JS);
        const nonce = generateNonce();
        return html.replace("/* __SCRIPT__ */", script).replaceAll("{{nonce}}", nonce);
    }
}
