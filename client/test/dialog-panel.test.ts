/**
 * Integration test for the dialog editor's CustomTextEditor session wiring (panel.ts). The SerialQueue and
 * EchoGuard are unit-tested in isolation; this drives the REAL resolveCustomTextEditor through a mocked vscode
 * to cover the two things only their composition exhibits: back-to-back edits serialize through the queue (never
 * run applyEdit concurrently), and an edit whose LSP parse is still in flight when the panel is disposed does NOT
 * touch the document afterward (the disposed-mid-flight guard the WeakMap session survives to see).
 */
import { vi, describe, expect, it, beforeEach } from "vitest";
import type * as vscode from "vscode";
import type { LanguageClient } from "vscode-languageclient/node";
import type { DialogModel } from "../../shared/dialog-model";

const { applyEditMock, computeDialogSourceEditMock, showErrorMessageMock } = vi.hoisted(() => ({
    applyEditMock: vi.fn(async () => true),
    computeDialogSourceEditMock: vi.fn(() => ({ newText: null, messages: {}, allocations: {} })),
    showErrorMessageMock: vi.fn(),
}));

// A valid (empty) D parse payload: toModel keys off `blocks`/`nodes`, so this yields a non-null model - a normal
// open document always parses to at least an empty model (a null result means the server threw: a real failure).
const OK_PARSE = { blocks: [], states: [] };

vi.mock("vscode", () => ({
    Uri: { joinPath: (...parts: unknown[]) => ({ path: parts.join("/") }) },
    Range: vi.fn(),
    Position: vi.fn(),
    WorkspaceEdit: class {
        replace(): void {}
    },
    workspace: {
        applyEdit: applyEditMock,
        onDidChangeTextDocument: vi.fn(() => ({ dispose: vi.fn() })),
        onDidSaveTextDocument: vi.fn(() => ({ dispose: vi.fn() })),
    },
    window: {
        showErrorMessage: showErrorMessageMock,
        showWarningMessage: vi.fn(),
        showInformationMessage: vi.fn(),
    },
}));

// Keep resolveCustomTextEditor's HTML build off the filesystem, and stub the edit computation so the test
// observes ORCHESTRATION (queue order / disposed guard), not the per-language splice logic (covered elsewhere).
vi.mock("../src/dialog-editor/dialog-webview-html", () => ({ buildDialogWebviewHtml: () => "<html></html>" }));
vi.mock("../src/webview-assets", () => ({ generateNonce: () => "nonce", getCachedJsAsset: () => "asset" }));
vi.mock("../src/dialog-editor/dialog-source-edit", () => ({ computeDialogSourceEdit: computeDialogSourceEditMock }));
// vscode-languageclient/node's runtime require('vscode') would fail under the mock; panel.ts only needs the
// ExecuteCommandRequest value (its `.type` is passed to the mocked client.sendRequest, which ignores it).
vi.mock("vscode-languageclient/node", () => ({ ExecuteCommandRequest: { type: "executeCommand" } }));

import { DialogEditorProvider } from "../src/dialog-editor/panel";

function deferred<T>(): { promise: Promise<T>; resolve: (v: T) => void } {
    let settle!: (v: T) => void;
    const promise = new Promise<T>((r) => {
        settle = r;
    });
    return { promise, resolve: settle };
}

function makePanel() {
    let msgHandler: (m: unknown) => void = () => {};
    let disposeHandler: () => void = () => {};
    const panel = {
        webview: {
            options: {},
            html: "",
            cspSource: "vscode-webview:",
            asWebviewUri: (u: unknown) => u,
            onDidReceiveMessage: (h: (m: unknown) => void) => ((msgHandler = h), { dispose: vi.fn() }),
            postMessage: vi.fn(async () => true),
        },
        onDidDispose: (h: () => void) => ((disposeHandler = h), { dispose: vi.fn() }),
    };
    return { panel, fireMessage: (m: unknown) => msgHandler(m), fireDispose: () => disposeHandler() };
}

