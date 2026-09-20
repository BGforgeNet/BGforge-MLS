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

const { showErrorMessageMock, executeCommandMock } = vi.hoisted(() => ({
    showErrorMessageMock: vi.fn(),
    executeCommandMock: vi.fn(),
}));

vi.mock("vscode", () => ({
    Uri: { joinPath: (...parts: unknown[]) => ({ toString: () => parts.join("/") }) },
    window: { showErrorMessage: showErrorMessageMock },
    commands: { executeCommand: executeCommandMock },
}));

// The panel's chrome comes from the shared builder, which reads real template and bundle files off disk;
// what this suite drives is the message pump, so the builder is stubbed out wholesale.
vi.mock("../src/webview-html", () => ({
    SHARED_TILES_CSS: "client/src/webview-ui/animation-tiles.css",
    buildSharedWebviewHtml: () => "<html></html>",
    sharedWebviewRoots: () => [],
}));

const { wireGalleryPanel } = await import("../src/gallery/panel");

const ITEM: GalleryItem = { id: "MOGHG1.bam", label: "MOGHG1", ext: "bam" };
const SET: SetTile = { id: 0x6500, label: "OGRE_MAGE", resref: "MOGH", unsupported: undefined };

/**
 * Wait until the panel has posted `count` readings, and hand them back.
 *
 * Taking a reading is asynchronous - the workspace source asks the editor for its file listing - so `init`,
 * and the pump the panel builds beside it, land a turn after the message that triggered them. The webview
 * only asks for thumbnails once it has an `init`, so waiting for one here is also what production does.
 */
async function readings(posted: HostToWebview[], count = 1): Promise<HostToWebview[]> {
    const inits = (): HostToWebview[] => posted.filter((message) => message.type === "init");
    await vi.waitFor(() => expect(inits()).toHaveLength(count));
    return inits();
}

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

beforeEach(() => {
    showErrorMessageMock.mockClear();
});

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
        sourceFor: () => Promise.resolve(open ? fakeSource() : undefined),
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

    it("says which empty state it is in while no game is open", async () => {
        const { panel, posted, send } = fakePanel();
        wireGalleryPanel(panel, { source: "game" }, context, deps);
        send({ type: "ready" });

        const [init] = await readings(posted);
        expect(init).toMatchObject({ items: [], sets: [] });
        expect(init && "note" in init && init.note).toContain("No game is open");
        // The flag, not the wording, is what puts the Open game button on the empty state - the note is
        // prose and gets reworded, which is not something a control may depend on.
        expect(init).toMatchObject({ noGameOpen: true });
    });

    /**
     * The workspace gallery's empty state is a missing FOLDER, and offering to open a game there would
     * answer a question the reader did not ask.
     */
    it("offers no game button when what is missing is a folder", async () => {
        const { panel, posted, send } = fakePanel();
        wireGalleryPanel(panel, { source: "workspace" }, context, deps);
        send({ type: "ready" });

        const [init] = await readings(posted);
        expect(init && "note" in init && init.note).toContain("No folder is open");
        expect(init && "noGameOpen" in init).toBe(false);
    });

    /**
     * Taking a reading can fail now that it asks the editor rather than the disk - a workspace served by a
     * file system provider can refuse. The panel must say which corpus failed and why, and still draw its
     * empty state: a silent failure is a blank grid that never explains itself.
     */
    it("says so and falls back to the empty state when the reading fails", async () => {
        const { panel, posted, send } = fakePanel();
        wireGalleryPanel(panel, { source: "workspace" }, context, {
            ...deps,
            sourceFor: () => Promise.reject(new Error("provider refused")),
        });
        send({ type: "ready" });

        const [init] = await readings(posted);
        expect(showErrorMessageMock).toHaveBeenCalledWith(
            "Image gallery could not read the workspace: provider refused",
        );
        expect(init).toMatchObject({ items: [] });
    });

    it("opens a game when the empty state's button asks for one", () => {
        const { panel, send } = fakePanel();
        wireGalleryPanel(panel, { source: "game" }, context, deps);
        send({ type: "ready" });

        send({ type: "openGame" });

        expect(executeCommandMock).toHaveBeenCalledWith("bgforge.ieResources.openGame");
    });

    it("re-answers with the game's contents once one opens", async () => {
        const { panel, posted, send } = fakePanel();
        wireGalleryPanel(panel, { source: "game" }, context, deps);
        send({ type: "ready" });
        await readings(posted);

        open = true;
        expect(listener, "the panel never subscribed to the game changing").toBeDefined();
        listener?.();

        const inits = await readings(posted, 2);
        // The note is what the panel shows INSTEAD of the grid, so it has to go when the grid can fill.
        expect(inits[1]).toMatchObject({ items: [ITEM], sets: [SET] });
        expect(inits[1] && "note" in inits[1]).toBe(false);
    });

    it("goes back to the empty state when the game closes", async () => {
        const { panel, posted, send } = fakePanel();
        open = true;
        wireGalleryPanel(panel, { source: "game" }, context, deps);
        send({ type: "ready" });
        await readings(posted);

        open = false;
        listener?.();

        const inits = await readings(posted, 2);
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
        await readings(posted);

        send({ type: "showSet", id: SET.id });
        await vi.waitFor(() =>
            expect(posted.findLast((message) => message.type === "showing")).toMatchObject({ set: SET.id }),
        );

        expect(staged).toEqual([`set:${SET.id}`]);
    });
});

