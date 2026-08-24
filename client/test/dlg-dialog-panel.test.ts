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
/** Modal prompts raised, what the user answers, and what they are told afterwards. */
const prompts = vi.hoisted(() => [] as string[]);
const told = vi.hoisted(() => [] as string[]);
const answer = vi.hoisted(() => ({ value: undefined as string | undefined }));

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
        showWarningMessage: (message: string, ..._rest: unknown[]) => {
            prompts.push(message);
            return Promise.resolve(answer.value);
        },
        showInformationMessage: (message: string) => {
            told.push(message);
            return Promise.resolve(undefined);
        },
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

import { buildDlg } from "@bgforge/binary";
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

/**
 * Two states: state 0's single reply leads to state 1, which offers nothing. Built with the real writer
 * rather than by hand - detaching needs a reply that actually points somewhere, which the hand-built
 * fixture above (one state, one terminating reply) does not have.
 */
function buildLinkedDlgBytes(): Uint8Array {
    return buildDlg({
        states: [
            { text: 100, firstTransition: 0, transitionCount: 1, triggerIndex: -1 },
            { text: 101, firstTransition: 1, transitionCount: 0, triggerIndex: -1 },
        ],
        transitions: [
            {
                flags: ["text"],
                text: 200,
                journalText: -1,
                triggerIndex: -1,
                actionIndex: -1,
                // Empty resref: a jump inside this same dialog, whatever the file is called.
                nextDialog: "\u0000".repeat(8),
                nextState: 1,
            },
        ],
        stateTriggers: [],
        transitionTriggers: [],
        actions: [],
    });
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
    inbound?: (resref: string, state: number) => unknown[] | undefined,
    /** The game side of loading the dialogs a conversation hands off to, absent unless a test wires it. */
    neighbours: {
        inboundToDialog?: (resref: string) => { dialog: string; state: number; transition: number }[];
        resourceBytes?: (uri: unknown, resref: string, ext: string) => Uint8Array | undefined;
    } = {},
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
        { strref, pickStrref, inbound, ...neighbours } as never,
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

describe("DlgDialogEditorProvider, detaching a state", () => {
    const settle = (): Promise<void> =>
        new Promise((resolve) => {
            setTimeout(resolve, 0);
        });

    /** State 1 of the fixture is reached by state 0's only reply, so detaching it cuts exactly that reply. */
    async function detaching(inbound?: (resref: string, state: number) => unknown[] | undefined) {
        prompts.length = 0;
        told.length = 0;
        answer.value = undefined;
        const h = harness(undefined, () => Promise.resolve(undefined), inbound);
        files.set(DLG_URI, buildLinkedDlgBytes());
        const edits: unknown[] = [];
        h.provider.onDidChangeCustomDocument((event) => edits.push(event));
        const document = await h.provider.openCustomDocument(DLG_URI_VALUE as never, {} as never);
        await h.provider.resolveCustomEditor(document, h.panel, {} as never);
        h.ready();
        return { h, document, edits };
    }

    /** The reply's target strref field doubles as the tell: a cut reply gets the terminate flag. */
    function firstReplyTerminates(bytes: Uint8Array): boolean {
        const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
        return (view.getUint32(view.getUint32(0x14, true), true) & 0x008) !== 0;
    }

    test("asks before changing anything, naming what will be cut and what still reaches the state", async () => {
        const { h, document } = await detaching(() => [{ dialog: "OTHER", state: 2, transition: 0 }]);

        h.send({ type: "detach", stateIndex: 1 });
        await settle();

        expect(prompts).toHaveLength(1);
        expect(prompts[0]).toMatch(/state 1/i);
        expect(prompts[0]).toMatch(/OTHER/);
        expect(prompts[0]).toMatch(/remains in the file/i);
        // Nothing applied while the question is unanswered.
        expect(firstReplyTerminates(document.bytes)).toBe(false);
    });

    test("changes nothing when the user declines", async () => {
        const { h, document, edits } = await detaching(() => []);
        answer.value = undefined;

        h.send({ type: "detach", stateIndex: 1 });
        await settle();

        expect(edits).toHaveLength(0);
        expect(firstReplyTerminates(document.bytes)).toBe(false);
    });

    test("cuts the replies that led there once confirmed, and says which changed", async () => {
        const { h, document, edits } = await detaching(() => []);
        answer.value = "Detach";

        h.send({ type: "detach", stateIndex: 1 });
        await settle();

        expect(firstReplyTerminates(document.bytes)).toBe(true);
        expect(edits).toHaveLength(1);
        expect(told.join(" ")).toMatch(/state 0, reply 1/i);
    });

    test("says the other dialogs were not checked when no index has answered", async () => {
        // Distinguishing this from "nothing points here" is the whole reason the index reports readiness.
        const { h } = await detaching(() => undefined);

        h.send({ type: "detach", stateIndex: 1 });
        await settle();

        expect(prompts[0]).toMatch(/not been checked/i);
        expect(prompts[0]).not.toMatch(/no other dialog/i);
    });
});

describe("DlgDialogEditorProvider, the dialogs around this one", () => {
    /** EDITDLG state 0's only reply hands off to OTHERDLG state 1 - the edge the tree should close up. */
    function handoff(): Uint8Array {
        return buildDlg({
            states: [{ text: 100, firstTransition: 0, transitionCount: 1, triggerIndex: -1 }],
            transitions: [
                {
                    flags: ["text"],
                    text: 200,
                    journalText: -1,
                    triggerIndex: -1,
                    actionIndex: -1,
                    nextDialog: "OTHERDLG",
                    nextState: 1,
                },
            ],
            stateTriggers: [],
            transitionTriggers: [],
            actions: [],
        });
    }

    /** A dialog with two states and no jumps of its own, standing in for whatever a neighbour holds. */
    function plain(): Uint8Array {
        return buildDlg({
            states: [
                { text: 300, firstTransition: 0, transitionCount: 0, triggerIndex: -1 },
                { text: 301, firstTransition: 0, transitionCount: 0, triggerIndex: -1 },
            ],
            transitions: [],
            stateTriggers: [],
            transitionTriggers: [],
            actions: [],
        });
    }

    async function opened(neighbours: Parameters<typeof harness>[3], bytes = handoff()) {
        const h = harness(undefined, () => Promise.resolve(undefined), undefined, neighbours);
        files.set(DLG_URI, bytes);
        const document = await h.provider.openCustomDocument(DLG_URI_VALUE as never, {} as never);
        await h.provider.resolveCustomEditor(document, h.panel, {} as never);
        h.ready();
        return h;
    }

    test("loads the dialog this one hands off to, so the jump lands on a node", async () => {
        const h = await opened({ resourceBytes: (_uri, resref) => (resref === "OTHERDLG" ? plain() : undefined) });

        const model = h.model() as { roots: { label: string; external?: boolean; states: { id: string }[] }[] };
        expect(model.roots.map((r) => r.label)).toEqual(["EDITDLG", "OTHERDLG"]);
        expect(model.roots[1]!.external).toBe(true);
        // Only the state the reply lands on, not the whole neighbouring file.
        expect(model.roots[1]!.states.map((s) => s.id)).toEqual(["OTHERDLG:1"]);
    });

    test("loads the dialogs that jump into this one, which the file itself cannot name", async () => {
        const h = await opened({
            inboundToDialog: () => [{ dialog: "CALLER", state: 1, transition: 0 }],
            resourceBytes: (_uri, resref) => (resref === "CALLER" ? plain() : undefined),
        });

        const model = h.model() as { roots: { label: string }[] };
        expect(model.roots.map((r) => r.label)).toContain("CALLER");
    });

    test("opens on its own when no game is behind the file", async () => {
        const h = await opened({});

        expect((h.model() as { roots: unknown[] }).roots).toHaveLength(1);
    });

    test("skips a neighbour the game cannot produce rather than failing to open", async () => {
        const h = await opened({ resourceBytes: () => undefined });

        expect((h.model() as { roots: unknown[] }).roots).toHaveLength(1);
        expect(h.posted.some((p) => p.type === "error")).toBe(false);
    });

    test("skips a neighbour whose bytes will not parse", async () => {
        const h = await opened({ resourceBytes: () => new Uint8Array([1, 2, 3]) });

        expect((h.model() as { roots: unknown[] }).roots).toHaveLength(1);
        expect(h.posted.some((p) => p.type === "error")).toBe(false);
    });
});

describe("DlgDialogEditorProvider, what it refuses", () => {
    const settle = (): Promise<void> =>
        new Promise((resolve) => {
            setTimeout(resolve, 0);
        });

    test("says so when the file cannot be read at all, instead of showing an empty dialog", async () => {
        const h = harness();
        files.set(DLG_URI, new Uint8Array([1, 2, 3, 4]));
        const document = await h.provider.openCustomDocument(DLG_URI_VALUE as never, {} as never);

        await h.provider.resolveCustomEditor(document, h.panel, {} as never);
        h.ready();

        expect(h.posted.find((p) => p.type === "error")?.message).toMatch(/could not read/i);
        expect(h.posted.some((p) => p.type === "model")).toBe(false);
    });

    test("reports a detach of a state that is not there rather than dropping it", async () => {
        prompts.length = 0;
        const h = harness();
        files.set(DLG_URI, buildLinkedDlgBytes());
        const document = await h.provider.openCustomDocument(DLG_URI_VALUE as never, {} as never);
        await h.provider.resolveCustomEditor(document, h.panel, {} as never);
        h.ready();

        h.send({ type: "detach", stateIndex: 9 });
        await settle();

        expect(h.posted.find((p) => p.type === "error")?.message).toMatch(/no state 9/i);
        // Nothing was asked, because there was nothing to ask about.
        expect(prompts).toHaveLength(0);
    });

    test("ignores a detach and a string pick before any model has been posted", async () => {
        const h = harness();
        files.set(DLG_URI, buildLinkedDlgBytes());
        const document = await h.provider.openCustomDocument(DLG_URI_VALUE as never, {} as never);
        await h.provider.resolveCustomEditor(document, h.panel, {} as never);

        h.send({ type: "detach", stateIndex: 0 });
        h.send({ type: "pickString", stateIndex: 0 });
        await settle();

        expect(h.posted).toHaveLength(0);
    });
});
