/**
 * One gallery panel at a time, whichever entry point asks for it.
 *
 * The rule lives in the registration rather than in the panel, so this drives the registered commands and
 * the serializer and counts the panels that came out. The panel itself is wired for real - only the worker
 * thread and the HTML builder are stood in for - because "the second command retargeted the live panel"
 * is a claim about what that panel then says, not about a call being made.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type * as vscodeTypes from "vscode";
import { type HostToWebview, type WebviewToHost } from "../src/gallery/webview/messages";

type InitMessage = Extract<HostToWebview, { type: "init" }>;

/** The panel's most recent reading of its corpus - a retargeted panel posts a second one. */
function lastInit(posted: readonly HostToWebview[]): InitMessage | undefined {
    return posted.findLast((message): message is InitMessage => message.type === "init");
}

/** A webview panel that records what it was told, and hands back the webview's own message channel. */
function fakePanel() {
    const posted: HostToWebview[] = [];
    const disposeListeners: (() => void)[] = [];
    let receive: ((message: WebviewToHost) => void) | undefined;
    const panel = {
        title: "",
        disposed: false,
        revealed: 0,
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
        onDidDispose: (fn: () => void) => {
            disposeListeners.push(fn);
            return { dispose: () => {} };
        },
        reveal: () => {
            panel.revealed += 1;
        },
        dispose: () => {
            panel.disposed = true;
            for (const fn of disposeListeners) fn();
        },
    };
    return {
        panel,
        posted,
        ready: () => receive?.({ type: "ready" }),
        /** The source the panel last told its webview it was browsing. */
        lastSource: () => lastInit(posted)?.source,
    };
}

const created: ReturnType<typeof fakePanel>[] = [];
const commands = new Map<string, (...args: unknown[]) => unknown>();
let serializer: { deserializeWebviewPanel(panel: unknown, state: unknown): Promise<void> } | undefined;

vi.mock("vscode", () => ({
    Uri: { joinPath: (...parts: unknown[]) => ({ fsPath: parts.join("/"), toString: () => parts.join("/") }) },
    ViewColumn: { Active: -1 },
    window: {
        showErrorMessage: vi.fn(),
        createWebviewPanel: () => {
            const made = fakePanel();
            created.push(made);
            return made.panel;
        },
        registerWebviewPanelSerializer: (_type: string, impl: unknown) => {
            serializer = impl as typeof serializer;
            return { dispose: () => {} };
        },
    },
    commands: {
        registerCommand: (name: string, fn: (...args: unknown[]) => unknown) => {
            commands.set(name, fn);
            return { dispose: () => {} };
        },
        executeCommand: async () => {},
    },
    workspace: { workspaceFolders: [] },
}));

// The chrome comes from the shared builder, which reads template and bundle files off disk; nothing here
// looks at the HTML.
vi.mock("../src/webview-html", () => ({
    SHARED_TILES_CSS: "client/src/webview-ui/animation-tiles.css",
    buildSharedWebviewHtml: () => "<html></html>",
    sharedWebviewRoots: () => [],
}));

// A real panel spawns a worker thread off a bundle that only a built extension has.
vi.mock("node:worker_threads", () => ({
    Worker: class {
        postMessage(): void {}
        on(): void {}
        terminate(): Promise<number> {
            return Promise.resolve(0);
        }
    },
}));

const { registerGallery } = await import("../src/gallery/register");

const context = { extensionUri: { fsPath: "/ext" }, subscriptions: [] } as unknown as vscodeTypes.ExtensionContext;

/** Register over an install-less session: what is browsed does not matter here, only which panel browses it. */
function register(): void {
    registerGallery(context, {
        gameSession: () => undefined,
        animations: () => undefined,
        revealResource: async () => {},
        onDidChangeGame: (() => ({ dispose: () => {} })) as unknown as vscodeTypes.Event<void>,
    });
}

const showGame = (): void => void commands.get("bgforge.gallery.showGame")?.();
const showWorkspace = (): void => void commands.get("bgforge.gallery.showWorkspace")?.();

beforeEach(() => {
    created.length = 0;
    commands.clear();
    serializer = undefined;
    register();
});

describe("the gallery opens at most one panel", () => {
    it("reveals the panel it already has instead of opening a second", () => {
        showGame();
        showGame();

        expect(created).toHaveLength(1);
        expect(created[0]?.panel.revealed).toBe(1);
    });

    it("leaves a re-run of the same command alone, rather than rebuilding what it is showing", () => {
        showGame();
        created[0]?.ready();
        const before = created[0]?.posted.length;

        showGame();

        // Nothing re-posted, and still the one panel: the reader's filter, scroll and tab are in that
        // webview, and an init replaces its whole world. Both halves, because a second panel would also
        // leave the first one's message log untouched.
        expect(created).toHaveLength(1);
        expect(created[0]?.posted.length).toBe(before);
    });

    it("moves the live panel to the other source instead of opening one beside it", () => {
        showGame();
        created[0]?.ready();

        showWorkspace();

        expect(created).toHaveLength(1);
        expect(created[0]?.lastSource()).toBe("workspace");
        expect(created[0]?.panel.title).toBe("Workspace Image Gallery");
    });

    it("points the live panel at an animation a link names", () => {
        showGame();
        created[0]?.ready();

        commands.get("bgforge.gallery.showAnimation")?.(0x6500);

        expect(created).toHaveLength(1);
        expect(lastInit(created[0]?.posted ?? [])).toMatchObject({ focusSet: 0x6500 });
    });

    it("opens a new panel once the live one is closed", () => {
        showGame();
        created[0]?.panel.dispose();

        showGame();

        expect(created).toHaveLength(2);
    });

    it("closes the extra panels a window saved before this rule restores", async () => {
        const first = fakePanel();
        const second = fakePanel();

        await serializer?.deserializeWebviewPanel(first.panel, { source: "game" });
        await serializer?.deserializeWebviewPanel(second.panel, { source: "game" });

        expect(first.panel.disposed).toBe(false);
        expect(second.panel.disposed).toBe(true);
    });
});
