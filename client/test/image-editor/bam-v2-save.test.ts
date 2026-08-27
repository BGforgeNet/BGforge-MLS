/**
 * The BAM v2 save path, driven through the provider - the only place where "which files does a save
 * write" is answered. A v2 is N+1 files: the `.bam` plus the `MOSxxxx.PVRZ` pages its data blocks
 * address, and whether the pages are written at all depends on where the save is going.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import type * as vscode from "vscode";
import { decodeBamV2, readBamV2Structure, serializeBamV1, serializeBamV2, type RgbaAnimation } from "@bgforge/image";
import { makeMiniBam } from "./fixtures";

const { readFileMock, writeFileMock, showInputBoxMock, createDirectoryMock } = vi.hoisted(() => ({
    readFileMock: vi.fn(),
    writeFileMock: vi.fn(),
    showInputBoxMock: vi.fn(),
    createDirectoryMock: vi.fn(),
}));

vi.mock("vscode", () => {
    class EventEmitter {
        readonly event = (): { dispose: () => void } => ({ dispose: () => {} });
        fire(): void {}
        dispose(): void {}
    }
    const make = (uriPath: string): Record<string, unknown> => ({
        scheme: "file",
        path: uriPath,
        query: "",
        fsPath: uriPath,
        toString: () => `file:${uriPath}`,
        with: (change: { path?: string }) => make(change.path ?? uriPath),
    });
    return {
        EventEmitter,
        Uri: {
            file: (fsPath: string) => make(fsPath),
            parse: (value: string) => make(value),
            joinPath: (base: { path: string }, ...parts: string[]) => make([base.path, ...parts].join("/")),
        },
        window: {
            showWarningMessage: vi.fn(),
            showOpenDialog: vi.fn(),
            showInputBox: showInputBoxMock,
            setStatusBarMessage: vi.fn(),
        },
        workspace: {
            fs: { readFile: readFileMock, writeFile: writeFileMock, createDirectory: createDirectoryMock },
        },
    };
});

// The webview's HTML and bundled JS are read off disk, and the JS is a BUILD artifact the unit
// phase runs before. Stubbed so the message channel - the thing under test here - can be opened
// without one; client/test/webview-csp.test.ts is what covers the real asset wiring.
vi.mock("../../src/webview-assets", () => ({
    getCachedHtmlAsset: () => "<html>{{cspSource}}{{nonce}}</html>",
    getCachedJsAsset: () => "",
    generateNonce: () => "nonce",
    inlineWebviewScript: (html: string) => html,
}));

const { ImageEditorProvider } = await import("../../src/image-editor/provider");

const context = { extensionUri: { fsPath: "/ext" } } as unknown as vscode.ExtensionContext;
const token = {} as vscode.CancellationToken;

function openContext(): vscode.CustomDocumentOpenContext {
    return { backupId: undefined, untitledDocumentData: undefined };
}

function uri(uriPath: string): vscode.Uri {
    const make = (p: string): unknown => ({
        scheme: "file",
        path: p,
        query: "",
        fsPath: p,
        toString: () => `file:${p}`,
        with: (change: { path?: string }) => make(change.path ?? p),
    });
    return make(uriPath) as vscode.Uri;
}

/** A one-frame v2, written through the real serializer so the file and its page genuinely match. */
function makeV2(): { bam: Uint8Array; page: Uint8Array } {
    const pixels = new Uint8Array(4 * 4 * 4);
    for (let i = 0; i < 16; i++) pixels.set([255, 0, 0, 255], i * 4);
    const animation: RgbaAnimation = {
        colorModel: "rgba",
        frames: [{ width: 4, height: 4, pixels, offsetX: 2, offsetY: 2 }],
        sequences: [{ frameRefs: [0], facing: "none" }],
        meta: { sourceFormat: "bamv2", fps: 15 },
    };
    const written = serializeBamV2(animation, { basePage: 4200 });
    const page = written.pages[0];
    if (page === undefined) throw new Error("expected one page");
    return { bam: written.bam, page: page.bytes };
}

