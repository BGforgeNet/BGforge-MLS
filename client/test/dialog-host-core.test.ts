/**
 * Unit tests for DialogHostCore - the host-agnostic session logic panel.ts binds to the VS Code runtime
 * and the round-trip harness binds to an in-memory document. The vscode-free IO seam is the point of the
 * extraction: every branch (parse failures, splice vs no-op, echo-guard bookkeeping, rejected edits, the
 * debounced message flush, dispose-mid-flight) is exercised here with a stub IO, while the composition
 * with a real webview runs in the e2e-tier edit-roundtrip driver and the vscode wiring in
 * dialog-panel.test.ts.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { DialogHostCore, errorMessage, type DialogHostIO } from "../src/dialog-editor/host-core";
import type { DialogMessages, DialogModel } from "../../shared/dialog-model";

/** An empty-but-valid D parse payload: toModel keys off `blocks`, yielding an empty (non-null) model. */
const EMPTY_D = { blocks: [], states: [] };

function makeIO(overrides: Partial<DialogHostIO> = {}) {
    const posted: Array<Record<string, unknown>> = [];
    const errors: string[] = [];
    const saved: DialogMessages[] = [];
    const replaced: string[] = [];
    const io: DialogHostIO = {
        getText: () => "",
        requestParse: async () => ({ data: EMPTY_D }),
        replaceText: async (t) => {
            replaced.push(t);
            return true;
        },
        postToWebview: (m) => posted.push(m as Record<string, unknown>),
        showError: (m) => errors.push(m),
        saveMessages: async (m) => {
            saved.push(m);
        },
        ...overrides,
    };
    return { io, posted, errors, saved, replaced };
}

const flush = (): Promise<void> =>
    new Promise((r) => {
        setTimeout(r, 0);
    });

/** An edited webview model carrying one brand-new state: splices non-trivially against an empty original. */
function newStateModel(): DialogModel {
    return {
        sourceLang: "d",
        editable: true,
        sourceName: "x",
        roots: [
            {
                id: "test",
                label: "test",
                kind: "dialog",
                states: [
                    {
                        id: "fresh",
                        text: "A new line.",
                        choices: [{ id: "fresh#0", text: "ok", target: { kind: "exit" } }],
                    },
                ],
            },
        ],
        messages: {},
    };
}

afterEach(() => {
    vi.useRealTimers();
});

describe("errorMessage", () => {
    it("unwraps an Error's message and stringifies anything else", () => {
        expect(errorMessage(new Error("boom"))).toBe("boom");
        expect(errorMessage("plain")).toBe("plain");
    });
});

describe("DialogHostCore.postModel (via handleReady)", () => {
    it("posts the parse-request failure as a webview error", async () => {
        const { io, posted } = makeIO({ requestParse: async () => ({ error: "socket down" }) });
        new DialogHostCore(io, "/x.d").handleReady();
        await flush();
        expect(posted).toEqual([{ type: "error", message: "Dialog parse request failed: socket down" }]);
    });

    it("posts a distinct error for a null payload (server threw) vs an uninterpretable one", async () => {
        const { io, posted } = makeIO({ requestParse: async () => ({ data: null }) });
        new DialogHostCore(io, "/x.d").handleReady();
        await flush();
        expect(posted[0]!.message as string).toContain("returned no dialog data");

        const bad = makeIO({ requestParse: async () => ({ data: { nonsense: true } }) });
        new DialogHostCore(bad.io, "/x.d").handleReady();
        await flush();
        expect(bad.posted[0]!.message as string).toContain("could not be interpreted");
    });

    it("enriches the model with sourceName from the document path", async () => {
        const { io, posted } = makeIO();
        new DialogHostCore(io, "/dir/greeter.d").handleReady();
        await flush();
        const model = posted[0]!.model as DialogModel;
        expect(posted[0]!.type).toBe("model");
        expect(model.sourceName).toBe("greeter");
    });

    it("refines a .td/.tssl document to its transpiler sourceLang with blanket-editable off", async () => {
        const td = makeIO();
        new DialogHostCore(td.io, "/a/thing.TD").handleReady();
        await flush();
        expect((td.posted[0]!.model as DialogModel).sourceLang).toBe("td");
        expect((td.posted[0]!.model as DialogModel).editable).toBe(false);

        const tssl = makeIO({ requestParse: async () => ({ data: { nodes: [], entryPoints: [] } }) });
        new DialogHostCore(tssl.io, "/a/thing.tssl").handleReady();
        await flush();
        expect((tssl.posted[0]!.model as DialogModel).sourceLang).toBe("tssl");
    });

    it("does not post to a webview disposed while the parse was in flight", async () => {
        let resolve!: (v: { data: unknown }) => void;
        const { io, posted } = makeIO({
            requestParse: () =>
                new Promise((r) => {
                    resolve = r;
                }),
        });
        const core = new DialogHostCore(io, "/x.d");
        core.handleReady();
        core.dispose();
        resolve({ data: EMPTY_D });
        await flush();
        expect(posted).toEqual([]);
    });
});

