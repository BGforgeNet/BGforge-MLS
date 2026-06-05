import * as path from "node:path";
import * as vscode from "vscode";
import { getSnapshotPath } from "@bgforge/binary";
import type { StructureOpRequest } from "@bgforge/binary-editor";
import {
    generateNonce,
    getCachedCssAsset,
    getCachedHtmlAsset,
    getCachedJsAsset,
    inlineWebviewScript,
    inlineWebviewStyles,
} from "../webview-assets";
import { surfaceWebviewRuntimeError } from "../webview-error";
import { BinaryEditorDocument } from "./document";
import { planSave } from "./save";
import type { HostToWebview, WebviewToHost } from "./webview/messages";

const WORKER_SCRIPT = path.join("client", "out", "binary-editor", "worker.js");
const WEBVIEW_HTML = path.join("client", "src", "binary-editor", "webview", "index.html");
const WEBVIEW_CSS = path.join("client", "src", "binary-editor", "webview", "styles.css");
const WEBVIEW_JS = path.join("client", "out", "binary-editor", "webview", "main.js");

/** Human-readable undo-history label for a structure op. The worker keeps its own detailed label; this is the
 *  coarse-grained entry shown in the host editor's undo stack. */
function structureOpLabel(op: StructureOpRequest["op"]): string {
    switch (op) {
        case "add":
            return "Add entry";
        case "insert":
            return "Insert entry";
        case "remove":
            return "Remove entry";
        case "reorder":
            return "Reorder entry";
        case "duplicate":
            return "Duplicate entry";
    }
}

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
        document.onDidRefresh(() => this.refreshDocumentPanels(document));
        return document;
    }

    async resolveCustomEditor(
        document: BinaryEditorDocument,
        panel: vscode.WebviewPanel,
        _token: vscode.CancellationToken,
    ): Promise<void> {
        const codiconsDir = vscode.Uri.joinPath(this.extensionUri, "client", "out", "codicons");
        panel.webview.options = { enableScripts: true, localResourceRoots: [codiconsDir] };
        panel.webview.html = this.getHtml(panel.webview);

        this.active.set(panel, document);
        panel.onDidDispose(() => {
            this.active.delete(panel);
        });

        panel.webview.onDidReceiveMessage(async (message: WebviewToHost) => {
            switch (message.type) {
                case "ready":
                    this.post(panel, { type: "init", open: document.openResult });
                    await this.pushDiagnosticsToDocument(document);
                    break;
                case "requestChildren": {
                    const r = await document.bridge.send({
                        type: "getChildren",
                        sessionId: document.sessionId,
                        nodeId: message.nodeId,
                        start: message.start,
                        end: message.end,
                    });
                    if (r.type === "children") {
                        this.post(panel, {
                            type: "children",
                            requestId: message.requestId,
                            parentId: r.parentId,
                            rows: r.rows,
                            total: r.total,
                        });
                    } else if (r.type === "error") {
                        this.post(panel, { type: "error", requestId: message.requestId, message: r.message });
                    }
                    break;
                }
                case "editField": {
                    const r = await document.bridge.send({
                        type: "editField",
                        sessionId: document.sessionId,
                        nodeId: message.nodeId,
                        value: message.value,
                    });
                    if (r.type === "error") {
                        this.post(panel, { type: "error", message: r.message });
                        break;
                    }
                    if (r.type === "edited") {
                        document.pushEdit("Edit field");
                        // Keep the edited entry selected so an inline list does not collapse the row on commit.
                        this.postToDocumentPanels(document, {
                            type: "changeSet",
                            changeSet: r.result.changeSet,
                            selection: message.nodeId,
                        });
                        await this.pushDiagnosticsToDocument(document);
                    }
                    break;
                }
                case "structureOp": {
                    const r = await document.bridge.send({
                        type: "structureOp",
                        sessionId: document.sessionId,
                        op: message.op,
                    });
                    if (r.type === "error") {
                        this.post(panel, { type: "error", message: r.message });
                        break;
                    }
                    if (r.type === "structure") {
                        document.pushEdit(structureOpLabel(message.op.op));
                        // Forward the post-op selection so the webview re-activates the new/moved/neighbor entry.
                        this.postToDocumentPanels(document, {
                            type: "changeSet",
                            changeSet: r.result.changeSet,
                            selection: r.result.selection,
                        });
                        await this.pushDiagnosticsToDocument(document);
                    }
                    break;
                }
                case "dumpJson":
                    await this.dumpJson(document);
                    break;
                case "loadJson":
                    await this.loadJson(document, panel);
                    break;
                case "runtimeError": {
                    const file = path.basename(document.uri.fsPath);
                    surfaceWebviewRuntimeError({
                        label: `Binary editor for ${file}`,
                        userFacingFile: file,
                        message: message.message,
                        stack: message.stack,
                    });
                    break;
                }
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

    async revertCustomDocument(document: BinaryEditorDocument, _token: vscode.CancellationToken): Promise<void> {
        await document.reloadFromDisk();
        this.postToDocumentPanels(document, { type: "init", open: document.openResult });
        await this.pushDiagnosticsToDocument(document);
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

    /** Post a message to every webview panel currently showing the given document. */
    private postToDocumentPanels(document: BinaryEditorDocument, message: HostToWebview): void {
        for (const [panel, doc] of this.active) {
            if (doc === document) this.post(panel, message);
        }
    }

    /** Run the worker validate pass and push the advisory diagnostics to all of the document's panels. */
    private async pushDiagnosticsToDocument(document: BinaryEditorDocument): Promise<void> {
        const v = await document.bridge.send({ type: "validate", sessionId: document.sessionId });
        if (v.type === "diagnostics") {
            this.postToDocumentPanels(document, { type: "diagnostics", diagnostics: v.diagnostics });
        }
    }

    /** After an undo/redo: tell every panel to clear its cache and re-fetch (layout is unchanged, so
     *  selection/tab state in the webview is preserved - no re-init). */
    private refreshDocumentPanels(document: BinaryEditorDocument): void {
        this.postToDocumentPanels(document, { type: "invalidated" });
        void this.pushDiagnosticsToDocument(document);
    }

    private async dumpJson(document: BinaryEditorDocument): Promise<void> {
        // Write the canonical snapshot to the automatic sidecar path (<file>.json) - the same path the
        // autoDumpJson save-time sidecar uses - with no dialog.
        const json = await document.getSnapshotJson();
        const target = vscode.Uri.file(getSnapshotPath(document.uri.fsPath));
        await vscode.workspace.fs.writeFile(target, Buffer.from(json, "utf8"));
    }

    private async loadJson(document: BinaryEditorDocument, panel: vscode.WebviewPanel): Promise<void> {
        // Read from the automatic sidecar path (<file>.json), no dialog. Missing file -> advisory error.
        const source = vscode.Uri.file(getSnapshotPath(document.uri.fsPath));
        let json: string;
        try {
            const bytes = await vscode.workspace.fs.readFile(source);
            json = Buffer.from(bytes).toString("utf8");
        } catch {
            this.post(panel, { type: "error", message: `No JSON sidecar to load at ${source.fsPath}` });
            return;
        }
        const r = await document.bridge.send({ type: "loadJson", sessionId: document.sessionId, json });
        if (r.type === "error") {
            this.post(panel, { type: "error", message: r.message });
            return;
        }
        if (r.type === "opened") {
            document.applyOpenResult(r.result);
            document.pushEdit("Load JSON");
            // A load can change the layout, so re-init all panels (rebuilds their view from the new model).
            this.postToDocumentPanels(document, { type: "init", open: r.result });
            await this.pushDiagnosticsToDocument(document);
        }
    }

    private getHtml(webview: vscode.Webview): string {
        const extensionPath = this.extensionUri.fsPath;
        let html = getCachedHtmlAsset("binary-editor-v2", extensionPath, WEBVIEW_HTML);
        const css = getCachedCssAsset("binary-editor-v2", extensionPath, [WEBVIEW_CSS]);
        html = inlineWebviewStyles(html, css);
        // Inline codicon.css with its font URL rewritten to a webview-resource URI so the font
        // loads under the strict CSP (default-src 'none' blocks the raw relative path).
        // The codicon @font-face src contains a relative url("./codicon.ttf?...") that must become
        // a vscode-resource:// URI the webview trusts; localResourceRoots is set to the same dir.
        const codiconTtfUri = webview.asWebviewUri(
            vscode.Uri.joinPath(this.extensionUri, "client", "out", "codicons", "codicon.ttf"),
        );
        const rawCodiconCss = getCachedCssAsset("binary-editor-v2-codicons", extensionPath, [
            path.join("client", "out", "codicons", "codicon.css"),
        ]);
        // Replace the relative font url (which may include a cache-busting query string) with the
        // absolute webview URI. The regex matches url("./codicon.ttf...") to url("./codicon.ttf?...").
        const codiconCss = rawCodiconCss.replace(/url\("\.\/codicon\.ttf[^"]*"\)/, () => `url("${codiconTtfUri}")`);
        html = html.replace("{{codiconStyles}}", () => codiconCss);
        const script = getCachedJsAsset("binary-editor-v2", extensionPath, WEBVIEW_JS);
        const nonce = generateNonce();
        html = inlineWebviewScript(html, script, nonce);
        return html.replaceAll("{{cspSource}}", webview.cspSource);
    }
}