/**
 * Message routing exercised against an already-open game, isolated from the "game opens later" behavior above:
 * the worker's error channel, a thumbnail request, both branches of the "open" message, and a webview crash.
 */
describe("wireGalleryPanel message routing", () => {
    let errorCb: ((err: Error) => void) | undefined;
    let openCalls: { id: string }[] = [];
    let animationUriResult: vscodeTypes.Uri | undefined;
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
        sourceFor: () => Promise.resolve(fakeSource()),
        open: async (_source: GallerySource, id: string) => {
            openCalls.push({ id });
        },
        animationUri: () => animationUriResult,
        sets: (): readonly SetTile[] => [SET],
        setUri: (id: number) => ({ toString: () => `set:${id}` }) as vscodeTypes.Uri,
        animation,
        makePort: () => ({
            postMessage: () => {},
            onMessage: () => {},
            onError: (cb: (err: Error) => void) => {
                errorCb = cb;
            },
            dispose: () => {},
        }),
        onDidChangeGame: () => ({ dispose: () => {} }),
    };

    beforeEach(() => {
        errorCb = undefined;
        openCalls = [];
        animationUriResult = undefined;
        staged = [];
    });

    it("surfaces a dead or crashed worker as a toast naming the failure", () => {
        const { panel } = fakePanel();
        wireGalleryPanel(panel, { source: "game" }, context, deps);

        expect(errorCb, "the panel never subscribed to the port's error channel").toBeDefined();
        errorCb?.(new Error("worker crashed"));

        expect(showErrorMessageMock).toHaveBeenCalledWith("Image gallery worker stopped: worker crashed");
    });

    it("forwards a requestThumbnails message to the pump", async () => {
        const { panel, posted, send } = fakePanel();
        wireGalleryPanel(panel, { source: "game" }, context, deps);
        send({ type: "ready" });
        await readings(posted);

        send({ type: "requestThumbnails", ids: [ITEM.id], size: 64 });

        // fakeSource().stamp() is undefined for every item, so the pump answers straight away with "no
        // picture" rather than dispatching to the worker - see ThumbnailPump.request's key === undefined arm.
        expect(posted).toContainEqual({ type: "thumbnail", id: ITEM.id });
    });

    it("hands an item with no stage on this panel to deps.open", async () => {
        const { panel, posted, send } = fakePanel();
        wireGalleryPanel(panel, { source: "game" }, context, deps);
        send({ type: "ready" });
        await readings(posted);

        send({ type: "open", id: ITEM.id });

        expect(openCalls).toEqual([{ id: ITEM.id }]);
        expect(staged).toEqual([]);
    });

    it("draws an item this panel can stage instead of handing it off", async () => {
        const { panel, posted, send } = fakePanel();
        animationUriResult = { toString: () => "anim:MOGHG1" } as vscodeTypes.Uri;
        wireGalleryPanel(panel, { source: "game" }, context, deps);
        send({ type: "ready" });
        await readings(posted);

        send({ type: "open", id: ITEM.id });
        await vi.waitFor(() =>
            expect(posted.findLast((message) => message.type === "showing")).toMatchObject({ item: ITEM.id }),
        );

        expect(staged).toEqual(["anim:MOGHG1"]);
        expect(openCalls).toEqual([]);
    });

    it("surfaces a webview runtimeError as a toast naming the failure", () => {
        const { panel, send } = fakePanel();
        wireGalleryPanel(panel, { source: "game" }, context, deps);
        send({ type: "ready" });

        send({ type: "runtimeError", message: "boom", stack: "at foo" });

        expect(showErrorMessageMock).toHaveBeenCalledWith("Image gallery failed for game: boom");
    });

    /**
     * The panel narrows what arrives before acting on it, as the binary, animation and dialog panels do. A
     * shape it does not recognise means the two sides disagree about the contract, so it is reported rather
     * than acted on halfway - a `requestThumbnails` with no `ids` would otherwise reach the pump.
     */
    it.each([
        ["a wrong-typed field", { type: "requestThumbnails", ids: "MOGHG1.bam", size: 64 }],
        ["a missing field", { type: "open" }],
        ["an unknown type", { type: "detonate" }],
        ["a non-object", "ready"],
    ])("refuses %s and says so instead of acting on it", async (_name, message) => {
        const { panel, posted, send } = fakePanel();
        wireGalleryPanel(panel, { source: "game" }, context, deps);
        send({ type: "ready" });
        // Settled first, so the reading's own messages cannot land between the count and the assertion.
        await readings(posted);
        const before = posted.length;

        send(message as never);

        expect(showErrorMessageMock).toHaveBeenCalledWith(
            expect.stringContaining("Image gallery failed for game: unrecognized message of type"),
        );
        expect(posted, "a refused message must not reach the pump").toHaveLength(before);
    });

    it("still accepts the shapes the contract declares", () => {
        const { panel, send } = fakePanel();
        wireGalleryPanel(panel, { source: "game" }, context, deps);

        send({ type: "ready" });
        send({ type: "requestThumbnails", ids: [ITEM.id], size: 64 });
        send({ type: "showSet", id: SET.id });
        send({ type: "viewer", message: { type: "ready" } });

        expect(showErrorMessageMock, "a valid message was refused").not.toHaveBeenCalled();
    });
});
