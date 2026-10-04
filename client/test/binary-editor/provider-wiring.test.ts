/**
 * The binary editor's provider wiring, driven through a mocked vscode and a fake worker - the two boundaries
 * it does not own. Both subjects here live in the wiring rather than in any helper, so nothing below the
 * provider can guard them.
 *
 * Hot-exit restore: when VS Code re-opens a document that was dirty at shutdown it passes back the backup it
 * had asked us to write, and the session must parse THOSE bytes (the unsaved edits) while keeping the
 * original URI as the document's identity, so the next save still targets the real file.
 *
 * Game changes: every label the editor shows is resolved against whichever install is open when the message
 * goes out, so an editor open across a game change is showing the previous game's answers.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import type * as vscode from "vscode";

const DOC_URI = "bgforge-ie-resource:/sw1h01.itm?g=/games/tob";
const BACKUP_URI = "file:///storage/backups/sw1h01.itm.bak";
const DISK_BYTES = new Uint8Array([1, 1, 1]);
const BACKUP_BYTES = new Uint8Array([2, 2, 2]);

const { readFileMock, showWarningMock, showErrorMock, workerRequests, workers, gate, CHANGE_SET } = vi.hoisted(() => ({
    readFileMock: vi.fn(),
    showWarningMock: vi.fn(),
    showErrorMock: vi.fn(),
    workerRequests: [] as { type: string; uri?: string; bytes?: Uint8Array; engine?: string }[],
    /** Every fake worker spawned, in order, each with the request types it was sent. */
    workers: [] as { requests: string[]; terminated: boolean }[],
    /** When set, `open` replies wait for it: a test holds the parse open to observe the webview meanwhile. */
    gate: { open: undefined as Promise<void> | undefined },
    // One row is enough to tell a re-projection apart from an empty refresh.
    CHANGE_SET: { changed: [{ id: "root/0", kind: "field", label: "Name" }], diagnostics: [], dirty: false },
}));

vi.mock("vscode", () => {
    class EventEmitter {
        private readonly listeners: ((event: unknown) => void)[] = [];
        readonly event = (listener: (event: unknown) => void): { dispose: () => void } => {
            this.listeners.push(listener);
            return { dispose: () => {} };
        };
        fire(event: unknown): void {
            for (const listener of this.listeners) listener(event);
        }
        dispose(): void {}
    }
    return {
        EventEmitter,
        Uri: {
            parse: (value: string) => ({ toString: () => value }),
            joinPath: (...parts: unknown[]) => ({ toString: () => parts.join("/") }),
        },
        window: { showWarningMessage: showWarningMock, showErrorMessage: showErrorMock },
        workspace: { fs: { readFile: readFileMock } },
    };
});

// The worker is a real OS thread the document spawns; stand in for it with an in-process fake that answers
// `open` so the real WorkerBridge/workerPort adapter still runs between the document and the transport.
vi.mock("node:worker_threads", () => {
    class Worker {
        private onMessage: ((msg: unknown) => void) | undefined;
        private readonly record = { requests: [] as string[], terminated: false };

        constructor() {
            workers.push(this.record);
        }

        on(event: string, cb: (msg: unknown) => void): void {
            if (event === "message") this.onMessage = cb;
        }

        off(event: string, cb: (msg: unknown) => void): void {
            if (event === "message" && this.onMessage === cb) this.onMessage = undefined;
        }

        ref(): void {}
        unref(): void {}

        postMessage(msg: {
            id: number;
            request: { type: string; uri?: string; bytes?: Uint8Array; engine?: string };
        }): void {
            workerRequests.push(msg.request);
            this.record.requests.push(msg.request.type);
            // A dead worker, for the one request only the failure test sends.
            if (msg.request.type === "getChildren") throw new Error("worker is gone");
            const response =
                msg.request.type === "reproject"
                    ? { type: "structure", result: { changeSet: CHANGE_SET } }
                    : msg.request.type === "undo"
                      ? { type: "error", message: "nothing to undo" }
                      : msg.request.type === "close"
                        ? { type: "closed" }
                        : msg.request.type === "validate"
                          ? { type: "diagnostics", diagnostics: [] }
                          : {
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
                            };
            const held = msg.request.type === "open" ? gate.open : undefined;
            void (held ?? Promise.resolve()).then(() => this.onMessage?.({ id: msg.id, response }));
        }

        terminate(): Promise<number> {
            this.record.terminated = true;
            return Promise.resolve(0);
        }
    }
    return { Worker };
});

