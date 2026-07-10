/**
 * Host-side session core of the dialog editor, split out of panel.ts so it is host-agnostic: everything
 * between the webview protocol and the editor runtime (parse -> model enrichment -> edit splice -> reparse
 * post -> debounced message flush) lives here, parameterized by a small IO surface. panel.ts adapts it to
 * the real VS Code runtime (WorkspaceEdit, toasts, LSP requests); the round-trip harness driver
 * (test/harness/edit-roundtrip.mts) adapts it to an in-memory document so the webview<->host protocol runs
 * under automated tests - the same core both ways, so the harness cannot drift from production behavior.
 */

import { modelFromD, modelFromSSL, type DialogMessages, type DialogModel } from "../../../shared/dialog-model";
import type { DDialogData, SSLDialogData } from "../../../shared/dialog-types";
import { computeDialogSourceEdit } from "./dialog-source-edit";
import { EchoGuard } from "./edit-origin";
import { SerialQueue } from "./serial-queue";

/** The message of a caught unknown - `Error.message`, else its string form. */
export function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

/** Discriminate the parse payload by shape (D has `blocks`, SSL has `nodes`). */
function toModel(data: unknown): DialogModel | null {
    if (data && typeof data === "object") {
        if ("blocks" in data) return modelFromD(data as DDialogData);
        if ("nodes" in data) return modelFromSSL(data as SSLDialogData);
    }
    return null;
}

/** What the core needs from its host runtime. panel.ts binds these to vscode + the LSP client. */
export interface DialogHostIO {
    /** Full current text of the bound document. */
    getText(): string;
    /** The dialog parse request (LSP in production): the raw command payload, or the request failure. */
    requestParse(): Promise<{ data: unknown } | { error: string }>;
    /**
     * Replace the whole document text (one WorkspaceEdit == one native undo step in production).
     * Resolves false when the editor rejected the edit; may throw on a host-level error.
     */
    replaceText(newText: string): Promise<boolean>;
    /** Post a message to the webview. */
    postToWebview(msg: unknown): void;
    /** Surface a user-facing error notification. */
    showError(message: string): void;
    /** Persist edited `@N`/message text to the resolved .tra/.msg. */
    saveMessages(messages: DialogMessages): Promise<void>;
}

export class DialogHostCore {
    private readonly io: DialogHostIO;
    /** The document's path (from its URI): drives the td/tssl refinement and the sourceName label. */
    private readonly documentPath: string;
    private readonly guard = new EchoGuard();
    /** Serializes webview edits: two edits fired back-to-back would otherwise run applyEdit concurrently
     *  and their whole-document replacements race each other (VS Code rejects the second). */
    private readonly edits = new SerialQueue();
    /** Latest model (edited or parsed) whose messages the debounced .tra flush persists. */
    private latest: DialogModel | undefined;
    private traTimer: ReturnType<typeof setTimeout> | undefined;
    /** Set once the panel is disposed. A queued/in-flight edit captured this core before the host dropped
     *  it, so it re-checks this flag after each await rather than acting on a dead panel. */
    private disposed = false;

    constructor(io: DialogHostIO, documentPath: string) {
        this.io = io;
        this.documentPath = documentPath;
    }

    /** The webview finished booting and asked for the model. */
    handleReady(): void {
        void this.postModel();
    }

    /** One webview action = one whole-model edit message; serialized through the queue. */
    handleEdit(model: DialogModel, seq: number): void {
        this.edits.enqueue(
            () => this.applyEdit(model, seq),
            (error) => {
                this.io.showError(`Dialog edit failed: ${errorMessage(error)}`);
            },
        );
    }

    /**
     * The bound document changed (vscode's onDidChangeTextDocument). A metadata-only notification
     * (dirty-flag flip, etc.) carries no content changes and is never a text edit to re-project for. Skip it
     * BEFORE the guard: a single applyEdit fires TWO change events - the real one (>=1 content change) plus
     * an empty follow-up - and consulting the guard on the empty one consumes a phantom "external edit" it
     * never marked, firing a spurious re-project that closes the inspector mid-add and surfaces the raw `@N`
     * before its .msg text has landed. Self-originated (our own replaceText) -> the guard consumes it here;
     * applyEdit already posts the authoritative re-parse, so a second re-project would be a redundant
     * duplicate. An external text edit (someone typing in a "Reopen with Text" split) re-projects the graph
     * so the tree stays a faithful view of source.
     */
    handleDocumentChanged(contentChangeCount: number): void {
        if (contentChangeCount === 0) return;
        if (this.guard.shouldReproject()) void this.postModel();
    }

