/**
 * The BAM v2 save path, driven through the provider - the only place where "which files does a save
 * write" is answered. A v2 is N+1 files: the `.bam` plus the `MOSxxxx.PVRZ` pages its data blocks
 * address, and whether the pages are written at all depends on where the save is going.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import type * as vscode from "vscode";
import { serializeBamV2, type RgbaAnimation } from "@bgforge/image";

const { readFileMock, writeFileMock } = vi.hoisted(() => ({ readFileMock: vi.fn(), writeFileMock: vi.fn() }));

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
        window: { showWarningMessage: vi.fn(), showOpenDialog: vi.fn() },
        workspace: { fs: { readFile: readFileMock, writeFile: writeFileMock } },
    };
});

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