// The output channel is the live extension's; the toast is what these tests read.
vi.mock("../../src/logging", () => ({ conlog: vi.fn() }));

// Mounting a panel reads the webview bundle off disk, which this suite has no build of and does not test.
vi.mock("../../src/webview-assets", () => ({
    getCachedHtmlAsset: () => "<html>{{stylesUri}}{{codiconsUri}}{{baseUri}}{{primitivesUri}}{{cspSource}}</html>",
    getCachedJsAsset: () => "",
    inlineWebviewScript: (html: string) => html,
    generateNonce: () => "nonce",
}));

const { BinaryEditorProvider } = await import("../../src/binary-editor/provider");

// The provider reads only extensionUri off the context; a full ExtensionContext cannot be built without the
// live runtime, so assert the shape we actually depend on rather than constructing the other ~30 members.
const context = { extensionUri: { fsPath: "/ext" } } as unknown as vscode.ExtensionContext;

// Carries `path` as well as `toString`: a real vscode.Uri has both, and the restore path names the file in
// its warning. A double missing `path` would fail the code rather than the behaviour under test.
function uri(value: string): vscode.Uri {
    const path = value.slice(value.indexOf(":") + 1).split(/[?#]/, 1)[0]!;
    return { path, fsPath: path, toString: () => value } as unknown as vscode.Uri;
}

function openContext(backupId?: string): vscode.CustomDocumentOpenContext {
    return { backupId, untitledDocumentData: undefined };
}

const token = {} as vscode.CancellationToken;

/** Open the test document and wait for its parse, which `openCustomDocument` starts but does not await. */
async function openDocument(provider: InstanceType<typeof BinaryEditorProvider>, backupId?: string) {
    const document = provider.openCustomDocument(uri(DOC_URI), openContext(backupId), token);
    await document.opened;
    return document;
}

// This suite is about the restore path, not game lookups: a record outside a game resolves nothing.
const noGame = {
    onDidChangeGame: () => ({ dispose: () => {} }),
    strref: (): undefined => undefined,
    slotLabel: (): undefined => undefined,
    namingTable: (): undefined => undefined,
    colorGradient: (): undefined => undefined,
    resourceType: (): undefined => undefined,
    flagBitNames: (): undefined => undefined,
    resourceList: (): undefined => undefined,
    resourceBytes: (): undefined => undefined,
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

        const document = await openDocument(provider, BACKUP_URI);

        expect(readFileMock.mock.calls.map(([target]) => String(target))).toEqual([BACKUP_URI]);
        expect(workerRequests).toEqual([{ type: "open", uri: DOC_URI, bytes: BACKUP_BYTES, engine: undefined }]);
        // Identity stays on the real file so a subsequent save writes there, not into the backup.
        expect(document.uri.toString()).toBe(DOC_URI);
    });

    it("reads the file itself when opening without a backup", async () => {
        const provider = new BinaryEditorProvider(context, noGame);

        await openDocument(provider);

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

        const document = await openDocument(provider, BACKUP_URI);

        expect(workerRequests).toEqual([{ type: "open", uri: DOC_URI, bytes: DISK_BYTES, engine: undefined }]);
        expect(document.uri.toString()).toBe(DOC_URI);
        expect(showWarningMock).toHaveBeenCalledTimes(1);
        expect(String(showWarningMock.mock.calls[0]?.[0])).toContain("sw1h01.itm");
    });

    // The fallback is for a broken BACKUP, not for a broken file: with no backup in play an unreadable
    // document still fails the open, so a genuine read error is never swallowed into an empty editor. The
    // panel already exists by then, so the failure is told there, by the error it failed with.
    it("still fails the open when the file itself cannot be read", async () => {
        readFileMock.mockImplementation(() => Promise.reject(new Error("disk is gone")));
        const provider = new BinaryEditorProvider(context, noGame);
        const document = await openDocument(provider);
        const { panel, posted, send } = fakePanel();
        await provider.resolveCustomEditor(document, panel, token);

        await send({ type: "ready" });

        expect(workerRequests).toEqual([]);
        expect(posted).toEqual([
            { type: "init", open: expect.objectContaining({ sessionId: "", errors: ["disk is gone"] }) },
        ]);
        await expect(document.getBytes()).rejects.toThrow("disk is gone");
    });

    // An opcode means what its game's engine says it means, and only the host can resolve which game a record
    // came from - the worker is handed bytes. This is the one place that hand-off can be checked end to end.
    it("sends the game's engine to the worker so the session reads its opcodes that way", async () => {
        const provider = new BinaryEditorProvider(context, { ...noGame, engine: () => "bg2" });

        await openDocument(provider);

        expect(workerRequests).toEqual([{ type: "open", uri: DOC_URI, bytes: DISK_BYTES, engine: "bg2" }]);
    });
});

