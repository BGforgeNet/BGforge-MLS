import type { Worker } from "node:worker_threads";
import * as vscode from "vscode";
import type { ChangeSet, OpenResult } from "@bgforge/binary-editor";
import { warnBackupUnreadable } from "../hot-exit-backup";
import { snapshotJsonFrom } from "./save";
import { WorkerBridge, workerPort } from "./worker-bridge";
import type { WorkerPool } from "./worker-pool";

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

/** An open that produced no session, in the shape the session itself returns for one (`openSession`), so the
 *  webview's "Could not open file" state shows it whichever side failed. */
function failedOpenResult(message: string): OpenResult {
    return {
        sessionId: "",
        format: "",
        formatName: "",
        layout: { formatId: "" },
        warnings: [],
        errors: [message],
        rootWindow: [],
    };
}

/**
 * A single open binary file backed by a worker session of its own. Owns the request/response bridge and the
 * parsed session id; the worker comes from, and goes back to, the provider's pool.
 *
 * The parse is started, not awaited, by `open`: VS Code creates the editor's webview only once
 * `openCustomDocument` returns, so awaiting it there would serialize the webview's boot behind the parse. Anything
 * that needs the session awaits `opened` first.
 */
export class BinaryEditorDocument implements vscode.CustomDocument {
    readonly uri: vscode.Uri;
    readonly bridge: WorkerBridge;
    sessionId = "";
    /** The open's result once `opened` settles; a failed open's carries the reason in `errors`. */
    openResult: OpenResult = failedOpenResult("The file is still opening");
    /** Settles when the parse lands, successful or not - it never rejects; a failure is in `openResult`. */
    readonly opened: Promise<void>;
    /** Engine of the game this record came from; re-sent on reload so a reopened session reads its own game's
     *  opcodes. Undefined for a file opened off disk. */
    private readonly engine?: string;

    private readonly worker: Worker;
    private readonly pool: WorkerPool;
    private readonly _onDidChange = new vscode.EventEmitter<vscode.CustomDocumentEditEvent<BinaryEditorDocument>>();
    readonly onDidChange = this._onDidChange.event;

    private readonly _onDidRefresh = new vscode.EventEmitter<ChangeSet | undefined>();
    /** Fires after an undo/redo has been applied in the worker, carrying the resulting changeSet so the provider
     *  can refresh panels exactly as it does after an edit (fields, tab counts, diagnostics, tree). */
    readonly onDidRefresh = this._onDidRefresh.event;

    private constructor(uri: vscode.Uri, pool: WorkerPool, backup: vscode.Uri | undefined, engine: string | undefined) {
        this.uri = uri;
        this.pool = pool;
        this.engine = engine;
        this.worker = pool.acquire();
        this.bridge = new WorkerBridge(workerPort(this.worker));
        this.opened = this.load(backup);
    }

    /**
     * Starts a parse session for `uri`. `backup` overrides only where the bytes are read from, leaving the
     * document's identity (and therefore the save target and the worker's format detection) on `uri` - a hot-exit
     * restore parses the backup while still saving to the original file. An unreadable backup falls back to the
     * saved file (see `readDocumentBytes`).
     */
    static open(uri: vscode.Uri, pool: WorkerPool, backup?: vscode.Uri, engine?: string): BinaryEditorDocument {
        return new BinaryEditorDocument(uri, pool, backup, engine);
    }

    private async load(backup: vscode.Uri | undefined): Promise<void> {
        try {
            const bytes = await readDocumentBytes(this.uri, backup);
            const response = await this.bridge.send({
                type: "open",
                uri: this.uri.toString(),
                bytes: new Uint8Array(bytes),
                engine: this.engine,
            });
            if (response.type === "opened" && response.result.sessionId) {
                this.applyOpenResult(response.result);
                // Only now, so the spare's startup never competes with this parse.
                this.pool.prestart();
            } else if (response.type === "opened" && response.result.errors.length > 0) {
                this.openResult = response.result;
            } else {
                this.openResult = failedOpenResult(
                    response.type === "error" ? response.message : "Failed to open binary file",
                );
            }
        } catch (error) {
            this.openResult = failedOpenResult(error instanceof Error ? error.message : String(error));
        }
    }

    /** The live session id, once the open has landed; throws the open's own error when it failed. */
    private async session(): Promise<string> {
        await this.opened;
        if (!this.sessionId) throw new Error(this.openResult.errors[0] ?? "Failed to open binary file");
        return this.sessionId;
    }

    /** Replace the cached OpenResult (after loadJson or a disk revert that changed the model/layout). */
    applyOpenResult(result: OpenResult): void {
        this.openResult = result;
        this.sessionId = result.sessionId;
    }

    /** Re-open the session from the file on disk (used by revert). Replaces the session and OpenResult. */
    async reloadFromDisk(): Promise<void> {
        const oldSessionId = await this.session();
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
        this.applyOpenResult(opened.result);
        await this.bridge.send({ type: "close", sessionId: oldSessionId });
    }

    /** Records an edit on the VSCode undo stack, delegating undo/redo to the worker session. */
    pushEdit(label: string): void {
        this._onDidChange.fire({
            document: this,
            label,
            undo: () => this.replay("undo", label),
            redo: () => this.replay("redo", label),
        });
    }

    /**
     * Steps the worker session's history. A refused step means VS Code's stack and the session's have parted,
     * so it is named to the user; the view is then refreshed whole, to whatever the session now holds.
     */
    private async replay(step: "undo" | "redo", label: string): Promise<void> {
        const r = await this.bridge.send({ type: step, sessionId: this.sessionId });
        if (r.type === "error") void vscode.window.showErrorMessage(`Could not ${step} "${label}": ${r.message}`);
        this._onDidRefresh.fire(r.type === "structure" ? r.result.changeSet : undefined);
    }

    /** Current serialized bytes for the session. */
    async getBytes(): Promise<Uint8Array> {
        const response = await this.bridge.send({ type: "serialize", sessionId: await this.session() });
        if (response.type !== "serialized") {
            throw new Error(response.type === "error" ? response.message : "Failed to serialize");
        }
        return response.bytes;
    }

    /** The canonical JSON snapshot for the sidecar; throws when the worker cannot produce one. */
    async getSnapshotJson(): Promise<string> {
        return snapshotJsonFrom(await this.bridge.send({ type: "snapshot", sessionId: await this.session() }));
    }

    dispose(): void {
        this._onDidChange.dispose();
        this._onDidRefresh.dispose();
        void this.retire();
    }

    /**
     * Close the session and hand the worker back. It is offered for reuse only when the close was answered and the
     * bridge never lost a request; otherwise the pool ends it.
     */
    private async retire(): Promise<void> {
        let closed = false;
        try {
            await this.opened;
            if (this.sessionId) {
                const reply = await this.bridge.send({ type: "close", sessionId: this.sessionId });
                closed = reply.type !== "error";
            } else {
                closed = true;
            }
        } catch {
            closed = false;
        }
        const reusable = closed && this.bridge.reusable;
        this.bridge.dispose();
        this.pool.release(this.worker, reusable);
    }
}
