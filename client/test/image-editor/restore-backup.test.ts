/**
 * Guards the animation editor's hot-exit restore. When VS Code re-opens a document that was dirty at
 * shutdown it passes back the backup it had asked us to write, and the restored document must carry
 * BOTH halves of the pending state: the edited animation and the external-palette toggle, which no
 * FRM stream expresses and which a plain reopen resets to on-disk-sidecar-wins. Drives the real
 * openCustomDocument through a mocked vscode, since the wiring is what the fix lives in.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import type * as vscode from "vscode";
import { combineIeBamPair, serializeBamV1, serializeFrm, serializePal, type Rgba } from "@bgforge/image";
import { encodeBackup } from "../../src/image-editor/backup";
import { makeIeBamBase, makeIeBamEast, makeMiniFrm } from "./fixtures";

const DOC_PATH = "/w/hero.frm";
const SIDECAR_PATH = "/w/hero.pal";
const BACKUP_PATH = "/storage/backups/hero.frm.bak";
const BASE_PATH = "/w/usar1ca.bam";
const EAST_PATH = "/w/usar1cae.bam";

const { readFileMock, showWarningMock } = vi.hoisted(() => ({ readFileMock: vi.fn(), showWarningMock: vi.fn() }));

vi.mock("vscode", () => {
    class EventEmitter {
        readonly event = (): { dispose: () => void } => ({ dispose: () => {} });
        fire(): void {}
        dispose(): void {}
    }
    // `with` is what the pair probe derives sibling members through, so the stand-in has to honour it.
    const uri = (fsPath: string): Record<string, unknown> => ({
        fsPath,
        path: fsPath,
        scheme: "file",
        toString: () => fsPath,
        with: (change: { path?: string }) => uri(change.path ?? fsPath),
    });
    return {
        EventEmitter,
        Uri: { file: uri, parse: uri },
        window: { showWarningMessage: showWarningMock },
        workspace: { fs: { readFile: readFileMock } },
    };
});

const { ImageEditorProvider } = await import("../../src/image-editor/provider");

// The provider reads only extensionUri off the context; a full ExtensionContext needs the live
// runtime, so stand in with the one member the code under test touches.
const context = { extensionUri: { fsPath: "/ext" } } as unknown as vscode.ExtensionContext;
const token = {} as vscode.CancellationToken;

function fileUri(fsPath: string): vscode.Uri {
    return {
        fsPath,
        path: fsPath,
        scheme: "file",
        toString: () => fsPath,
        with: (change: { path?: string }) => fileUri(change.path ?? fsPath),
    } as unknown as vscode.Uri;
}

function openContext(backupId?: string): vscode.CustomDocumentOpenContext {
    return { backupId, untitledDocumentData: undefined };
}

// A sidecar on disk makes the external palette auto-on at open, so a backup taken with it toggled OFF
// is only honoured if the restore replays the flag rather than re-deriving it from the file.
function sidecar(): Uint8Array {
    const pal: Rgba[] = Array.from({ length: 256 }, () => ({ r: 10, g: 20, b: 30, a: 255 }));
    return serializePal(pal);
}

/** The pending edit: the on-disk animation with its frame rate changed. */
function editedFrm(): Uint8Array {
    const animation = makeMiniFrm();
    return serializeFrm({ ...animation, meta: { ...animation.meta, fps: 25 } });
}

/** The pending edit to a paired document: the combined animation with a new transparent index. */
function editedPair(): Uint8Array {
    const combined = combineIeBamPair(makeIeBamBase(), makeIeBamEast());
    if (!combined) throw new Error("fixture pair did not combine");
    return serializeBamV1({ ...combined, meta: { ...combined.meta, transparentIndex: 5 } });
}

