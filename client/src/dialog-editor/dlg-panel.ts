/**
 * Editor for compiled Infinity Engine dialogs (`.dlg`).
 *
 * Why this is a second provider rather than another selector on `bgforge.dialogEditor`: that viewType is a
 * `CustomTextEditorProvider` bound to a `TextDocument`, and a `.dlg` is binary. One viewType cannot be both.
 * Everything downstream is shared - the same webview, the same `model` message - so the webview cannot tell
 * which producer fed it.
 *
 * What can be edited is shaped by the format: a DLG holds a NUMBER pointing into the game's string table
 * rather than text, so a line is changed by pointing it at a different entry. Replies can be added, removed
 * and retargeted, and states appended. What a state's NUMBER means is not ours to change - it is the address
 * other dialogs and mod scripts hold - so states are never renamed or removed; see `dialog-editability.ts`.
 */

import * as vscode from "vscode";
import { readDlg } from "@bgforge/binary";
import { modelFromDlg } from "../../../shared/dialog-model-dlg";
import { detachDlgState, setDlgLineText } from "../../../shared/dialog-dlg-edit";
import { detachConfirmMessage, detachResultMessage } from "./dlg-detach";
import type { InboundRef } from "./dlg-references";
import type { DialogMessages, DialogModel } from "../../../shared/dialog-model";
import { backupHandle, warnBackupUnreadable } from "../hot-exit-backup";
import type { StrrefResolver } from "../ie-resources/game-lookups";
import { writeDlgFromModel } from "./dlg-write";
import { buildDialogHostHtml } from "./webview-host-html";

/**
 * The game lookups the editor needs. `strref` is `registerIeResources`'s own resolver, taken in its existing
 * shape (uri first) rather than re-wrapped: the uri is how it finds which game the document came from.
 * `pickStrref` opens the string picker, which is the only way to change what a line says; it is required, so
 * a host that forgets to wire it fails to compile rather than at the click.
 */
export interface DlgHostDeps {
    strref?: StrrefResolver;
    pickStrref: (uri: vscode.Uri, title: string) => Promise<number | undefined>;
    /**
     * Which replies elsewhere lead into a state. `undefined` means the game-wide scan has not answered -
     * which is NOT the same as finding none, and must never be presented as if it were.
     */
    inbound?: (resref: string, stateIndex: number) => InboundRef[] | undefined;
}

/** Bytes to open: the hot-exit backup when one is readable, otherwise the file itself. */
async function readDocumentBytes(uri: vscode.Uri, backupId?: string): Promise<Uint8Array> {
    if (backupId === undefined) return vscode.workspace.fs.readFile(uri);
    try {
        return await vscode.workspace.fs.readFile(vscode.Uri.parse(backupId));
    } catch {
        warnBackupUnreadable(uri);
        return vscode.workspace.fs.readFile(uri);
    }
}

/** One open `.dlg`, holding its current bytes and the undo history of the edits made to them. */
export class DlgDocument implements vscode.CustomDocument {
    readonly uri: vscode.Uri;
    private current: Uint8Array;

    private readonly _onDidChange = new vscode.EventEmitter<vscode.CustomDocumentEditEvent<DlgDocument>>();
    readonly onDidChange = this._onDidChange.event;

    /**
     * Re-posts the model to the open panel, so an undo or revert redraws it. Set by the provider once the
     * webview exists. One slot rather than a set because the provider registers with
     * `supportsMultipleEditorsPerDocument: false` - a document has at most one panel.
     */
    refresh: (() => void) | undefined;

    private constructor(uri: vscode.Uri, bytes: Uint8Array) {
        this.uri = uri;
        this.current = bytes;
    }

    static async open(uri: vscode.Uri, backupId?: string): Promise<DlgDocument> {
        return new DlgDocument(uri, await readDocumentBytes(uri, backupId));
    }

    get bytes(): Uint8Array {
        return this.current;
    }

    /**
     * Rewrite the file to match `model`, making the document dirty and undoable. Every change this editor
     * makes comes through here, so there is one writer and one place the undo history is recorded.
     */
    applyModel(model: DialogModel, label: string): void {
        const before = this.current;
        const after = writeDlgFromModel(before, model, resrefOf(this.uri));
        // A change that writes the same bytes is not a change; without this an edit that cancels itself out,
        // or a model posted with nothing altered, would still dirty the tab and stack an empty undo step.
        if (after.length === before.length && after.every((byte, i) => byte === before[i])) return;
        this.current = after;
        this._onDidChange.fire({
            document: this,
            label,
            undo: () => {
                this.current = before;
                this.refresh?.();
            },
            redo: () => {
                this.current = after;
                this.refresh?.();
            },
        });
    }