describe("DialogHostCore.handleEdit", () => {
    it("surfaces a parse-request failure as a toast, not a silent drop", async () => {
        const { io, errors, replaced } = makeIO({ requestParse: async () => ({ error: "gone" }) });
        const core = new DialogHostCore(io, "/x.d");
        core.handleEdit(newStateModel(), 1);
        await core.drainEdits();
        expect(errors).toEqual(["Dialog edit failed: gone"]);
        expect(replaced).toEqual([]);
    });

    it("surfaces a null re-parse of an open document instead of splicing against nothing", async () => {
        const { io, errors, replaced } = makeIO({ requestParse: async () => ({ data: null }) });
        const core = new DialogHostCore(io, "/x.d");
        core.handleEdit(newStateModel(), 1);
        await core.drainEdits();
        expect(errors[0]).toContain("Dialog edit not saved");
        expect(replaced).toEqual([]);
    });

    it("a text-only edit (no structural change) applies no document edit but schedules the flush", async () => {
        vi.useFakeTimers();
        const { io, replaced, saved } = makeIO();
        const core = new DialogHostCore(io, "/x.d");
        const edited: DialogModel = { sourceLang: "d", editable: true, roots: [], messages: { "0": "typed" } };
        core.handleEdit(edited, 1);
        await core.drainEdits();
        expect(replaced).toEqual([]); // nothing spliced
        await vi.advanceTimersByTimeAsync(400); // the debounced write-through
        expect(saved).toEqual([{ "0": "typed" }]);
    });

    it("splices a structural edit, then posts the faithful re-parse tagged with the emit's seq", async () => {
        const { io, posted, replaced } = makeIO();
        const core = new DialogHostCore(io, "/x.d");
        core.handleEdit(newStateModel(), 7);
        await core.drainEdits();
        // The new state was serialized into the (empty) document...
        expect(replaced).toHaveLength(1);
        expect(replaced[0]).toContain("BEGIN fresh");
        // ...and the re-parse post carries the seq plus the minted allocations/messages for the remap.
        const reparse = posted.find((p) => p.reparse === true)!;
        expect(reparse.seq).toBe(7);
        expect(Object.keys(reparse.allocations as Record<string, string>)).toEqual(["fresh", "fresh#0"]);
        expect(Object.values(reparse.messages as Record<string, string>)).toContain("A new line.");
    });

    it("a rejected WorkspaceEdit (false) toasts, skips the re-parse post, and unmarks the echo guard", async () => {
        const { io, posted, errors } = makeIO({ replaceText: async () => false });
        const core = new DialogHostCore(io, "/x.d");
        core.handleEdit(newStateModel(), 1);
        await core.drainEdits();
        expect(errors).toEqual(["Dialog edit could not be applied to the document."]);
        expect(posted.filter((p) => p.reparse === true)).toEqual([]);
        // The self-edit token was rolled back: the next change event reads as EXTERNAL and re-projects.
        core.handleDocumentChanged(1);
        await flush();
        expect(posted.filter((p) => p.type === "model")).toHaveLength(1);
    });

    it("a throwing applyEdit unmarks the guard and reports through the queue's error path", async () => {
        const { io, errors, posted } = makeIO({
            replaceText: async () => {
                throw new Error("host exploded");
            },
        });
        const core = new DialogHostCore(io, "/x.d");
        core.handleEdit(newStateModel(), 1);
        await core.drainEdits();
        expect(errors).toEqual(["Dialog edit failed: host exploded"]);
        core.handleDocumentChanged(1); // guard unmarked on throw -> external re-project still works
        await flush();
        expect(posted.filter((p) => p.type === "model")).toHaveLength(1);
    });

    it("does not touch the document when disposed while the edit's parse was in flight", async () => {
        let resolve!: (v: { data: unknown }) => void;
        const { io, replaced } = makeIO({
            requestParse: () =>
                new Promise((r) => {
                    resolve = r;
                }),
        });
        const core = new DialogHostCore(io, "/x.d");
        core.handleEdit(newStateModel(), 1);
        await flush();
        core.dispose();
        resolve({ data: EMPTY_D });
        await core.drainEdits();
        expect(replaced).toEqual([]);
    });
});

