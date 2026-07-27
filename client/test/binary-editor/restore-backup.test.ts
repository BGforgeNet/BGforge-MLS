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

const { readFileMock, workerRequests } = vi.hoisted(() => ({
    readFileMock: vi.fn(),
    workerRequests: [] as { type: string; uri?: string; bytes?: Uint8Array }[],
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

        postMessage(msg: { id: number; request: { type: string; uri?: string; bytes?: Uint8Array } }): void {
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

function uri(value: string): vscode.Uri {
    return { toString: () => value } as unknown as vscode.Uri;
}

function openContext(backupId?: string): vscode.CustomDocumentOpenContext {
    return { backupId, untitledDocumentData: undefined } as vscode.CustomDocumentOpenContext;
}

const token = {} as vscode.CancellationToken;

// This suite is about the restore path, not strref resolution: a record outside a game resolves nothing.
const noStrrefs = (): undefined => undefined;

describe("binary editor hot-exit restore", () => {
    beforeEach(() => {
        workerRequests.length = 0;
        readFileMock.mockReset();
        readFileMock.mockImplementation((target: { toString: () => string }) =>
            Promise.resolve(target.toString() === BACKUP_URI ? BACKUP_BYTES : DISK_BYTES),
        );
    });

    it("parses the backup bytes, not the file on disk, when restoring a dirty document", async () => {
        const provider = new BinaryEditorProvider(context, noStrrefs);

        const document = await provider.openCustomDocument(uri(DOC_URI), openContext(BACKUP_URI), token);

        expect(readFileMock.mock.calls.map(([target]) => String(target))).toEqual([BACKUP_URI]);
        expect(workerRequests).toEqual([{ type: "open", uri: DOC_URI, bytes: BACKUP_BYTES }]);
        // Identity stays on the real file so a subsequent save writes there, not into the backup.
        expect(document.uri.toString()).toBe(DOC_URI);
    });

    it("reads the file itself when opening without a backup", async () => {
        const provider = new BinaryEditorProvider(context, noStrrefs);

        await provider.openCustomDocument(uri(DOC_URI), openContext(), token);

        expect(readFileMock.mock.calls.map(([target]) => String(target))).toEqual([DOC_URI]);
        expect(workerRequests).toEqual([{ type: "open", uri: DOC_URI, bytes: DISK_BYTES }]);
    });
});
