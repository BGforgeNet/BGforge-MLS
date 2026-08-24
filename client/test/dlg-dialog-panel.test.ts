/**
 * The DLG editor's host.
 *
 * A `.dlg` is binary, so it cannot ride the dialog editor's existing viewType: that one is a
 * `CustomTextEditorProvider` bound to a `TextDocument`, and one viewType cannot be both text and binary. This
 * provider is the binary half - it reads bytes, maps them with `modelFromDlg`, and posts the SAME `model`
 * message the webview already consumes, so the webview cannot tell which producer fed it.
 *
 * The edit path is the host's own glue - pick a string, rewrite the record, redraw, save - and none of its
 * steps are covered by the writer's or the differ's unit tests, so it is exercised here end to end over an
 * in-memory file.
 */

import { describe, expect, test, vi } from "vitest";
import type * as vscode from "vscode";

const executeCommandMock = vi.hoisted(() => vi.fn());
/** Stands in for the workspace filesystem, so a save can be read back. */
const files = vi.hoisted(() => new Map<string, Uint8Array>());

vi.mock("vscode", () => ({
    Uri: {
        joinPath: (...parts: unknown[]) => ({ path: parts.join("/") }),
        parse: (value: string) => ({ path: value, toString: () => value }),
    },
    // The real emitter's behaviour is what the edit path rides on: an edit fires, and the host's undo closure
    // comes back through the handler. A no-op stub (what the sibling editors' tests use, having no events to
    // exercise) would make every assertion below vacuous.
    EventEmitter: class {
        private readonly handlers: ((value: never) => void)[] = [];
        event = (handler: (value: never) => void) => {
            this.handlers.push(handler);
            return { dispose: () => {} };
        };
        fire(value: never) {
            for (const handler of this.handlers) handler(value);
        }
        dispose() {}
    },
    window: {
        showErrorMessage: vi.fn(),
        showWarningMessage: vi.fn(),
        showInformationMessage: vi.fn(),
    },
    commands: { executeCommand: executeCommandMock },
    workspace: {
        fs: {
            // Rejects on a missing path, as the real one does - the backup fallback depends on it throwing.
            readFile: (uri: { toString: () => string }) => {
                const bytes = files.get(uri.toString());
                return bytes ? Promise.resolve(bytes) : Promise.reject(new Error(`no such file ${uri.toString()}`));
            },
            writeFile: (uri: { toString: () => string }, bytes: Uint8Array) => {
                files.set(uri.toString(), bytes);
                return Promise.resolve();
            },
        },
    },
}));
vi.mock("../src/dialog-editor/webview-host-html", () => ({ buildDialogHostHtml: () => "<html></html>" }));

import { DlgDialogEditorProvider, type DlgDocument } from "../src/dialog-editor/dlg-panel";

/** A DLG with one state saying strref 100, gated by a trigger, whose single reply exits. */
function buildDlgBytes(): Uint8Array {
    const HEADER = 0x34;
    const trigger = "NumTimesTalkedTo(0)";
    const stateTable = HEADER;
    const transitionTable = stateTable + 16;
    const stateTriggerTable = transitionTable + 32;
    const transitionTriggerTable = stateTriggerTable + 8;
    const actionTable = transitionTriggerTable;
    const textAt = actionTable;

    const bytes = new Uint8Array(textAt + trigger.length);
    const view = new DataView(bytes.buffer);
    const ascii = (s: string, at: number): void => {
        for (let i = 0; i < s.length; i++) bytes[at + i] = s.codePointAt(i)!;
    };

    ascii("DLG V1.0", 0);
    view.setUint32(0x08, 1, true);
    view.setUint32(0x0c, stateTable, true);
    view.setUint32(0x10, 1, true);
    view.setUint32(0x14, transitionTable, true);
    view.setUint32(0x18, stateTriggerTable, true);
    view.setUint32(0x1c, 1, true);
    view.setUint32(0x20, transitionTriggerTable, true);
    view.setUint32(0x24, 0, true);
    view.setUint32(0x28, actionTable, true);
    view.setUint32(0x2c, 0, true);

    view.setUint32(stateTable + 0x00, 100, true);
    view.setUint32(stateTable + 0x04, 0, true);
    view.setUint32(stateTable + 0x08, 1, true);
    view.setUint32(stateTable + 0x0c, 0, true);

    view.setUint32(transitionTable + 0x00, 0b1001, true); // text + terminates
    view.setUint32(transitionTable + 0x04, 200, true);

    view.setUint32(stateTriggerTable + 0x00, textAt, true);
    view.setUint32(stateTriggerTable + 0x04, trigger.length, true);
    ascii(trigger, textAt);

    return bytes;
}

