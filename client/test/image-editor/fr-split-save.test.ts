/**
 * Guards that saving a Fallout `.fr0`-`.fr5` critter writes that set back, rather than collapsing it
 * into a single combined `<base>.frm`. The set is combined on open, so nothing below the provider
 * knows it was ever six files - which is exactly why the wiring, not the split maths, is what this
 * drives. The split itself is covered against the real corpus in the image package.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import type * as vscode from "vscode";
import {
    type IndexedAnimation,
    combineFrmDirections,
    FRM_FACINGS,
    serializeFrm,
    serializePal,
    type Rgba,
} from "@bgforge/image";
import { makeMiniFrm } from "./fixtures";

const DIR = "/art/critters";
const MEMBER_PATHS = FRM_FACINGS.map((_, d) => `${DIR}/haenrobd.fr${d}`);
const COMBINED_PATH = `${DIR}/haenrobd.frm`;
const SIDECAR_PATH = `${DIR}/haenrobd.pal`;

const { readFileMock, writeFileMock } = vi.hoisted(() => ({ readFileMock: vi.fn(), writeFileMock: vi.fn() }));

vi.mock("vscode", () => {
    class Disposable {
        readonly dispose: () => void;
        constructor(onDispose: () => void) {
            this.dispose = onDispose;
        }
    }
    class EventEmitter {
        readonly event = (): { dispose: () => void } => ({ dispose: () => {} });
        fire(): void {}
        dispose(): void {}
    }
    const uri = (fsPath: string): Record<string, unknown> => ({
        fsPath,
        path: fsPath,
        scheme: "file",
        toString: () => fsPath,
        with: (change: { path?: string }) => uri(change.path ?? fsPath),
    });
    return {
        EventEmitter,
        Disposable,
        Uri: { file: uri, parse: uri },
        window: { showWarningMessage: vi.fn(), setStatusBarMessage: vi.fn() },
        workspace: { fs: { readFile: readFileMock, writeFile: writeFileMock } },
    };
});

const { ImageEditorProvider } = await import("../../src/image-editor/provider");

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

/**
 * The animation the fixture set draws: facing d's one frame carries pixel value d, and each facing
 * takes a distinct header offset so a save that shuffles the facings is visible rather than silent.
 */
function sourceAnimation(): IndexedAnimation {
    const mini = makeMiniFrm();
    return { ...mini, meta: { ...mini.meta, dirOffsetsX: [0, 1, 2, 3, 4, 5], dirOffsetsY: [5, 4, 3, 2, 1, 0] } };
}

/**
 * One `.frN` of the fixture set, built the way a modding tool splits a critter rather than through the
 * editor's own splitter - a set built by the code under test could not show that code wrong.
 */
function splitMember(anim: IndexedAnimation, d: number): Uint8Array {
    const frame = anim.frames[d];
    if (frame === undefined) throw new Error(`fixture has no frame for facing ${d}`);
    return serializeFrm({
        palette: anim.palette,
        frames: [frame],
        sequences: FRM_FACINGS.map((facing) => ({ frameRefs: [0], facing })),
        meta: {
            ...anim.meta,
            dirOffsetsX: FRM_FACINGS.map(() => anim.meta.dirOffsetsX?.[d] ?? 0),
            dirOffsetsY: FRM_FACINGS.map(() => anim.meta.dirOffsetsY?.[d] ?? 0),
        },
    });
}

/** What each facing draws, as the combiner reads it back: the pixel value and the header offsets. */
function facings(anim: IndexedAnimation): { px: number | undefined; x: number | undefined }[] {
    return FRM_FACINGS.map((_, d) => {
        const ref = anim.sequences[d]?.frameRefs[0];
        return {
            px: ref === undefined ? undefined : anim.frames[ref]?.pixels[0],
            x: anim.meta.dirOffsetsX?.[d],
        };
    });
}

