/**
 * The webview's init deadline bounds SILENCE, not slowness, so the host has to say something before
 * it starts the expensive part. Decoding a large BAM v2 (MAPICONS.BAM is 5888 frames) and getting it
 * across the webview boundary takes longer than the whole budget, and with no liveness signal the
 * panel reported "the file did not open" for a file that was opening normally.
 *
 * Asserts the ORDER at the host's real post surface: a `loading` message must reach the webview
 * before `toView()` is called, not merely at some point during the open.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import type * as vscode from "vscode";
import { serializeBamV1, serializeFrm } from "@bgforge/image";
import { makeMiniFrm, makeMultiFrameBam } from "./fixtures";
import { framePixels, type AnimationView, type FrameView } from "../../src/image-editor/webview/messages";
import { REPO_ROOT } from "../repo-root";

const { readFileMock } = vi.hoisted(() => ({ readFileMock: vi.fn() }));

vi.mock("vscode", () => {
    class EventEmitter {
        readonly event = (): { dispose: () => void } => ({ dispose: () => {} });
        fire(): void {}
        dispose(): void {}
    }
    const make = (fsPath: string): Record<string, unknown> => ({
        scheme: "file",
        path: fsPath,
        query: "",
        fsPath,
        toString: () => `file:${fsPath}`,
        with: (change: { path?: string }) => make(change.path ?? fsPath),
    });
    return {
        EventEmitter,
        Uri: {
            file: (fsPath: string) => make(fsPath),
            parse: (value: string) => make(value),
            joinPath: (base: { fsPath: string }, ...parts: string[]) => make(`${base.fsPath}/${parts.join("/")}`),
        },
        window: { showWarningMessage: vi.fn(), showErrorMessage: vi.fn() },
        workspace: { fs: { readFile: readFileMock, writeFile: vi.fn() } },
    };
});

// The webview bundle is a BUILD ARTIFACT, and the gate runs `pnpm test:all` before `pnpm build`, so on a
// clean checkout it does not exist and the real read throws ENOENT. These tests assert the host's message
// ORDER, not the panel's HTML, so only the bundle is stubbed - index.html and styles.css are committed
// sources and are still read for real, which is what the extension path below exists for.
vi.mock("../../src/webview-assets", async () => {
    const actual = await vi.importActual<typeof import("../../src/webview-assets")>("../../src/webview-assets");
    return { ...actual, getCachedJsAsset: () => "/* webview bundle stubbed: see the mock above */" };
});

const { ImageEditorProvider } = await import("../../src/image-editor/provider");

// The real repo root: resolveCustomEditor builds the panel HTML by reading the webview's actual
// index.html off disk, so a synthetic extension path fails before any message is posted.
const context = { extensionUri: { fsPath: REPO_ROOT } } as unknown as vscode.ExtensionContext;
const token = {} as vscode.CancellationToken;

/** A file URI shaped like the vscode mock's own: the open path calls `.with()` probing for a pair. */
function fileUri(fsPath: string): vscode.Uri {
    const make = (p: string): unknown => ({
        scheme: "file",
        path: p,
        query: "",
        fsPath: p,
        toString: () => `file:${p}`,
        with: (change: { path?: string }) => make(change.path ?? p),
    });
    return make(fsPath) as vscode.Uri;
}

/** Captures every host->webview post in order, and hands back the registered message handler. */
function makePanel(): {
    panel: vscode.WebviewPanel;
    posts: { type: string }[];
    deliver: (message: unknown) => Promise<void>;
} {
    const posts: { type: string }[] = [];
    let handler: ((message: unknown) => Promise<void> | void) | undefined;
    const panel = {
        webview: {
            options: {},
            html: "",
            cspSource: "vscode-resource:",
            asWebviewUri: (uri: { toString: () => string }) => uri,
            onDidReceiveMessage: (fn: (message: unknown) => Promise<void> | void) => {
                handler = fn;
                return { dispose: () => {} };
            },
            postMessage: (message: { type: string }) => {
                posts.push(message);
                return Promise.resolve(true);
            },
        },
        onDidDispose: () => ({ dispose: () => {} }),
    } as unknown as vscode.WebviewPanel;
    return {
        panel,
        posts,
        deliver: async (message: unknown) => {
            if (!handler) throw new Error("resolveCustomEditor never registered a message handler");
            await handler(message);
        },
    };
}