/** A panel that records what the host posts and hands back the webview's own channels. */
function fakePanel() {
    const posted: { type: string }[] = [];
    let dispose: (() => void) | undefined;
    let receive: ((message: unknown) => Promise<void>) | undefined;
    const panel = {
        webview: {
            options: {},
            html: "",
            cspSource: "vscode-webview:",
            asWebviewUri: (value: unknown) => value,
            postMessage: (message: { type: string }) => {
                posted.push(message);
                return Promise.resolve(true);
            },
            onDidReceiveMessage: (listener: (message: unknown) => Promise<void>) => {
                receive = listener;
                return { dispose: () => {} };
            },
        },
        onDidDispose: (cb: () => void) => {
            dispose = cb;
            return { dispose: () => {} };
        },
    };
    return {
        posted,
        panel: panel as unknown as vscode.WebviewPanel,
        close: () => dispose?.(),
        send: (message: unknown) => receive?.(message),
    };
}

describe("binary editor request failures", () => {
    beforeEach(() => {
        workerRequests.length = 0;
        readFileMock.mockReset();
        readFileMock.mockImplementation(() => Promise.resolve(DISK_BYTES));
    });

    // The webview holds a promise per requestId and settles it only on a reply naming that id, so an error
    // without one leaves the view waiting for rows that are never coming.
    it("answers a request the worker failed with an error naming the request", async () => {
        const provider = new BinaryEditorProvider(context, noGame);
        const document = await openDocument(provider);
        const { panel, posted, send } = fakePanel();
        await provider.resolveCustomEditor(document, panel, token);

        await send({ type: "requestChildren", requestId: 7, nodeId: null, start: 0, end: 10 });

        expect(posted).toContainEqual({ type: "error", requestId: 7, message: "worker is gone" });
    });

    // The webview and the host disagreeing about the contract is a bug; dropping the message hides it.
    it("reports a message outside the webview protocol instead of dropping it", async () => {
        const provider = new BinaryEditorProvider(context, noGame);
        const document = await openDocument(provider);
        const { panel, send } = fakePanel();
        await provider.resolveCustomEditor(document, panel, token);
        showErrorMock.mockClear();

        await send({ type: "bogus" });

        expect(showErrorMock).toHaveBeenCalledWith(
            "Binary editor failed for sw1h01.itm: unrecognized message of type bogus",
        );
    });

    // VS Code's undo stack and the worker's history have parted on this step: say which step and why, then
    // re-sync the view to whatever the session now holds.
    it("says why an undo the worker refused failed, and still refreshes the view", async () => {
        const provider = new BinaryEditorProvider(context, noGame);
        const document = await openDocument(provider);
        const edits: vscode.CustomDocumentEditEvent[] = [];
        document.onDidChange((edit) => edits.push(edit));
        const refreshes: unknown[] = [];
        document.onDidRefresh((changeSet) => refreshes.push(changeSet));
        document.pushEdit("Edit Name");

        await edits[0]!.undo();

        expect(showErrorMock).toHaveBeenCalledWith('Could not undo "Edit Name": nothing to undo');
        expect(refreshes).toEqual([undefined]);
    });
});

