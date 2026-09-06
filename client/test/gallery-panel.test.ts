/**
 * The gallery panel's reaction to a game opening under it.
 *
 * The panel is restored during activation, and the resource view opens the game only once it becomes
 * visible - so on a window reload the panel is wired BEFORE there is a game to browse. Every other consumer
 * asks per lookup and self-corrects; a panel is wired once and keeps whatever it was handed, which is why
 * this needs a test rather than an inspection.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type * as vscodeTypes from "vscode";
import { type GalleryItem, type GallerySource } from "../src/gallery/source";
import { type HostToWebview, type SetTile, type WebviewToHost } from "../src/gallery/webview/messages";

vi.mock("vscode", () => ({
    Uri: { joinPath: (...parts: unknown[]) => ({ toString: () => parts.join("/") }) },
    window: { showErrorMessage: vi.fn() },
}));

vi.mock("../src/webview-assets", () => ({
    getCachedHtmlAsset: () => "<html>{{stylesUri}}{{sharedStylesUri}}{{codiconsUri}}{{cspSource}}</html>",
    getCachedJsAsset: () => "",
    inlineWebviewScript: (html: string) => html,
    generateNonce: () => "nonce",
}));

const { wireGalleryPanel } = await import("../src/gallery/panel");

const ITEM: GalleryItem = { id: "MOGHG1.bam", label: "MOGHG1", ext: "bam" };
const SET: SetTile = { id: 0x6500, label: "OGRE_MAGE", resref: "MOGH", unsupported: undefined };

function fakeSource(): GallerySource {
    return {
        kind: "game",
        list: () => [ITEM],
        locate: () => undefined,
        stamp: () => undefined,
        locateAux: () => undefined,
        reveal: async () => {},
    };
}

/** A panel that records what the host posts and hands back the webview's own message channel. */
function fakePanel() {
    const posted: HostToWebview[] = [];
    let receive: ((message: WebviewToHost) => void) | undefined;
    const panel = {
        webview: {
            options: {},
            html: "",
            cspSource: "vscode-webview:",
            asWebviewUri: (uri: { toString: () => string }) => uri,
            postMessage: (message: HostToWebview) => {
                posted.push(message);
                return Promise.resolve(true);
            },
            onDidReceiveMessage: (fn: (message: WebviewToHost) => void) => {
                receive = fn;
                return { dispose: () => {} };
            },
        },
        onDidDispose: () => ({ dispose: () => {} }),
    };
    return {
        posted,
        panel: panel as unknown as vscodeTypes.WebviewPanel,
        send: (message: WebviewToHost) => receive?.(message),
    };
}

const context = { extensionUri: { fsPath: "/ext" }, subscriptions: [] } as unknown as vscodeTypes.ExtensionContext;

describe("wireGalleryPanel over a game that opens later", () => {
    let open = false;
    let listener: (() => void) | undefined;
    /** The addresses put on the panel's own stage, in order. */
    let staged: string[] = [];

    const animation = {
        openDocument: async (uri: vscodeTypes.Uri) => {
            staged.push(uri.toString());
            return {} as never;
        },
        attach: () => ({ dispose: () => {} }),
        saveDocument: async () => {},
    };

    const deps = {
        sourceFor: () => (open ? fakeSource() : undefined),
        open: async () => {},
        animationUri: () => undefined,
        sets: (): readonly SetTile[] => (open ? [SET] : []),
        setUri: (id: number) => ({ toString: () => `set:${id}` }) as vscodeTypes.Uri,
        animation,
        makePort: () => ({
            postMessage: () => {},
            onMessage: () => {},
            onError: () => {},
            dispose: () => {},
        }),
        onDidChangeGame: (fn: () => void) => {
            listener = fn;
            return { dispose: () => {} };
        },
    };

    beforeEach(() => {
        open = false;
        listener = undefined;
        staged = [];
    });

    it("says which empty state it is in while no game is open", () => {
        const { panel, posted, send } = fakePanel();
        wireGalleryPanel(panel, { source: "game" }, context, deps);
        send({ type: "ready" });

        const init = posted.find((message) => message.type === "init");
        expect(init).toMatchObject({ items: [], sets: [] });
        expect(init && "note" in init && init.note).toContain("No game is open");
    });

    it("re-answers with the game's contents once one opens", () => {
        const { panel, posted, send } = fakePanel();
        wireGalleryPanel(panel, { source: "game" }, context, deps);
        send({ type: "ready" });

        open = true;
        expect(listener, "the panel never subscribed to the game changing").toBeDefined();
        listener?.();

        const inits = posted.filter((message) => message.type === "init");
        expect(inits).toHaveLength(2);
        // The note is what the panel shows INSTEAD of the grid, so it has to go when the grid can fill.
        expect(inits[1]).toMatchObject({ items: [ITEM], sets: [SET] });
        expect(inits[1] && "note" in inits[1]).toBe(false);
    });

    it("goes back to the empty state when the game closes", () => {
        const { panel, posted, send } = fakePanel();
        open = true;
        wireGalleryPanel(panel, { source: "game" }, context, deps);
        send({ type: "ready" });

        open = false;
        listener?.();

        const inits = posted.filter((message) => message.type === "init");
        expect(inits[1]).toMatchObject({ items: [], sets: [] });
        expect(inits[1] && "note" in inits[1] && inits[1].note).toContain("No game is open");
    });

    /**
     * A set row draws HERE. It used to open an editor tab; the announcement back is what mounts the
     * animation surface in this panel, so its absence would leave the row click doing nothing visible.
     */
    it("draws a set on its own stage and says which one", async () => {
        const { panel, posted, send } = fakePanel();
        open = true;
        wireGalleryPanel(panel, { source: "game" }, context, deps);
        send({ type: "ready" });

        send({ type: "showSet", id: SET.id });
        await vi.waitFor(() =>
            expect(posted.findLast((message) => message.type === "showing")).toMatchObject({ set: SET.id }),
        );

        expect(staged).toEqual([`set:${SET.id}`]);
    });
});
