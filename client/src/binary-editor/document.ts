import { Worker } from "node:worker_threads";
import * as vscode from "vscode";
import type { ChangeSet, OpenResult } from "@bgforge/binary-editor";
import { warnBackupUnreadable } from "../hot-exit-backup";
import { WorkerBridge, workerPort } from "./worker-bridge";

/**
 * Bytes to parse: the hot-exit backup when one is readable, otherwise the file itself. The unreadable-backup
 * policy and its message are shared with the other custom editors (see `warnBackupUnreadable`). The scope here
 * is deliberately the read alone: with no backup in play, an unreadable file still fails the open.
 */
async function readDocumentBytes(uri: vscode.Uri, backup?: vscode.Uri): Promise<Uint8Array> {
    if (!backup) return vscode.workspace.fs.readFile(uri);
    try {
        return await vscode.workspace.fs.readFile(backup);
    } catch {
        warnBackupUnreadable(uri);
        return vscode.workspace.fs.readFile(uri);
    }
}

/**
 * A single open binary file backed by a dedicated worker session. Owns the worker
 * thread, the request/response bridge, and the parsed session id. The parse runs in
 * the worker on construction (`open`), so `openResult` is populated before the
 * document is handed to the provider for webview initialization.
 */
export class BinaryEditorDocument implements vscode.CustomDocument {
    readonly uri: vscode.Uri;
    readonly bridge: WorkerBridge;
    sessionId: string;
    openResult: OpenResult;
    /** Engine of the game this record came from; re-sent on reload so a reopened session reads its own game's
     *  opcodes. Undefined for a file opened off disk. */
    private readonly engine?: string;

    private readonly worker: Worker;
    private readonly _onDidChange = new vscode.EventEmitter<vscode.CustomDocumentEditEvent<BinaryEditorDocument>>();
    readonly onDidChange = this._onDidChange.event;

    private readonly _onDidRefresh = new vscode.EventEmitter<ChangeSet | undefined>();
    /** Fires after an undo/redo has been applied in the worker, carrying the resulting changeSet so the provider
     *  can refresh panels exactly as it does after an edit (fields, tab counts, diagnostics, tree). */
    readonly onDidRefresh = this._onDidRefresh.event;

    private constructor(
        uri: vscode.Uri,
        worker: Worker,
        bridge: WorkerBridge,
        openResult: OpenResult,
        engine?: string,
    ) {
        this.uri = uri;
        this.worker = worker;
        this.bridge = bridge;
        this.openResult = openResult;
        this.sessionId = openResult.sessionId;
        this.engine = engine;
    }

    /**
     * Opens a parse session for `uri`. `backup` overrides only where the bytes are read from, leaving the
     * document's identity (and therefore the save target and the worker's format detection) on `uri` - a hot-exit
     * restore parses the backup while still saving to the original file. An unreadable backup falls back to the
     * saved file (see `readDocumentBytes`).
     */
    static async open(
        uri: vscode.Uri,
        workerScript: string,
        backup?: vscode.Uri,
        engine?: string,
    ): Promise<BinaryEditorDocument> {
        const bytes = await readDocumentBytes(uri, backup);
        const worker = new Worker(workerScript);
        const bridge = new WorkerBridge(workerPort(worker));
        const response = await bridge.send({
            type: "open",
            uri: uri.toString(),
            bytes: new Uint8Array(bytes),
            engine,
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
        return new BinaryEditorDocument(uri, worker, bridge, response.result, engine);
    }

    /** Replace the cached OpenResult (after loadJson or a disk revert that changed the model/layout). */
    applyOpenResult(result: OpenResult): void {
        this.openResult = result;
    }

    /** Re-open the session from the file on disk (used by revert). Replaces the session and OpenResult. */
    async reloadFromDisk(): Promise<void> {
        const bytes = await vscode.workspace.fs.readFile(this.uri);
        const opened = await this.bridge.send({
            type: "open",
            uri: this.uri.toString(),
            bytes: new Uint8Array(bytes),
            engine: this.engine,
        });
        if (opened.type !== "opened" || !opened.result.sessionId) {
            throw new Error(opened.type === "error" ? opened.message : "Failed to reopen binary file");
        }
        const oldSessionId = this.sessionId;
        this.sessionId = opened.result.sessionId;
        this.applyOpenResult(opened.result);
        await this.bridge.send({ type: "close", sessionId: oldSessionId });
    }

    /** Records an edit on the VSCode undo stack, delegating undo/redo to the worker session. */
    pushEdit(label: string): void {
        this._onDidChange.fire({
            document: this,
            label,
            undo: async () => {
                const r = await this.bridge.send({ type: "undo", sessionId: this.sessionId });
                this._onDidRefresh.fire(r.type === "structure" ? r.result.changeSet : undefined);
            },
            redo: async () => {
                const r = await this.bridge.send({ type: "redo", sessionId: this.sessionId });
                this._onDidRefresh.fire(r.type === "structure" ? r.result.changeSet : undefined);
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