describe("binary editor open lifecycle", () => {
    beforeEach(() => {
        workerRequests.length = 0;
        workers.length = 0;
        gate.open = undefined;
        readFileMock.mockReset();
        readFileMock.mockImplementation(() => Promise.resolve(DISK_BYTES));
    });

    // VS Code creates the panel only once openCustomDocument returns, so returning before the parse is what lets
    // the webview boot alongside it; the webview then has to wait for the parse rather than get an empty init.
    it("returns the document before the parse lands, and answers the webview's ready once it has", async () => {
        let release = (): void => {};
        gate.open = new Promise((resolve) => {
            release = resolve;
        });
        const provider = new BinaryEditorProvider(context, noGame);
        const document = provider.openCustomDocument(uri(DOC_URI), openContext(), token);
        const { panel, posted, send } = fakePanel();
        await provider.resolveCustomEditor(document, panel, token);

        const ready = send({ type: "ready" });
        await vi.waitFor(() => expect(workerRequests.map((r) => r.type)).toEqual(["open"]));
        expect(posted).toEqual([]);

        release();
        await ready;
        expect(posted[0]).toEqual({ type: "init", open: expect.objectContaining({ sessionId: "session-1" }) });
    });

    // The next file opens on a worker that already started, which is where most of a small file's open went.
    it("opens the next document on the worker started after the first one's parse", async () => {
        const provider = new BinaryEditorProvider(context, noGame);
        await openDocument(provider);
        expect(workers).toHaveLength(2);

        await openDocument(provider);

        expect(workers[1]!.requests).toEqual(["open"]);
        expect(workers).toHaveLength(3);
    });

    it("closes a disposed document's session before handing its worker back", async () => {
        const provider = new BinaryEditorProvider(context, noGame);
        const document = await openDocument(provider);

        document.dispose();

        await vi.waitFor(() => expect(workers[0]!.requests).toEqual(["open", "close"]));
        // A spare was already parked, so this one is ended rather than kept as a second.
        await vi.waitFor(() => expect(workers[0]!.terminated).toBe(true));
    });
});

describe("binary editor across a game change", () => {
    beforeEach(() => {
        workerRequests.length = 0;
        readFileMock.mockReset();
        readFileMock.mockImplementation(() => Promise.resolve(DISK_BYTES));
    });

    /** Wire a provider whose game-changed event the test can fire. */
    function wired() {
        const listeners: (() => void)[] = [];
        const provider = new BinaryEditorProvider(context, {
            ...noGame,
            onDidChangeGame: (listener: () => void) => {
                listeners.push(listener);
                return {
                    dispose: () => {
                        const at = listeners.indexOf(listener);
                        if (at !== -1) listeners.splice(at, 1);
                    },
                };
            },
        });
        return {
            provider,
            gameOpened: () => {
                for (const listener of listeners) listener();
            },
        };
    }

    // Every strref, IDS name and gradient in the view was resolved against whatever was open when the message
    // was sent. Nothing re-sends on its own, so an editor open when a game opens keeps the numbers.
    it("re-projects an open panel's fields when a game opens under it", async () => {
        const { provider, gameOpened } = wired();
        const document = await openDocument(provider);
        const { panel, posted } = fakePanel();
        await provider.resolveCustomEditor(document, panel, token);
        posted.length = 0;
        workerRequests.length = 0;

        gameOpened();
        await vi.waitFor(() => expect(posted.length).toBeGreaterThan(0));

        // A changeSet built from the LIVE session, not a re-init from the state the document opened in: the
        // reader keeps their selection, and an unsaved edit is in the model and nowhere else.
        expect(workerRequests.map((request) => request.type)).toEqual(["reproject"]);
        expect(posted).toEqual([{ type: "changeSet", changeSet: CHANGE_SET }]);
    });

    it("stops telling a closed panel anything", async () => {
        const { provider, gameOpened } = wired();
        const document = await openDocument(provider);
        const { panel, posted, close } = fakePanel();
        await provider.resolveCustomEditor(document, panel, token);
        posted.length = 0;

        close();
        workerRequests.length = 0;
        gameOpened();
        await Promise.resolve();

        expect(workerRequests).toEqual([]);
        expect(posted).toEqual([]);
    });
});