interface Posted {
    type: string;
    reparse?: boolean;
    seq?: number;
    model?: { sourceLang: string; editable: boolean; messages?: Record<string, string>; roots: unknown[] };
    message?: string;
}

function harness(
    strref?: (uri: unknown, id: number) => string | undefined,
    pickStrref: () => Promise<number | undefined> = () => Promise.resolve(undefined),
) {
    const posted: Posted[] = [];
    let onMessage: ((raw: unknown) => void) | undefined;
    let onDispose: (() => void) | undefined;
    const panel = {
        webview: {
            options: {},
            html: "",
            postMessage: (msg: Posted) => {
                posted.push(msg);
                return Promise.resolve(true);
            },
            onDidReceiveMessage: (cb: (raw: unknown) => void) => {
                onMessage = cb;
                return { dispose: vi.fn() };
            },
            asWebviewUri: (u: unknown) => u,
            cspSource: "vscode-webview:",
        },
        onDidDispose: (cb: () => void) => {
            onDispose = cb;
            return { dispose: vi.fn() };
        },
    } as unknown as vscode.WebviewPanel;

    const provider = new DlgDialogEditorProvider(
        { extensionUri: { path: "/ext" } } as unknown as vscode.ExtensionContext,
        { strref, pickStrref } as never,
    );
    const document = {
        uri: { path: "/game/SELFDLG.dlg", toString: () => "file:///game/SELFDLG.dlg" },
        bytes: buildDlgBytes(),
    };
    return {
        provider,
        panel,
        document,
        posted,
        ready: () => onMessage?.({ type: "ready" }),
        send: (msg: unknown) => onMessage?.(msg),
        dispose: () => onDispose?.(),
        /** The most recent model posted, which is what the webview would be showing. */
        model: () => posted.toReversed().find((p) => p.type === "model")?.model,
    };
}

const DLG_URI = "file:///game/EDITDLG.dlg";
const DLG_URI_VALUE = { path: "/game/EDITDLG.dlg", toString: () => DLG_URI };

/** The strref state 0 says, straight out of the stored bytes: header dword 3 locates the state table. */
function storedStateText(bytes: Uint8Array): number {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    return view.getInt32(view.getUint32(0x0c, true), true);
}

describe("DlgDialogEditorProvider", () => {
    test("posts a DLG-sourced model the webview reads like any other", async () => {
        const h = harness();

        await h.provider.resolveCustomEditor(h.document as never, h.panel, {} as never);
        h.ready();

        const model = h.posted.find((p) => p.type === "model")?.model;
        expect(model?.sourceLang).toBe("dlg");
        expect(model?.roots).toHaveLength(1);
    });

    test("the model is read-only, because a DLG has no source text to splice", async () => {
        const h = harness();

        await h.provider.resolveCustomEditor(h.document as never, h.panel, {} as never);
        h.ready();

        expect(h.posted.find((p) => p.type === "model")?.model?.editable).toBe(false);
    });

    test("resolves strrefs into messages when a game is open", async () => {
        const h = harness((_uri, id) => (id === 100 ? "Hello, sailor!" : id === 200 ? "Goodbye." : undefined));

        await h.provider.resolveCustomEditor(h.document as never, h.panel, {} as never);
        h.ready();

        // Keyed by the same `@N` id space the renderer resolves for .msg and .tra.
        expect(h.posted.find((p) => p.type === "model")?.model?.messages).toMatchObject({
            "100": "Hello, sailor!",
            "200": "Goodbye.",
        });
    });

    test("without a game the dialog still opens, with the strrefs left unresolved", async () => {
        // Decision: structure is readable without an install; only the spoken text needs one. Refusing to
        // open would hide the triggers, actions and shape that are right there in the file.
        const h = harness(undefined);

        await h.provider.resolveCustomEditor(h.document as never, h.panel, {} as never);
        h.ready();

        const model = h.posted.find((p) => p.type === "model")?.model;
        expect(model).toBeDefined();
        expect(model?.messages ?? {}).toEqual({});
    });

    test("the webview's open-game button runs the command that opens one", async () => {
        // Decision C: with no game the text cannot resolve, so the view offers the action rather than
        // describing it. The webview cannot call a command itself - it asks the host to.
        const h = harness(undefined);

        await h.provider.resolveCustomEditor(h.document as never, h.panel, {} as never);
        h.send({ type: "openGame" });

        expect(executeCommandMock).toHaveBeenCalledWith("bgforge.ieResources.openGame");
    });

    test("reports a file that is not a DLG rather than posting an empty graph", async () => {
        const h = harness();
        const notADlg = { ...h.document, bytes: new Uint8Array(0x40) };

        await h.provider.resolveCustomEditor(notADlg as never, h.panel, {} as never);
        h.ready();

        expect(h.posted.find((p) => p.type === "error")?.message).toMatch(/DLG/i);
    });
});