    /** Native save: flush any pending message text immediately (the debounce may not have fired yet). */
    handleDocumentSaved(): void {
        void this.flushMessages();
    }

    dispose(): void {
        this.disposed = true;
        if (this.traTimer) clearTimeout(this.traTimer);
    }

    /** Resolves once every edit enqueued so far has settled (for tests and teardown). */
    async drainEdits(): Promise<void> {
        await this.edits.drain();
    }

    /**
     * Parse the bound document and post the model (or an error) to the webview. Two callers:
     *  - the initial load and an external text-side edit (no `reparse` opts) -> a plain `{type:"model"}` the
     *    webview adopts as the authoritative view (App.svelte's reduceDialogView -> the model prop);
     *  - `applyEdit`, right after it splices a self-edit (`reparse` opts set) -> the SAME faithful parse, but
     *    tagged `reparse:true` and carrying the `seq` of the edit that produced it plus the pending items'
     *    allocated `@N` ids and their not-yet-flushed .msg text. The webview keys off those to remap a
     *    just-added option's selection (its id changes across the parse) and to render freshly-typed text
     *    before the debounced .tra flush lands. App.svelte ignores a `reparse:true` post; DialogGraph's own
     *    listener handles it so it can preserve selection / an in-progress inline edit instead of resetting.
     */
    private async postModel(reparse?: {
        seq: number;
        allocations: Record<string, string>;
        messages: DialogMessages;
    }): Promise<void> {
        const parsed = await this.io.requestParse();
        if ("error" in parsed) {
            this.io.postToWebview({ type: "error", message: `Dialog parse request failed: ${parsed.error}` });
            return;
        }
        const model = toModel(parsed.data);
        // Disposed while the parse was in flight: don't post to a dead webview.
        if (this.disposed) return;
        this.latest = model ?? undefined;
        if (model) {
            // Refine the render-family sourceLang the adapter set (d/ssl) to the actual transpiler source
            // language for a .td/.tssl document. `editable` is the D-family BLANKET-editable flag; TD/TSSL are
            // deliberately NOT blanket-editable - their field/structural edits are gated per node by the
            // faithfulness tier and sourceLang (see model-to-flow `fieldEditable` / DialogGraph `structEditable`)
            // and written back to the TS source by the td/tssl writers. So keep `editable=false` and let the
            // tier gating drive editing; renderFamily keeps rendering it as D/SSL.
            const lowerPath = this.documentPath.toLowerCase();
            if (lowerPath.endsWith(".td")) {
                model.sourceLang = "td";
                model.editable = false;
            } else if (lowerPath.endsWith(".tssl")) {
                model.sourceLang = "tssl";
                model.editable = false;
            }
            // The adapter does not know the file name; supply it here (from the document path) so the webview
            // can label states by speaker - the base name is the NPC for SSL and a fallback speaker for D.
            model.sourceName =
                this.documentPath
                    .split("/")
                    .pop()
                    ?.replace(/\.[^.]+$/, "") || undefined;
            this.io.postToWebview(
                reparse
                    ? {
                          type: "model",
                          reparse: true,
                          model,
                          seq: reparse.seq,
                          allocations: reparse.allocations,
                          messages: reparse.messages,
                      }
                    : { type: "model", model },
            );
        } else {
            this.io.postToWebview({
                type: "error",
                message:
                    parsed.data == null
                        ? "The language server returned no dialog data for this file. Make sure it is a recognized, open dialog file."
                        : "The parsed dialog data could not be interpreted.",
            });
        }
    }

