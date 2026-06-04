import { Worker } from "node:worker_threads";
import * as vscode from "vscode";
import type { OpenResult } from "@bgforge/binary-editor";
import { WorkerBridge, workerPort } from "./worker-bridge";

/**
 * A single open binary file backed by a dedicated worker session. Owns the worker
 * thread, the request/response bridge, and the parsed session id. The parse runs in
 * the worker on construction (`open`), so `openResult` is populated before the
 * document is handed to the provider for webview initialization.
 */
export class BinaryEditorDocument implements vscode.CustomDocument {
    readonly uri: vscode.Uri;
    readonly bridge: WorkerBridge;
    readonly sessionId: string;
    openResult: OpenResult;

    private readonly worker: Worker;
    private readonly _onDidChange = new vscode.EventEmitter<vscode.CustomDocumentEditEvent<BinaryEditorDocument>>();
    readonly onDidChange = this._onDidChange.event;

    private readonly _onDidRefresh = new vscode.EventEmitter<void>();
    /** Fires after an undo/redo has been applied in the worker, so the provider can refresh panels. */
    readonly onDidRefresh = this._onDidRefresh.event;

    private constructor(uri: vscode.Uri, worker: Worker, bridge: WorkerBridge, openResult: OpenResult) {
        this.uri = uri;
        this.worker = worker;
        this.bridge = bridge;
        this.openResult = openResult;
        this.sessionId = openResult.sessionId;
    }

    static async open(uri: vscode.Uri, workerScript: string): Promise<BinaryEditorDocument> {
        const bytes = await vscode.workspace.fs.readFile(uri);
        const worker = new Worker(workerScript);
        const bridge = new WorkerBridge(workerPort(worker));
        const response = await bridge.send({
            type: "open",
            uri: uri.toString(),
            bytes: new Uint8Array(bytes),
        });
        if (response.type !== "opened" || !response.result.sessionId) {
            const message =
                response.type === "opened"
                    ? (response.result.errors[0] ?? "Failed to open binary file")
                    : response.type === "error"
                      ? response.message
                      : "Failed to open binary file";
            bridge.dispose();
            await worker.terminate();
            throw new Error(message);
        }
        return new BinaryEditorDocument(uri, worker, bridge, response.result);
    }

    /** Replace the cached OpenResult (after loadJson or a disk revert that changed the model/layout). */
    applyOpenResult(result: OpenResult): void {
        this.openResult = result;
    }

    /** Records an edit on the VSCode undo stack, delegating undo/redo to the worker session. */
    pushEdit(label: string): void {
        this._onDidChange.fire({
            document: this,
            label,
            undo: async () => {
                await this.bridge.send({ type: "undo", sessionId: this.sessionId });
                this._onDidRefresh.fire();
            },
            redo: async () => {
                await this.bridge.send({ type: "redo", sessionId: this.sessionId });
                this._onDidRefresh.fire();
            },
        });
    }

    /** Current serialized bytes for the session. */
    async getBytes(): Promise<Uint8Array> {
        const response = await this.bridge.send({ type: "serialize", sessionId: this.sessionId });
        if (response.type !== "serialized") {
            throw new Error(response.type === "error" ? response.message : "Failed to serialize");
        }
        return response.bytes;
    }

    /** JSON snapshot for the autoDumpJson sidecar, or "" if the format has no snapshot. */
    async getSnapshotJson(): Promise<string> {
        const response = await this.bridge.send({ type: "snapshot", sessionId: this.sessionId });
        return response.type === "snapshot" ? response.json : "";
    }

    dispose(): void {
        this._onDidChange.dispose();
        this._onDidRefresh.dispose();
        this.bridge.dispose();
        void this.worker.terminate();
    }
}