    /** Re-read the file from disk, discarding unsaved edits. */
    async revert(): Promise<void> {
        this.current = await vscode.workspace.fs.readFile(this.uri);
        this.refresh?.();
    }

    dispose(): void {
        this._onDidChange.dispose();
    }
}

/**
 * Collect every strref the model references and resolve what the game can name, keyed by the `@N` id space
 * the renderer already uses for `.msg` and `.tra`. An unresolvable id is simply absent, so the view falls
 * back to showing the bare ref rather than inventing text for it.
 */
function resolveMessages(strrefs: Iterable<number>, uri: vscode.Uri, resolve: DlgHostDeps["strref"]): DialogMessages {
    const messages: DialogMessages = {};
    if (!resolve) return messages;
    for (const id of strrefs) {
        const text = resolve(uri, id);
        if (text !== undefined) messages[String(id)] = text;
    }
    return messages;
}

/** The dialog's own resource name: a DLG does not record it, and a same-file jump is addressed by it. */
function resrefOf(uri: vscode.Uri): string {
    return (uri.path.split("/").pop() ?? "").replace(/\.[^.]+$/, "");
}

export class DlgDialogEditorProvider implements vscode.CustomEditorProvider<DlgDocument> {
    private readonly context: vscode.ExtensionContext;
    private readonly deps: DlgHostDeps;
    /** The model last posted per document, which an incoming edit is diffed against. */
    private readonly posted = new WeakMap<DlgDocument, DialogModel>();

    private readonly _onDidChangeCustomDocument = new vscode.EventEmitter<
        vscode.CustomDocumentEditEvent<DlgDocument>
    >();
    readonly onDidChangeCustomDocument = this._onDidChangeCustomDocument.event;

    constructor(context: vscode.ExtensionContext, deps: DlgHostDeps) {
        this.context = context;
        this.deps = deps;
    }

    async openCustomDocument(uri: vscode.Uri, openContext: vscode.CustomDocumentOpenContext): Promise<DlgDocument> {
        const document = await DlgDocument.open(uri, openContext.backupId);
        document.onDidChange((event) => this._onDidChangeCustomDocument.fire(event));
        return document;
    }

    async resolveCustomEditor(
        document: DlgDocument,
        panel: vscode.WebviewPanel,
        _token: vscode.CancellationToken,
    ): Promise<void> {
        panel.webview.options = {
            enableScripts: true,
            localResourceRoots: [vscode.Uri.joinPath(this.context.extensionUri, "client", "out")],
        };
        panel.webview.html = buildDialogHostHtml(panel.webview, this.context.extensionUri);

        const post = (msg: unknown): void => void panel.webview.postMessage(msg);
        const refresh = (): void => this.postModel(document, post);
        document.refresh = refresh;

        panel.webview.onDidReceiveMessage((raw: unknown) => {
            // Same reject-and-ignore posture as the other editors: an unrecognized message changes nothing.
            if (typeof raw !== "object" || raw === null || !("type" in raw)) return;
            const message = raw as {
                type: unknown;
                model?: unknown;
                seq?: unknown;
                stateIndex?: unknown;
                choiceIndex?: unknown;
            };
            switch (message.type) {
                case "ready":
                    this.postModel(document, post);
                    break;
                // The webview offers "Open game" when strrefs could not resolve. It cannot run a command
                // itself, so it asks the host; the tree view owns the picker and the session.
                case "openGame":
                    void vscode.commands.executeCommand("bgforge.ieResources.openGame");
                    break;
                case "pickString":
                    void this.changeString(document, post, message.stateIndex, message.choiceIndex);
                    break;
                case "detach":
                    void this.detachState(document, post, message.stateIndex);
                    break;
                case "edit":
                    this.applyModelEdit(document, post, message.model, message.seq);
                    break;
                default:
                    break;
            }
        });

        // Retract only our own callback: a replacement panel for the same document (moving the tab to another
        // group closes one and opens another) may already have registered its own by the time this fires.
        panel.onDidDispose(() => {
            if (document.refresh === refresh) document.refresh = undefined;
        });
    }

    /** Ask for a string and point the addressed line at it. */
    private async changeString(
        document: DlgDocument,
        post: (msg: unknown) => void,
        stateIndex: unknown,
        choiceIndex: unknown,
    ): Promise<void> {
        const shown = this.posted.get(document);
        if (typeof stateIndex !== "number" || !shown) return;
        const what = typeof choiceIndex === "number" ? "reply" : "line";
        const strref = await this.deps.pickStrref(document.uri, `Choose the string for this ${what}`);
        if (strref === undefined) return;
        const address = typeof choiceIndex === "number" ? { stateIndex, choiceIndex } : { stateIndex };
        try {
            const edited = setDlgLineText(shown, resrefOf(document.uri), address, strref);
            document.applyModel(edited, `Change ${what} string`);
        } catch (error) {
            post({ type: "error", message: String(error) });
            return;
        }
        this.postModel(document, post);
    }

