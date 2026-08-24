/**
 * The read-only DLG viewer's host.
 *
 * A `.dlg` is binary, so it cannot ride the dialog editor's existing viewType: that one is a
 * `CustomTextEditorProvider` bound to a `TextDocument`, and one viewType cannot be both text and binary. This
 * provider is the binary half - it reads bytes, maps them with `modelFromDlg`, and posts the SAME `model`
 * message the webview already consumes, so the webview cannot tell which producer fed it.
 */

import { describe, expect, test, vi } from "vitest";
import type * as vscode from "vscode";

const executeCommandMock = vi.hoisted(() => vi.fn());

vi.mock("vscode", () => ({
    Uri: { joinPath: (...parts: unknown[]) => ({ path: parts.join("/") }) },
    window: {
        showErrorMessage: vi.fn(),
        showWarningMessage: vi.fn(),
        showInformationMessage: vi.fn(),
    },
    commands: { executeCommand: executeCommandMock },
}));
vi.mock("../src/dialog-editor/webview-host-html", () => ({ buildDialogHostHtml: () => "<html></html>" }));

import { DlgDialogEditorProvider } from "../src/dialog-editor/dlg-panel";

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
    model?: { sourceLang: string; editable: boolean; messages?: Record<string, string>; roots: unknown[] };
    message?: string;
}

function harness(strref?: (uri: unknown, id: number) => string | undefined) {
    const posted: Posted[] = [];
    let onMessage: ((raw: unknown) => void) | undefined;
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
        onDidDispose: (_cb: () => void) => ({ dispose: vi.fn() }),
    } as unknown as vscode.WebviewPanel;

    const provider = new DlgDialogEditorProvider(
        { extensionUri: { path: "/ext" } } as unknown as vscode.ExtensionContext,
        { strref } as never,
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
    };
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
