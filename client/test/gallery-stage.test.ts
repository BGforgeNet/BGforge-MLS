/**
 * The gallery's animation stage: which document is on it, and what happens to the one it replaces.
 *
 * The panel opens a document per selection, so the interesting behaviour is all in the handover - a message
 * arriving between two shows, a slow open overtaken by a quick second pick, and the emitters a replaced
 * document leaves behind. None of that is visible from the drawn picture, which is why it is tested here
 * rather than only driven.
 */
import { describe, expect, it, vi } from "vitest";
import type * as vscodeTypes from "vscode";

vi.mock("vscode", () => ({
    Disposable: class {
        readonly dispose: () => void;
        constructor(onDispose: () => void) {
            this.dispose = onDispose;
        }
    },
}));

const { createAnimationStage } = await import("../src/gallery/stage");

type Doc = { uri: string; disposed: boolean };

/** An editor whose open can be made to finish out of order, which is the whole point of the race guard. */
function fakeHost() {
    const opened: Doc[] = [];
    const attached: { doc: Doc; detached: boolean }[] = [];
    const pending: (() => void)[] = [];
    let hold = false;

    return {
        opened,
        attached,
        /** Make the next opens wait until `release` is called. */
        holdOpens: () => {
            hold = true;
        },
        release: () => {
            hold = false;
            for (const resume of pending.splice(0)) resume();
        },
        host: {
            openDocument: async (uri: vscodeTypes.Uri) => {
                const doc: Doc = { uri: uri.toString(), disposed: false };
                opened.push(doc);
                if (hold) {
                    await new Promise<void>((resolve) => {
                        pending.push(resolve);
                    });
                }
                return {
                    ...doc,
                    dispose: () => {
                        doc.disposed = true;
                    },
                } as never;
            },
            attach: (
                document: never,
                channel: { onMessage: (h: (m: unknown) => Promise<void>) => { dispose: () => void } },
            ) => {
                const entry = { doc: document as unknown as Doc, detached: false };
                attached.push(entry);
                const subscription = channel.onMessage(async (message) => {
                    received.push(message);
                }) as { dispose: () => void };
                return {
                    dispose: () => {
                        entry.detached = true;
                        subscription.dispose();
                    },
                };
            },
            saveDocument: async () => {},
        },
    };
}

const received: unknown[] = [];
const uri = (value: string): vscodeTypes.Uri => ({ toString: () => value }) as vscodeTypes.Uri;

function stageOver(host: ReturnType<typeof fakeHost>) {
    received.length = 0;
    return createAnimationStage({ host: host.host, post: () => {}, showSet: async () => {} });
}

describe("the gallery's animation stage", () => {
    it("opens the document and delivers the surface's messages to it", async () => {
        const host = fakeHost();
        const stage = stageOver(host);

        expect(await stage.show(uri("set:1"))).toBe(true);
        stage.receive({ type: "ready" } as never);

        expect(host.opened.map((doc) => doc.uri)).toEqual(["set:1"]);
        expect(received).toEqual([{ type: "ready" }]);
    });

    it("detaches and disposes the document it replaces", async () => {
        const host = fakeHost();
        const stage = stageOver(host);

        await stage.show(uri("set:1"));
        await stage.show(uri("set:2"));

        expect(host.attached[0]?.detached).toBe(true);
        expect(host.opened[0]?.disposed).toBe(true);
        expect(host.attached[1]?.detached).toBe(false);
    });

    /** Between two shows there is nothing attached, so a message then belongs to neither document. */
    it("drops a message arriving with nothing on the stage", async () => {
        const host = fakeHost();
        const stage = stageOver(host);

        await stage.show(uri("set:1"));
        stage.dispose();
        stage.receive({ type: "ready" } as never);

        expect(received).toEqual([]);
    });

    /**
     * Two quick picks are two reads in flight. The slower one must not land on the stage after the reader
     * has moved on - it reports that it was overtaken, and disposes the document nothing will draw.
     */
    it("refuses a show that a later one overtook", async () => {
        const host = fakeHost();
        const stage = stageOver(host);

        host.holdOpens();
        const first = stage.show(uri("set:1"));
        const second = stage.show(uri("set:2"));
        host.release();

        expect(await first).toBe(false);
        expect(await second).toBe(true);
        expect(host.opened[0]?.disposed).toBe(true);
        expect(host.attached.map((entry) => entry.doc.uri)).toEqual(["set:2"]);
    });

    it("disposes what it holds when the panel closes", async () => {
        const host = fakeHost();
        const stage = stageOver(host);

        await stage.show(uri("set:1"));
        stage.dispose();

        expect(host.attached[0]?.detached).toBe(true);
        expect(host.opened[0]?.disposed).toBe(true);
    });
});