    /**
     * Detach a state, after telling the user exactly what it will do. The state is never removed - its
     * number is an address other dialogs and mod scripts hold - so the confirm has to be honest that a jump
     * from another file will still arrive.
     */
    private async detachState(document: DlgDocument, post: (msg: unknown) => void, stateIndex: unknown): Promise<void> {
        const shown = this.posted.get(document);
        if (typeof stateIndex !== "number" || !shown) return;
        const resref = resrefOf(document.uri);

        let preview;
        try {
            preview = detachDlgState(shown, resref, stateIndex);
        } catch (error) {
            post({ type: "error", message: String(error) });
            return;
        }
        // Only references from OTHER files are the user's problem here: the ones in this dialog are what the
        // detach is about to cut, and are listed separately.
        const external = this.deps.inbound?.(resref, stateIndex)?.filter((ref) => ref.dialog !== resref.toUpperCase());

        const choice = await vscode.window.showWarningMessage(
            detachConfirmMessage({ resref, stateIndex, local: preview.cut, external }),
            { modal: true },
            "Detach",
        );
        if (choice !== "Detach") return;

        document.applyModel(preview.model, `Detach state ${stateIndex}`);
        this.postModel(document, post);
        void vscode.window.showInformationMessage(detachResultMessage(stateIndex, preview.cut));
    }

    /**
     * Apply an edited model posted by the webview. Anything the writer refuses is reported rather than
     * dropped: a silently ignored edit reads to the user as one that was saved.
     */
    private applyModelEdit(document: DlgDocument, post: (msg: unknown) => void, incoming: unknown, seq: unknown): void {
        if (typeof incoming !== "object" || incoming === null) return;
        try {
            document.applyModel(incoming as DialogModel, "Edit dialog");
            // Echoed as a re-parse, not a plain model: the webview posted this edit, so it has a selection
            // and possibly an open inline edit to keep. A plain post would reset its whole view. The seq
            // comes back untouched - the graph drops an echo that is not for its latest emit.
            this.postModel(document, post, { reparse: true, seq });
        } catch (error) {
            post({ type: "error", message: String(error) });
        }
    }

    private postModel(
        document: DlgDocument,
        post: (msg: unknown) => void,
        echo?: { reparse: true; seq: unknown },
    ): void {
        let dlg;
        try {
            dlg = readDlg(document.bytes);
        } catch (error) {
            post({ type: "error", message: `Could not read this DLG: ${String(error)}` });
            return;
        }
        if (dlg.signature !== "DLG " || dlg.version !== "V1.0") {
            post({
                type: "error",
                message: `Not a DLG v1.0 file: signature ${JSON.stringify(dlg.signature + dlg.version)}`,
            });
            return;
        }

        const resref = resrefOf(document.uri);
        const model = modelFromDlg({ ...dlg, resref });

        const strrefs = new Set<number>();
        for (const state of dlg.states) strrefs.add(state.text);
        for (const transition of dlg.transitions) {
            if (transition.hasText) strrefs.add(transition.text);
            if (transition.hasJournalEntry) strrefs.add(transition.journalText);
        }
        const messages = resolveMessages(strrefs, document.uri, this.deps.strref);

        this.posted.set(document, model);
        post({ type: "model", model: { ...model, messages, sourceName: resref }, ...echo });
    }

    async saveCustomDocument(document: DlgDocument, _token: vscode.CancellationToken): Promise<void> {
        await vscode.workspace.fs.writeFile(document.uri, document.bytes);
    }

    async saveCustomDocumentAs(
        document: DlgDocument,
        destination: vscode.Uri,
        _token: vscode.CancellationToken,
    ): Promise<void> {
        await vscode.workspace.fs.writeFile(destination, document.bytes);
    }

    async revertCustomDocument(document: DlgDocument, _token: vscode.CancellationToken): Promise<void> {
        await document.revert();
    }

    async backupCustomDocument(
        document: DlgDocument,
        context: vscode.CustomDocumentBackupContext,
        _token: vscode.CancellationToken,
    ): Promise<vscode.CustomDocumentBackup> {
        await vscode.workspace.fs.writeFile(context.destination, document.bytes);
        return backupHandle(context.destination);
    }
}

export function registerDlgDialogEditor(context: vscode.ExtensionContext, deps: DlgHostDeps): vscode.Disposable {
    return vscode.window.registerCustomEditorProvider("bgforge.dlgViewer", new DlgDialogEditorProvider(context, deps), {
        webviewOptions: { retainContextWhenHidden: true },
        supportsMultipleEditorsPerDocument: false,
    });
}