describe("the host's liveness signal on open", () => {
    beforeEach(() => {
        readFileMock.mockReset();
        // Only the .frm resolves: the open also probes for a sidecar .pal, and answering that with
        // the FRM's own bytes makes the palette parser throw before the message path is reached.
        readFileMock.mockImplementation((target: { fsPath: string }) =>
            target.fsPath.endsWith(".frm")
                ? Promise.resolve(serializeFrm(makeMiniFrm()))
                : Promise.reject(new Error(`no such file: ${target.fsPath}`)),
        );
    });

    it("posts `loading` before the decoded view, so a slow open is never silent", async () => {
        const provider = new ImageEditorProvider(context);
        const document = await provider.openCustomDocument(
            fileUri("/hero.frm"),
            { backupId: undefined, untitledDocumentData: undefined },
            token,
        );
        const { panel, posts, deliver } = makePanel();
        await provider.resolveCustomEditor(document, panel, token);

        await deliver({ type: "ready" });

        expect(posts.map((p) => p.type)).toEqual(["loading", "init"]);
    });

    it("carries no payload - it exists to prove the host is alive, nothing more", async () => {
        // The webview's own progress line counts tiles it has pixels for; a frame TOTAL here had no
        // reader once the open stopped being slow (see the dropped "Decoding N frames" placeholder).
        const provider = new ImageEditorProvider(context);
        const document = await provider.openCustomDocument(
            fileUri("/hero.frm"),
            { backupId: undefined, untitledDocumentData: undefined },
            token,
        );
        const { panel, posts, deliver } = makePanel();
        await provider.resolveCustomEditor(document, panel, token);

        await deliver({ type: "ready" });

        expect(posts[0]).toEqual({ type: "loading" });
    });
});

describe("what the open itself carries", () => {
    beforeEach(() => {
        readFileMock.mockReset();
        // Exactly one path resolves: opening a .bam also probes for its IE east companion, and any
        // answer to that would combine a pair and change the frame count under the assertions.
        readFileMock.mockImplementation((target: { fsPath: string }) =>
            target.fsPath === "/hero.bam"
                ? Promise.resolve(serializeBamV1(makeMultiFrameBam()))
                : Promise.reject(new Error(`no such file: ${target.fsPath}`)),
        );
    });

    it("packs pixels only for the frame each sequence shows first, not every frame", async () => {
        const provider = new ImageEditorProvider(context);
        const document = await provider.openCustomDocument(
            fileUri("/hero.bam"),
            { backupId: undefined, untitledDocumentData: undefined },
            token,
        );
        const { panel, posts, deliver } = makePanel();
        await provider.resolveCustomEditor(document, panel, token);

        await deliver({ type: "ready" });

        const init = posts.find((p) => p.type === "init") as { view: AnimationView } | undefined;
        if (!init) throw new Error("no init posted");
        const shown = new Set(init.view.sequences.map((s) => s.frameRefs[0]));
        // The fixture has more frames than sequences, so this distinguishes lazy from eager.
        expect(shown.size).toBeLessThan(init.view.frames.length);
        for (const [i, frame] of init.view.frames.entries()) {
            expect(framePixels(init.view.pixels, frame) !== undefined).toBe(shown.has(i));
        }
    });
});

describe("frames fetched after the open", () => {
    beforeEach(() => {
        readFileMock.mockReset();
        readFileMock.mockImplementation((target: { fsPath: string }) =>
            target.fsPath.endsWith(".frm")
                ? Promise.resolve(serializeFrm(makeMiniFrm()))
                : Promise.reject(new Error(`no such file: ${target.fsPath}`)),
        );
    });

    it("answers a request with the pixels of exactly the frames asked for", async () => {
        const provider = new ImageEditorProvider(context);
        const document = await provider.openCustomDocument(
            fileUri("/hero.frm"),
            { backupId: undefined, untitledDocumentData: undefined },
            token,
        );
        const { panel, posts, deliver } = makePanel();
        await provider.resolveCustomEditor(document, panel, token);
        await deliver({ type: "ready" });
        posts.length = 0;

        await deliver({ type: "requestFrames", indices: [2, 0] });

        const reply = posts[0] as { type: string; indices: number[]; frames: FrameView[]; pixels: ArrayBuffer };
        expect(reply.type).toBe("frames");
        // Answered in the order asked, so the webview can zip indices to frames without a lookup.
        expect(reply.indices).toEqual([2, 0]);
        const source = makeMiniFrm().frames;
        for (const [at, index] of reply.indices.entries()) {
            const frame = reply.frames[at];
            const expected = source[index];
            if (!frame || !expected) throw new Error(`no frame at ${index}`);
            expect(framePixels(reply.pixels, frame)).toEqual(expected.pixels);
        }
    });

    it("answers only for indices the document actually has, keeping the two lists in step", async () => {
        // The webview zips `indices` to `frames` by position, so a request carrying junk must not be
        // answered with lists of different lengths - and an index the document has no frame for must not
        // shift every later frame onto the wrong index.
        const provider = new ImageEditorProvider(context);
        const document = await provider.openCustomDocument(
            fileUri("/hero.frm"),
            { backupId: undefined, untitledDocumentData: undefined },
            token,
        );
        const { panel, posts, deliver } = makePanel();
        await provider.resolveCustomEditor(document, panel, token);
        await deliver({ type: "ready" });
        posts.length = 0;
        const frameCount = makeMiniFrm().frames.length;

        await deliver({ type: "requestFrames", indices: [frameCount, -1, 0.5, Number.NaN, 0] });

        const reply = posts[0] as { type: string; indices: number[]; frames: FrameView[]; pixels: ArrayBuffer };
        expect(reply.type).toBe("frames");
        expect(reply.indices).toEqual([0]);
        expect(reply.frames).toHaveLength(reply.indices.length);
        expect(framePixels(reply.pixels, reply.frames[0]!)).toEqual(makeMiniFrm().frames[0]!.pixels);
    });
});