describe("saving a Fallout .fr0-.fr5 split set", () => {
    let files: Map<string, Uint8Array>;
    let written: Map<string, Uint8Array>;

    beforeEach(() => {
        const source = sourceAnimation();
        files = new Map(MEMBER_PATHS.map((p, d) => [p, splitMember(source, d)]));
        written = new Map();
        readFileMock.mockReset();
        readFileMock.mockImplementation((uri: { fsPath: string }) => {
            const bytes = files.get(uri.fsPath);
            if (bytes === undefined) throw new Error(`ENOENT ${uri.fsPath}`);
            return Promise.resolve(bytes);
        });
        writeFileMock.mockReset();
        writeFileMock.mockImplementation((uri: { fsPath: string }, bytes: Uint8Array) => {
            written.set(uri.fsPath, bytes);
            return Promise.resolve();
        });
    });

    type OpenedSet = {
        provider: InstanceType<typeof ImageEditorProvider>;
        document: Awaited<ReturnType<InstanceType<typeof ImageEditorProvider>["openCustomDocument"]>>;
    };

    const openSet = async (): Promise<OpenedSet> => {
        const provider = new ImageEditorProvider(context);
        const openContext = { backupId: undefined, untitledDocumentData: undefined };
        const document = await provider.openCustomDocument(fileUri(MEMBER_PATHS[0] ?? ""), openContext, token);
        return { provider, document };
    };

    it("writes the six members back, and never the combined .frm", async () => {
        const { provider, document } = await openSet();

        await provider.saveCustomDocument(document, token);

        expect([...written.keys()].sort()).toEqual([...MEMBER_PATHS].sort());
        expect(written.has(COMBINED_PATH)).toBe(false);
    });

    it("keeps each facing on its own member, offsets included", async () => {
        const { provider, document } = await openSet();

        await provider.saveCustomDocument(document, token);

        // Read the written set back through the combiner - the consumer that opens it next time.
        const reopened = combineFrmDirections(MEMBER_PATHS.map((p) => written.get(p)));
        expect(facings(reopened)).toEqual(facings(sourceAnimation()));
    });

    it("carries an edit into the member whose facing it belongs to", async () => {
        const { provider, document } = await openSet();
        document.applyMetaPatch({ fps: 25 });

        await provider.saveCustomDocument(document, token);

        const reopened = combineFrmDirections(MEMBER_PATHS.map((p) => written.get(p)));
        expect(reopened.meta.fps).toBe(25);
        expect(facings(reopened)).toEqual(facings(sourceAnimation()));
    });

    it("leaves a facing the set never had absent rather than writing an empty member", async () => {
        files.delete(MEMBER_PATHS[3] ?? "");
        const { provider, document } = await openSet();

        await provider.saveCustomDocument(document, token);

        expect(written.has(MEMBER_PATHS[3] ?? "")).toBe(false);
        expect([...written.keys()].sort()).toEqual(MEMBER_PATHS.filter((_, d) => d !== 3).sort());
    });

    // The other half of the save/export split: the set's own address IS the combined `<base>.frm`, so
    // nothing about the destination distinguishes a Save As aimed there from the document saving
    // itself. A Save As must still write the one file it names.
    it("writes a single combined file for a Save As, even when it names the set's own address", async () => {
        const { provider, document } = await openSet();

        await provider.saveCustomDocumentAs(document, fileUri(COMBINED_PATH), token);

        expect([...written.keys()]).toEqual([COMBINED_PATH]);
        for (const member of MEMBER_PATHS) expect(written.has(member)).toBe(false);
    });

    it("writes the palette sidecar under the set's combined name, after the members", async () => {
        const pal: Rgba[] = Array.from({ length: 256 }, () => ({ r: 10, g: 20, b: 30, a: 255 }));
        files.set(SIDECAR_PATH, serializePal(pal));
        const { provider, document } = await openSet();

        await provider.saveCustomDocument(document, token);

        // The sidecar accompanies the six members, not a combined file - naming it alone would pass
        // just as well against a save that collapsed the set, which is the defect this file guards.
        expect([...written.keys()].sort()).toEqual([...MEMBER_PATHS, SIDECAR_PATH].sort());
        // Last, so a crash never leaves a palette describing members that were never rewritten.
        expect([...written.keys()].at(-1)).toBe(SIDECAR_PATH);
    });
});