    /**
     * Apply one webview action to the LIVE document as a single whole-text replacement (one edit == one
     * native undo step in production). Message text is a side-write: it is not stored in the source for
     * D/SSL, so a text-only action produces no source edit - it is persisted to .tra on a short debounce
     * (write-through) and again on native save. Accepted non-atomicity (per the design spec): a structural
     * edit dirties the source (not yet on disk) while its companion text write-through has already landed in
     * .tra; a discard-on-close can leave an orphan .tra entry. This is the lower-risk text class the spec
     * accepts giving up native undo on.
     */
    private async applyEdit(edited: DialogModel, seq: number): Promise<void> {
        if (this.disposed) return;
        if (
            edited.sourceLang === "d" ||
            edited.sourceLang === "ssl" ||
            edited.sourceLang === "tssl" ||
            edited.sourceLang === "td"
        ) {
            const text = this.io.getText();
            const parsed = await this.io.requestParse();
            if ("error" in parsed) {
                this.io.showError(`Dialog edit failed: ${parsed.error}`);
                return;
            }
            // The panel may have been disposed while the parse request was in flight - re-check before
            // touching the document or the webview.
            if (this.disposed) return;
            const original = toModel(parsed.data);
            // A parse that yields NO model for an already-open document is a real failure (the server threw on
            // parse or translation resolution and returned null), NOT a from-scratch state - a valid open doc
            // always parses to at least an empty model. Proceeding would no-op the ssl/tssl/td writer against a
            // null original and silently discard the edit, so surface it and stop. The webview keeps its
            // optimistic model; the next successful edit re-syncs against live text.
            if (original === null) {
                this.io.showError(
                    "Dialog edit not saved: the document could not be parsed. Fix the source and try again.",
                );
                return;
            }
            const { newText, messages, allocations } = computeDialogSourceEdit(text, edited, original);
            edited.messages = messages;
            if (newText !== null) {
                this.guard.markSelfEdit();
                // A REJECTED replaceText (host error, not a `false` return) must still unmark the self-edit
                // token, or the echo guard swallows the NEXT genuine external edit as if it were our own.
                // Unmark on throw, then let the SerialQueue's onError surface the failure toast.
                let applied: boolean;
                try {
                    applied = await this.io.replaceText(newText);
                } catch (error) {
                    this.guard.unmarkSelfEdit();
                    throw error;
                }
                if (!applied) {
                    this.guard.unmarkSelfEdit();
                    this.io.showError("Dialog edit could not be applied to the document.");
                    // The webview model is now ahead of the (unchanged) document; the next successful edit
                    // re-splices the full model against the live text, so the divergence self-heals. The
                    // toast above makes the failed edit visible in the meantime.
                    return;
                }
                // Post the faithful re-parse of the just-spliced document so the webview adopts it (real source
                // spans -> F4 resolves; the tree stays a pure view of source). The `seq` lets the webview drop a
                // stale re-parse that a newer optimistic edit has already superseded; `allocations`/`messages`
                // let it remap a just-added option's selection (its id changes across the parse) and render the
                // freshly-typed text before the debounced .tra flush. An open inline edit survives the adopt
                // via the webview's draft overlay (see DialogGraph's adoptModel).
                await this.postModel({ seq, allocations, messages });
            }
        }
        // Record the EDITED model (with the user's just-typed messages) as the session's latest, deliberately
        // OVERRIDING the source-accurate reparse postModel stored above: the .tra flush below is debounced, so the
        // reparse's messages still hold the OLD on-disk .tra text while `edited.messages` holds what the user
        // typed. flushMessages reads latest.messages, so this must be the edited model or the flush writes
        // stale text. (Not a redundant write - the reparse and the edited model diverge until the flush lands.)
        this.latest = edited;
        this.scheduleFlush();
    }

    /** Debounced .tra write-through so rapid message edits collapse to one flush. */
    private scheduleFlush(): void {
        if (this.traTimer) clearTimeout(this.traTimer);
        this.traTimer = setTimeout(() => void this.flushMessages(), 400);
    }

    /** Persist message text to the resolved .tra/.msg via the host. A failure surfaces (fail loud). */
    private async flushMessages(): Promise<void> {
        if (this.traTimer) {
            clearTimeout(this.traTimer);
            this.traTimer = undefined;
        }
        const messages = this.latest?.messages;
        if (!messages || Object.keys(messages).length === 0) return;
        try {
            await this.io.saveMessages(messages);
        } catch (error) {
            this.io.showError(`Saving dialog message text failed: ${errorMessage(error)}`);
        }
    }
}