describe("saving a BAM v2", () => {
    let source: { bam: Uint8Array; page: Uint8Array };

    beforeEach(() => {
        source = makeV2();
        readFileMock.mockReset();
        writeFileMock.mockReset();
        const files = new Map<string, Uint8Array>([
            ["file:/data/MAPICONS.BAM", source.bam],
            ["file:/data/MOS4200.PVRZ", source.page],
        ]);
        readFileMock.mockImplementation((target: { toString: () => string }) => {
            const bytes = files.get(target.toString());
            return bytes ? Promise.resolve(bytes) : Promise.reject(new Error(`no such file: ${target}`));
        });
    });

    it("writes the .bam alone in place, leaving the pages it did not touch", async () => {
        // Rewriting an untouched page would push it through a lossy block encoder for nothing.
        const provider = new ImageEditorProvider(context);
        const document = await provider.openCustomDocument(uri("/data/MAPICONS.BAM"), openContext(), token);

        await provider.saveCustomDocument(document, token);

        const writes = writeFileMock.mock.calls.map((call: unknown[]) => String(call[0]));
        expect(writes).toEqual(["file:/data/MAPICONS.BAM"]);
        expect(writeFileMock.mock.calls[0]?.[1]).toEqual(source.bam);
    });

    it("carries the pages along on a Save As, since the new folder has none of them", async () => {
        // Without this the copy is a file whose data blocks address pages that are not there: it
        // opens to an error, or in the game to nothing at all.
        const provider = new ImageEditorProvider(context);
        const document = await provider.openCustomDocument(uri("/data/MAPICONS.BAM"), openContext(), token);

        await provider.saveCustomDocumentAs(document, uri("/other/COPY.BAM"), token);

        const writes = writeFileMock.mock.calls.map((call: unknown[]) => String(call[0]));
        expect(writes).toEqual(["file:/other/COPY.BAM", "file:/other/MOS4200.PVRZ"]);
        // Verbatim, not re-encoded - the bytes the page was read from.
        expect(writeFileMock.mock.calls[1]?.[1]).toEqual(source.page);
    });
});

/** A fake webview panel, so a Save As can be driven the way the toolbar drives it: by message. */
function makePanel(): { panel: vscode.WebviewPanel; send: (m: unknown) => Promise<void> } {
    let handler: (m: unknown) => Promise<void> | void = () => {};
    const panel = {
        webview: {
            options: {},
            html: "",
            cspSource: "vscode-webview:",
            asWebviewUri: (u: unknown) => u,
            onDidReceiveMessage: (h: (m: unknown) => Promise<void> | void) => {
                handler = h;
                return { dispose: vi.fn() };
            },
            postMessage: vi.fn(async () => true),
        },
        onDidDispose: () => ({ dispose: vi.fn() }),
    };
    return { panel: panel as unknown as vscode.WebviewPanel, send: async (m) => void (await handler(m)) };
}

describe("saving another format as a BAM v2", () => {
    beforeEach(() => {
        readFileMock.mockReset();
        writeFileMock.mockReset();
        showInputBoxMock.mockReset();
        createDirectoryMock.mockReset();
        createDirectoryMock.mockResolvedValue(undefined);
        readFileMock.mockImplementation((target: { toString: () => string }) =>
            target.toString() === "file:/data/HERO.BAM"
                ? Promise.resolve(serializeBamV1(makeMiniBam()))
                : Promise.reject(new Error(`no such file: ${target}`)),
        );
    });

    async function openAndSaveAsV2(): Promise<void> {
        const provider = new ImageEditorProvider(context);
        const document = await provider.openCustomDocument(uri("/data/HERO.BAM"), openContext(), token);
        const { panel, send } = makePanel();
        await provider.resolveCustomEditor(document, panel, token);
        await send({ type: "saveAs", target: "bamv2" });
    }

    it("asks which PVRZ page to start at, then writes the .bam and that page", async () => {
        // The frames come from a palette, not from any page, so the save has to allocate - and the
        // page number is the one thing the editor cannot work out for itself.
        showInputBoxMock.mockResolvedValue("4200");

        await openAndSaveAsV2();

        const writes = writeFileMock.mock.calls.map((call: unknown[]) => String(call[0]));
        expect(writes).toEqual(["file:/data/HERO.bam", "file:/data/MOS4200.PVRZ"]);
        expect(showInputBoxMock).toHaveBeenCalledTimes(1);
    });

    it("writes a file that reads back as a v2 whose frames resolve against the page it wrote", async () => {
        // The observable is the decoded pixel: a .bam with a plausible header whose blocks point at
        // the wrong place in the page opens to garbage, and every structural check passes anyway.
        showInputBoxMock.mockResolvedValue("4200");

        await openAndSaveAsV2();

        const [bamBytes, pageBytes] = writeFileMock.mock.calls.map((call: unknown[]) => call[1] as Uint8Array);
        if (!bamBytes || !pageBytes) throw new Error("expected two writes");
        const decoded = decodeBamV2(readBamV2Structure(bamBytes), () => pageBytes);
        const original = makeMiniBam();
        const sourceFrame = original.frames[0];
        const frame = decoded.frames[0];
        if (frame === undefined || sourceFrame === undefined) throw new Error("expected a frame");
        expect([frame.width, frame.height]).toEqual([sourceFrame.width, sourceFrame.height]);
        const expected = original.palette[sourceFrame.pixels[0] ?? 0];
        if (expected === undefined) throw new Error("expected a palette entry");
        expect([...frame.pixels.subarray(0, 3)]).toEqual([expected.r, expected.g, expected.b]);
    });

    it("writes nothing when the page prompt is dismissed", async () => {
        // Dismissing a prompt cancels the save; writing a .bam whose pages were never chosen would
        // leave a file pointing at whatever happened to be at those numbers.
        showInputBoxMock.mockResolvedValue(undefined);

        await openAndSaveAsV2();

        expect(writeFileMock).not.toHaveBeenCalled();
    });
});