const document = {
    uri: { toString: () => "file:///x.d", path: "/x.d" },
    getText: () => "BEGIN ~x~ END",
    positionAt: (n: number) => ({ n }),
} as unknown as vscode.TextDocument;

const context = { extensionUri: {}, subscriptions: [] } as unknown as vscode.ExtensionContext;
const dModel = (): DialogModel => ({ sourceLang: "d", editable: true, roots: [] });
const flush = (): Promise<void> =>
    new Promise((r) => {
        setTimeout(r, 0);
    });

async function mountEditor(sendRequest: ReturnType<typeof vi.fn>) {
    const provider = new DialogEditorProvider(context, { sendRequest } as unknown as LanguageClient);
    const h = makePanel();
    await provider.resolveCustomTextEditor(
        document,
        h.panel as unknown as vscode.WebviewPanel,
        {} as vscode.CancellationToken,
    );
    return h;
}

describe("DialogEditorProvider - session wiring", () => {
    beforeEach(() => {
        applyEditMock.mockClear();
        computeDialogSourceEditMock.mockClear();
        showErrorMessageMock.mockClear();
    });

    it("serializes back-to-back edits: the second edit's parse waits for the first to finish", async () => {
        const first = deferred<unknown>();
        const sendRequest = vi
            .fn()
            .mockReturnValueOnce(first.promise) // edit #1's parse - held in flight
            .mockResolvedValue(OK_PARSE); // edit #2's parse - a valid model, resolves immediately once reached
        const h = await mountEditor(sendRequest);

        h.fireMessage({ type: "edit", model: dModel(), seq: 1 });
        h.fireMessage({ type: "edit", model: dModel(), seq: 2 });
        await flush();
        // Only edit #1 has started its parse; edit #2 is queued behind it.
        expect(sendRequest).toHaveBeenCalledTimes(1);

        first.resolve(null);
        await flush();
        await flush();
        // Edit #1 finished, so the queue released edit #2 and it ran its parse.
        expect(sendRequest).toHaveBeenCalledTimes(2);
    });

    it("does not apply an edit whose parse finished after the panel was disposed", async () => {
        const parse = deferred<unknown>();
        const sendRequest = vi.fn().mockReturnValue(parse.promise);
        const h = await mountEditor(sendRequest);

        h.fireMessage({ type: "edit", model: dModel(), seq: 1 });
        await flush();
        expect(sendRequest).toHaveBeenCalledTimes(1); // parse in flight

        h.fireDispose(); // panel closed mid-flight -> session.disposed = true
        parse.resolve(null);
        await flush();
        await flush();

        // The disposed guard returns before touching the document: computeDialogSourceEdit is never reached,
        // so no WorkspaceEdit is applied to the closed document.
        expect(computeDialogSourceEditMock).not.toHaveBeenCalled();
        expect(applyEditMock).not.toHaveBeenCalled();
    });

    it("reaches the edit computation when NOT disposed (the guard is what blocks it above)", async () => {
        const sendRequest = vi.fn().mockResolvedValue(OK_PARSE);
        const h = await mountEditor(sendRequest);

        h.fireMessage({ type: "edit", model: dModel(), seq: 1 });
        await flush();
        await flush();

        expect(computeDialogSourceEditMock).toHaveBeenCalledTimes(1);
    });

    it("surfaces a parse failure (null model) on an open doc instead of silently discarding the edit", async () => {
        // The server returned null (it threw on parse or translation resolution) for an already-open document -
        // a real failure, not a from-scratch state. The edit must NOT be silently computed/applied: it must
        // surface an error so the change isn't lost without a trace.
        const sendRequest = vi.fn().mockResolvedValue(null);
        const h = await mountEditor(sendRequest);

        h.fireMessage({ type: "edit", model: dModel(), seq: 1 });
        await flush();
        await flush();

        expect(showErrorMessageMock).toHaveBeenCalledTimes(1);
        expect(computeDialogSourceEditMock).not.toHaveBeenCalled(); // not computed against a null original
        expect(applyEditMock).not.toHaveBeenCalled(); // and never applied to the document
    });
});