describe("animation editor hot-exit restore", () => {
    let files: Map<string, Uint8Array>;

    beforeEach(() => {
        files = new Map([
            [DOC_PATH, serializeFrm(makeMiniFrm())],
            [SIDECAR_PATH, sidecar()],
            [BACKUP_PATH, encodeBackup({ bytes: editedFrm(), externalPalette: false })],
        ]);
        readFileMock.mockReset();
        showWarningMock.mockReset();
        readFileMock.mockImplementation((target: { fsPath: string }) => {
            const bytes = files.get(target.fsPath);
            return bytes ? Promise.resolve(bytes) : Promise.reject(new Error(`no such file: ${target.fsPath}`));
        });
    });

    /**
     * `decodeBackup` fails loud on a header it cannot read, and a version mismatch is an EXPECTED condition -
     * the container is versioned precisely because a backup outlives the extension that wrote it. So the
     * caller has to absorb it: the unsaved edits are gone either way, and propagating would make the saved
     * file unopenable too. Covers both halves of the restore read, since the throw can come from either.
     */
    it.each([
        ["an unreadable backup file", () => files.delete(BACKUP_PATH)],
        ["a backup this version cannot decode", () => files.set(BACKUP_PATH, new Uint8Array([0x7b, 0x0a, 0x01]))],
    ])("falls back to the saved file, with a warning, on %s", async (_label, breakBackup) => {
        breakBackup();
        const provider = new ImageEditorProvider(context);

        const document = await provider.openCustomDocument(fileUri(DOC_PATH), openContext(BACKUP_PATH), token);

        // The on-disk animation, not the pending edit: fps 10 and the sidecar's auto-on palette.
        expect(document.toView().meta.fps).toBe(10);
        expect(document.toView().externalPaletteActive).toBe(true);
        expect(document.saveUri.fsPath).toBe(DOC_PATH);
        expect(showWarningMock).toHaveBeenCalledTimes(1);
        expect(String(showWarningMock.mock.calls[0]?.[0])).toContain("hero.frm");
    });

    // The fallback is for a broken BACKUP, not a broken file: with no backup in play an unreadable document
    // still fails the open rather than being swallowed into an empty editor.
    it("still fails the open when the file itself cannot be read", async () => {
        files.delete(DOC_PATH);
        const provider = new ImageEditorProvider(context);

        await expect(provider.openCustomDocument(fileUri(DOC_PATH), openContext(), token)).rejects.toThrow(
            /no such file/,
        );
    });

    it("restores the edited animation and the palette toggle from the backup", async () => {
        const provider = new ImageEditorProvider(context);

        const document = await provider.openCustomDocument(fileUri(DOC_PATH), openContext(BACKUP_PATH), token);
        const view = document.toView();

        expect(view.meta.fps).toBe(25);
        // The sidecar is still read from disk (it is real, and the edit never touched it) - but the
        // pending "external palette off" wins over the auto-on it would otherwise trigger.
        expect(view.hasSidecarPal).toBe(true);
        expect(view.externalPaletteActive).toBe(false);
        // Identity stays on the real file so a subsequent save writes there, not into the backup.
        expect(document.saveUri.fsPath).toBe(DOC_PATH);
    });

    it("reads the file itself when opening without a backup", async () => {
        const provider = new ImageEditorProvider(context);

        const document = await provider.openCustomDocument(fileUri(DOC_PATH), openContext(), token);
        const view = document.toView();

        expect(view.meta.fps).toBe(10);
        expect(view.externalPaletteActive).toBe(true);
    });

    // The riskiest branch: the backup holds ONE combined animation while the identity that decides where a
    // save lands is re-derived from the two files on disk. Lose the pair here and a save writes the combined
    // animation over the base member alone, corrupting both halves of the set.
    it("keeps the base/east pair identity while restoring the edited animation", async () => {
        files.set(BASE_PATH, serializeBamV1(makeIeBamBase()));
        files.set(EAST_PATH, serializeBamV1(makeIeBamEast()));
        files.set(BACKUP_PATH, encodeBackup({ bytes: editedPair(), externalPalette: false }));
        const provider = new ImageEditorProvider(context);

        const document = await provider.openCustomDocument(fileUri(BASE_PATH), openContext(BACKUP_PATH), token);

        expect(document.toView().meta.transparentIndex).toBe(5);
        expect(document.saveUri.fsPath).toBe(BASE_PATH);
        expect(document.pairSaveWrites()?.map((w) => w.uri.fsPath)).toEqual([BASE_PATH, EAST_PATH]);
    });
});