describe("DialogHostCore.handleDocumentChanged (echo guard)", () => {
    it("skips metadata-only events, consumes one self-edit, then re-projects external edits", async () => {
        const { io, posted } = makeIO();
        const core = new DialogHostCore(io, "/x.d");
        core.handleEdit(newStateModel(), 1); // marks one self-edit and posts one reparse
        await core.drainEdits();
        const before = posted.length;
        core.handleDocumentChanged(0); // metadata-only: never consults the guard
        core.handleDocumentChanged(1); // the self-edit's own change event: consumed, no re-project
        await flush();
        expect(posted).toHaveLength(before);
        core.handleDocumentChanged(1); // a genuine external edit
        await flush();
        expect(posted).toHaveLength(before + 1);
    });
});

describe("DialogHostCore message flush", () => {
    it("flushes immediately on save, and surfaces a failing write", async () => {
        const { io, saved, errors } = makeIO({
            saveMessages: async (m) => {
                saved.push(m);
                throw new Error("disk full");
            },
        });
        const core = new DialogHostCore(io, "/x.d");
        core.handleEdit({ sourceLang: "d", editable: true, roots: [], messages: { "1": "line" } }, 1);
        await core.drainEdits();
        core.handleDocumentSaved();
        await flush();
        expect(saved).toEqual([{ "1": "line" }]);
        expect(errors[0]).toContain("Saving dialog message text failed: disk full");
    });

    it("is a no-op with no messages to write", async () => {
        const { io, saved } = makeIO();
        const core = new DialogHostCore(io, "/x.d");
        core.handleDocumentSaved();
        await flush();
        expect(saved).toEqual([]);
    });

    it("rapid edits collapse to ONE debounced flush carrying the latest messages", async () => {
        vi.useFakeTimers();
        const { io, saved } = makeIO();
        const core = new DialogHostCore(io, "/x.d");
        core.handleEdit({ sourceLang: "d", editable: true, roots: [], messages: { "1": "draft" } }, 1);
        await core.drainEdits();
        await vi.advanceTimersByTimeAsync(200); // inside the debounce window - the second edit resets it
        core.handleEdit({ sourceLang: "d", editable: true, roots: [], messages: { "1": "final" } }, 2);
        await core.drainEdits();
        await vi.advanceTimersByTimeAsync(400);
        expect(saved).toEqual([{ "1": "final" }]);
    });
});

describe("DialogHostCore edge branches", () => {
    it("a model of an unhandled sourceLang skips the splice machinery but still records/flushes", async () => {
        vi.useFakeTimers();
        const { io, replaced, saved } = makeIO();
        const core = new DialogHostCore(io, "/x.d");
        // Only reachable via a cast (the union is exhaustive); the guard must skip the parse/splice
        // block rather than crash, and the message write-through still runs.
        const alien = { sourceLang: "bogus", editable: false, roots: [], messages: { "9": "x" } };
        core.handleEdit(alien as unknown as DialogModel, 1);
        await core.drainEdits();
        expect(replaced).toEqual([]);
        await vi.advanceTimersByTimeAsync(400);
        expect(saved).toEqual([{ "9": "x" }]);
    });

    it("a pathless document yields no sourceName rather than an empty-string label", async () => {
        const { io, posted } = makeIO();
        new DialogHostCore(io, "").handleReady();
        await flush();
        expect((posted[0]!.model as DialogModel).sourceName).toBeUndefined();
    });
});