describe("DlgDialogEditorProvider, changing what a line says", () => {
    /** The pick is awaited inside the message handler, so let it settle before reading the result. */
    const settle = (): Promise<void> =>
        new Promise((resolve) => {
            setTimeout(resolve, 0);
        });

    /**
     * A document open in a panel, over an in-memory file, whose picker answers with `chosen`. Opened through
     * `openCustomDocument` because that is where the provider subscribes to the document's own changes - the
     * subscription the tab's dirty state rides on.
     */
    async function editing(chosen?: number) {
        const h = harness(undefined, () => Promise.resolve(chosen));
        files.set(DLG_URI, buildDlgBytes());
        const edits: vscode.CustomDocumentEditEvent<DlgDocument>[] = [];
        h.provider.onDidChangeCustomDocument((event) => edits.push(event));
        const document = await h.provider.openCustomDocument(DLG_URI_VALUE as never, {} as never);
        await h.provider.resolveCustomEditor(document, h.panel, {} as never);
        h.ready();
        return { h, document, edits };
    }

    test("points the chosen line at the picked string and redraws it", async () => {
        const { h, document } = await editing(300);

        h.send({ type: "pickString", stateIndex: 0 });
        await settle();

        expect(storedStateText(document.bytes)).toBe(300);
        // Redrawn, not merely stored: the webview shows `@N`, in the same id space .msg and .tra resolve.
        expect(JSON.stringify(h.model()?.roots)).toContain("@300");
    });

    test("points a reply at the picked string, addressing it by its position in the state", async () => {
        const { h, document } = await editing(301);

        h.send({ type: "pickString", stateIndex: 0, choiceIndex: 0 });
        await settle();

        // The reply's own strref lives in the transition record, not the state's.
        const view = new DataView(document.bytes.buffer, document.bytes.byteOffset, document.bytes.byteLength);
        expect(view.getInt32(view.getUint32(0x14, true) + 0x04, true)).toBe(301);
        // The state's line is untouched - a reply edit must not spill onto it.
        expect(storedStateText(document.bytes)).toBe(100);
    });

    test("ignores a pick message that names no state, rather than acting on a partial one", async () => {
        const { h, document, edits } = await editing(300);

        h.send({ type: "pickString" });
        await settle();

        expect(edits).toHaveLength(0);
        expect(storedStateText(document.bytes)).toBe(100);
        // Ignored, not reported: the same posture the other editors take toward a message they cannot read.
        expect(h.posted.filter((p) => p.type === "error")).toHaveLength(0);
    });

    test("dismissing the picker changes nothing", async () => {
        const { h, document, edits } = await editing(undefined);

        h.send({ type: "pickString", stateIndex: 0 });
        await settle();

        expect(storedStateText(document.bytes)).toBe(100);
        expect(edits).toHaveLength(0);
    });

    test("announces the edit so the tab goes dirty, and undoes it back to what it said", async () => {
        const { h, document, edits } = await editing(300);

        h.send({ type: "pickString", stateIndex: 0 });
        await settle();

        expect(edits).toHaveLength(1);
        edits[0]!.undo();
        expect(storedStateText(document.bytes)).toBe(100);
        // The view follows the undo rather than showing the edit the document no longer holds.
        expect(JSON.stringify(h.model()?.roots)).toContain("@100");

        edits[0]!.redo();
        expect(storedStateText(document.bytes)).toBe(300);
    });

    test("saving writes what the document now holds", async () => {
        const { h, document } = await editing(300);
        h.send({ type: "pickString", stateIndex: 0 });
        await settle();

        await h.provider.saveCustomDocument(document, {} as never);

        expect(storedStateText(files.get(DLG_URI)!)).toBe(300);
    });

    test("saving as writes to the chosen file and leaves the original alone", async () => {
        const { h, document } = await editing(300);
        h.send({ type: "pickString", stateIndex: 0 });
        await settle();
        const elsewhere = "file:///game/COPY.dlg";

        await h.provider.saveCustomDocumentAs(document, { toString: () => elsewhere } as never, {} as never);

        expect(storedStateText(files.get(elsewhere)!)).toBe(300);
        expect(storedStateText(files.get(DLG_URI)!)).toBe(100);
    });

    test("an unsaved edit survives a hot exit through the backup", async () => {
        const { h, document } = await editing(300);
        h.send({ type: "pickString", stateIndex: 0 });
        await settle();
        const backup = "file:///backups/EDITDLG.dlg";

        const context = { destination: { toString: () => backup } } as never;
        await h.provider.backupCustomDocument(document, context, {} as never);
        // What the host does on the next launch: reopen naming the backup, with the file itself still stale.
        const reopened = await h.provider.openCustomDocument(DLG_URI_VALUE as never, { backupId: backup } as never);

        expect(storedStateText(reopened.bytes)).toBe(300);
    });

    test("falls back to the file when the backup cannot be read, rather than opening nothing", async () => {
        const { h } = await editing();

        const reopened = await h.provider.openCustomDocument(
            DLG_URI_VALUE as never,
            {
                backupId: "file:///backups/GONE.dlg",
            } as never,
        );

        expect(storedStateText(reopened.bytes)).toBe(100);
    });

    test("reverting goes back to the file on disk", async () => {
        const { h, document } = await editing(300);
        h.send({ type: "pickString", stateIndex: 0 });
        await settle();

        await h.provider.revertCustomDocument(document, {} as never);

        expect(storedStateText(document.bytes)).toBe(100);
    });

    // A plain `{type:"model"}` post RESETS the webview's view (see reduceDialogView). After the webview
    // itself posted the edit, that would throw away the user's selection and any inline edit in flight - so
    // the echo has to come back as a re-parse stamped with the emit's own seq, which is what the graph's
    // adopt path expects and what every other family's host already sends.
    test("echoes a webview edit back as a re-parse stamped with the emit's seq", async () => {
        const { h } = await editing();
        const edit = structuredClone(h.model()) as { roots: { states: { text: string }[] }[] };
        edit.roots[0]!.states[0]!.text = "@300";

        h.send({ type: "edit", model: edit, seq: 7 });

        const echo = h.posted.toReversed().find((p) => p.type === "model")!;
        expect(echo.reparse).toBe(true);
        expect(echo.seq).toBe(7);
    });

    test("posts the initial model plainly, so the view builds itself from it", async () => {
        const { h } = await editing();
        // The `ready` handshake is not a re-parse: there is no in-flight edit to preserve.
        expect(h.posted.find((p) => p.type === "model")!.reparse).toBeUndefined();
    });

    test("reports an edit that would drop a state rather than writing a shorter dialog", async () => {
        // Removing a state renumbers every state above it, and those numbers are addresses other dialogs and
        // mod scripts hold. Detaching is the supported way out; this must never be reached silently.
        const { h, document } = await editing();

        h.send({ type: "edit", model: { ...h.model(), roots: [] } });

        expect(h.posted.find((p) => p.type === "error")?.message).toMatch(/missing|detach/i);
        expect(storedStateText(document.bytes)).toBe(100);
    });

    test("a closed panel stops being redrawn, so an undo cannot post into a dead webview", async () => {
        const { h, edits } = await editing(300);
        h.send({ type: "pickString", stateIndex: 0 });
        await settle();

        h.dispose();
        const before = h.posted.length;
        edits[0]!.undo();

        expect(h.posted).toHaveLength(before);
    });
});
