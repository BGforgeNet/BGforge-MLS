/**
 * The BAM v2 save path, driven through the provider - the only place where "which files does a save
 * write" is answered. A v2 is N+1 files: the `.bam` plus the `MOSxxxx.PVRZ` pages its data blocks
 * address, and whether the pages are written at all depends on where the save is going.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import type * as vscode from "vscode";
import { decodeBamV2, readBamV2Structure, serializeBamV1, serializeBamV2, type RgbaAnimation } from "@bgforge/image";
import { decodeBackup, encodeBackup } from "../../src/image-editor/backup";
import { makeMiniBam } from "./fixtures";

const { readFileMock, writeFileMock, showInputBoxMock, createDirectoryMock, showWarningMock, statMock } = vi.hoisted(
    () => ({
        readFileMock: vi.fn(),
        writeFileMock: vi.fn(),
        showInputBoxMock: vi.fn(),
        createDirectoryMock: vi.fn(),
        showWarningMock: vi.fn(),
        // fs.stat is how fileExists answers; rejecting means "no such file", which is the default.
        statMock: vi.fn((_target: { toString: () => string }): Promise<unknown> => Promise.reject(new Error("ENOENT"))),
    }),
);

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
            showWarningMessage: showWarningMock,
            showOpenDialog: vi.fn(),
            showInputBox: showInputBoxMock,
            setStatusBarMessage: vi.fn(),
        },
        workspace: {
            fs: {
                readFile: readFileMock,
                writeFile: writeFileMock,
                createDirectory: createDirectoryMock,
                stat: statMock,
            },
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

/** What an import leaves behind: frames carrying no PVRZ provenance, so a save must repack. */
function importedRgba(): RgbaAnimation {
    const pixels = new Uint8Array(2 * 2 * 4);
    for (let i = 0; i < 4; i++) pixels.set([16, 20, 24, 255], i * 4);
    return {
        colorModel: "rgba",
        frames: [{ width: 2, height: 2, pixels, offsetX: 0, offsetY: 0 }],
        sequences: [{ frameRefs: [0], facing: "none" }],
        meta: { sourceFormat: "bamv2", fps: 15 },
    };
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

// serializeBamV2 runs a real PVRZ page encode, which dominated this file's runtime when it ran per test.
// Encode once; each test still gets its own copies below, so nothing carries between them.
const encodedV2 = makeV2();

describe("saving a BAM v2", () => {
    let source: { bam: Uint8Array; page: Uint8Array };

    beforeEach(() => {
        source = { bam: new Uint8Array(encodedV2.bam), page: new Uint8Array(encodedV2.page) };
        readFileMock.mockReset();
        writeFileMock.mockReset();
        showWarningMock.mockReset();
        showInputBoxMock.mockReset();
        statMock.mockReset();
        statMock.mockImplementation(() => Promise.reject(new Error("ENOENT")));
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

    it("asks for a page number rather than failing when an edited v2 is saved in place", async () => {
        // An edit replaces the frames with ones no PVRZ page describes, so the save must allocate.
        // The in-place path has no prompt of its own, so before this guard it reached serializeBamV2
        // with nothing to allocate from and the save died on a library error the user could not act on.
        showInputBoxMock.mockResolvedValue("4300");
        const provider = new ImageEditorProvider(context);
        const document = await provider.openCustomDocument(uri("/data/MAPICONS.BAM"), openContext(), token);
        document.replaceSequences(importedRgba(), "replace");

        await provider.saveCustomDocument(document, token);

        expect(showInputBoxMock).toHaveBeenCalledTimes(1);
        const writes = writeFileMock.mock.calls.map((call: unknown[]) => String(call[0]));
        expect(writes).toEqual(["file:/data/MAPICONS.BAM", "file:/data/MOS4300.PVRZ"]);
    });

    it("backs up an edited v2 with its pages, so a hot-exit restore is not the pre-edit picture", async () => {
        // backup() serializes through the same path, so before the guard it threw and the pending
        // edits were lost on window close. The pages must ride along: they were never written to disk.
        showInputBoxMock.mockResolvedValue("4300");
        const provider = new ImageEditorProvider(context);
        const document = await provider.openCustomDocument(uri("/data/MAPICONS.BAM"), openContext(), token);
        document.replaceSequences(importedRgba(), "replace");
        document.setBasePage(4300);

        const backup = document.backup();

        expect(backup.pages?.map((p) => p.page)).toEqual([4300]);
        expect(decodeBackup(encodeBackup(backup)).pages?.[0]?.bytes).toEqual(backup.pages?.[0]?.bytes);
    });

    it("asks before a page write would replace a file already in the destination folder", async () => {
        // The pages are named by page NUMBER, not by the animation's name, so a copy into a folder
        // that already uses that range silently destroyed whatever owned it. Only the .bam was gated.
        showWarningMock.mockResolvedValue(undefined); // dismissed - not "Overwrite"
        const provider = new ImageEditorProvider(context);
        const document = await provider.openCustomDocument(uri("/data/MAPICONS.BAM"), openContext(), token);
        // The destination folder already holds the page number this file's blocks name.
        statMock.mockImplementation((target: { toString: () => string }) =>
            target.toString() === "file:/other/MOS4200.PVRZ"
                ? Promise.resolve({})
                : Promise.reject(new Error("ENOENT")),
        );

        await expect(provider.saveCustomDocumentAs(document, uri("/other/COPY.BAM"), token)).rejects.toThrow(
            /overwrite/i,
        );

        expect(writeFileMock).not.toHaveBeenCalled();
        expect(String(showWarningMock.mock.calls[0]?.[0])).toContain("MOS4200.PVRZ");
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
