/**
 * Guards the binary editor's hot-exit restore. When VS Code re-opens a document that was dirty at shutdown it
 * passes back the backup it had asked us to write, and the session must parse THOSE bytes (the unsaved edits)
 * while keeping the original URI as the document's identity, so the next save still targets the real file.
 * The fix lives in the wiring rather than in any single helper, so this drives the real openCustomDocument
 * through a mocked vscode and a fake worker - the two boundaries the provider does not own.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import type * as vscode from "vscode";

const DOC_URI = "bgforge-ie-resource:/sw1h01.itm?g=/games/tob";
const BACKUP_URI = "file:///storage/backups/sw1h01.itm.bak";
const DISK_BYTES = new Uint8Array([1, 1, 1]);
const BACKUP_BYTES = new Uint8Array([2, 2, 2]);

const { readFileMock, showWarningMock, workerRequests } = vi.hoisted(() => ({
    readFileMock: vi.fn(),
    showWarningMock: vi.fn(),
    workerRequests: [] as { type: string; uri?: string; bytes?: Uint8Array; engine?: string }[],
}));

vi.mock("vscode", () => {
    class EventEmitter {
        readonly event = (): { dispose: () => void } => ({ dispose: () => {} });
        fire(): void {}
        dispose(): void {}
    }
    return {
        EventEmitter,
        Uri: { parse: (value: string) => ({ toString: () => value }) },
        window: { showWarningMessage: showWarningMock },
        workspace: { fs: { readFile: readFileMock } },
    };
});

// The worker is a real OS thread the document spawns; stand in for it with an in-process fake that answers
// `open` so the real WorkerBridge/workerPort adapter still runs between the document and the transport.
vi.mock("node:worker_threads", () => {
    class Worker {
        private onMessage: ((msg: unknown) => void) | undefined;

        on(event: string, cb: (msg: unknown) => void): void {
            if (event === "message") this.onMessage = cb;
        }

        postMessage(msg: {
            id: number;
            request: { type: string; uri?: string; bytes?: Uint8Array; engine?: string };
        }): void {
            workerRequests.push(msg.request);
            queueMicrotask(() =>
                this.onMessage?.({
                    id: msg.id,
                    response: {
                        type: "opened",
                        result: {
                            sessionId: "session-1",
                            format: "itm",
                            formatName: "ITM",
                            layout: { blocks: [] },
                            warnings: [],
                            errors: [],
                            rootWindow: [],
                        },
                    },
                }),
            );
        }

        terminate(): Promise<number> {
            return Promise.resolve(0);
        }
    }
    return { Worker };
});

const { BinaryEditorProvider } = await import("../../src/binary-editor/provider");

// The provider reads only extensionUri off the context; a full ExtensionContext cannot be built without the
// live runtime, so assert the shape we actually depend on rather than constructing the other ~30 members.
const context = { extensionUri: { fsPath: "/ext" } } as unknown as vscode.ExtensionContext;

// Carries `path` as well as `toString`: a real vscode.Uri has both, and the restore path names the file in
// its warning. A double missing `path` would fail the code rather than the behaviour under test.
function uri(value: string): vscode.Uri {
    const path = value.slice(value.indexOf(":") + 1).split(/[?#]/, 1)[0]!;
    return { path, toString: () => value } as unknown as vscode.Uri;
}

function openContext(backupId?: string): vscode.CustomDocumentOpenContext {
    return { backupId, untitledDocumentData: undefined } as vscode.CustomDocumentOpenContext;
}

const token = {} as vscode.CancellationToken;

// This suite is about the restore path, not game lookups: a record outside a game resolves nothing.
const noGame = {
    strref: (): undefined => undefined,
    slotLabel: (): undefined => undefined,
    namingTable: (): undefined => undefined,
    resourceType: (): undefined => undefined,
    resourceList: (): undefined => undefined,
    engine: (): undefined => undefined,
    isGameBacked: (): boolean => false,
};

describe("binary editor hot-exit restore", () => {
    beforeEach(() => {
        workerRequests.length = 0;
        readFileMock.mockReset();
        showWarningMock.mockReset();
        readFileMock.mockImplementation((target: { toString: () => string }) =>
            Promise.resolve(target.toString() === BACKUP_URI ? BACKUP_BYTES : DISK_BYTES),
        );
    });

    it("parses the backup bytes, not the file on disk, when restoring a dirty document", async () => {
        const provider = new BinaryEditorProvider(context, noGame);

        const document = await provider.openCustomDocument(uri(DOC_URI), openContext(BACKUP_URI), token);

        expect(readFileMock.mock.calls.map(([target]) => String(target))).toEqual([BACKUP_URI]);
        expect(workerRequests).toEqual([{ type: "open", uri: DOC_URI, bytes: BACKUP_BYTES, engine: undefined }]);
        // Identity stays on the real file so a subsequent save writes there, not into the backup.
        expect(document.uri.toString()).toBe(DOC_URI);
    });

    it("reads the file itself when opening without a backup", async () => {
        const provider = new BinaryEditorProvider(context, noGame);

        await provider.openCustomDocument(uri(DOC_URI), openContext(), token);

        expect(readFileMock.mock.calls.map(([target]) => String(target))).toEqual([DOC_URI]);
        expect(workerRequests).toEqual([{ type: "open", uri: DOC_URI, bytes: DISK_BYTES, engine: undefined }]);
    });

    /**
     * An unreadable backup must not make the file unopenable. VS Code hands back whatever backupId it stored,
     * which can outlive the extension version that wrote it or be cleaned up underneath us - and the unsaved
     * edits are unrecoverable either way, so refusing to open loses the SAVED file too. Degrade to disk and
     * say so, rather than propagating out of openCustomDocument.
     */
    it("falls back to the saved file, with a warning, when the backup cannot be read", async () => {
        readFileMock.mockImplementation((target: { toString: () => string }) =>
            target.toString() === BACKUP_URI
                ? Promise.reject(new Error("backup is gone"))
                : Promise.resolve(DISK_BYTES),
        );
        const provider = new BinaryEditorProvider(context, noGame);

        const document = await provider.openCustomDocument(uri(DOC_URI), openContext(BACKUP_URI), token);

        expect(workerRequests).toEqual([{ type: "open", uri: DOC_URI, bytes: DISK_BYTES, engine: undefined }]);
        expect(document.uri.toString()).toBe(DOC_URI);
        expect(showWarningMock).toHaveBeenCalledTimes(1);
        expect(String(showWarningMock.mock.calls[0]?.[0])).toContain("sw1h01.itm");
    });

    // The fallback is for a broken BACKUP, not for a broken file: with no backup in play an unreadable
    // document still fails the open, so a genuine read error is never swallowed into an empty editor.
    it("still fails the open when the file itself cannot be read", async () => {
        readFileMock.mockImplementation(() => Promise.reject(new Error("disk is gone")));
        const provider = new BinaryEditorProvider(context, noGame);

        await expect(provider.openCustomDocument(uri(DOC_URI), openContext(), token)).rejects.toThrow("disk is gone");
    });

    // An opcode means what its game's engine says it means, and only the host can resolve which game a record
    // came from - the worker is handed bytes. This is the one place that hand-off can be checked end to end.
    it("sends the game's engine to the worker so the session reads its opcodes that way", async () => {
        const provider = new BinaryEditorProvider(context, { ...noGame, engine: () => "bg2" });

        await provider.openCustomDocument(uri(DOC_URI), openContext(), token);

        expect(workerRequests).toEqual([{ type: "open", uri: DOC_URI, bytes: DISK_BYTES, engine: "bg2" }]);
    });
});
