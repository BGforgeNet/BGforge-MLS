/**
 * Opening a whole animation set in the editor, rather than one of its files.
 *
 * A set address has no bytes of its own, so nothing in this path reads a file: the document is built from
 * the game the URI names. Both refusals are asserted, because a set that cannot open has to say which of
 * the two reasons applies - no such game, or no such files.
 */
import { describe, expect, it, vi } from "vitest";
import type * as vscode from "vscode";
import { type AnimationSet, type StanceIo } from "@bgforge/animation";
import { type Frame, type IndexedAnimation, type Rgba, serializeBamV1 } from "@bgforge/image";

const GAME_SCHEME = "bgforge-ie-resource";
const GAME_QUERY = "g=%2Fgames%2Fbgee";

vi.mock("vscode", () => {
    class EventEmitter {
        readonly event = (): { dispose: () => void } => ({ dispose: () => {} });
        fire(): void {}
        dispose(): void {}
    }
    return {
        EventEmitter,
        Uri: { file: (fsPath: string) => ({ scheme: "file", path: fsPath, fsPath, query: "" }) },
        window: { showWarningMessage: vi.fn() },
        workspace: { fs: { readFile: vi.fn() } },
    };
});

const { ImageEditorDocument } = await import("../../src/image-editor/document");
// The mocked module, for asserting that the set path never reaches the filesystem.
const { workspace } = await import("vscode");

/** A partial URI: the set path reads only these four members, and the mock supplies no `Uri` class. */
function setUri(hex: string): vscode.Uri {
    const uriPath = `/${hex}.animset`;
    return {
        scheme: GAME_SCHEME,
        path: uriPath,
        query: GAME_QUERY,
        fsPath: uriPath,
        toString: () => `${GAME_SCHEME}:${uriPath}?${GAME_QUERY}`,
    } as unknown as vscode.Uri;
}

function palette(): Rgba[] {
    return Array.from({ length: 256 }, (_, i) => ({ r: i, g: i, b: i, a: 255 }));
}

/** One 8-cycle block, five slots drawn and three padded - the shape the direction interpreter reads. */
function baseFileBam(): Uint8Array {
    const frame = (seed: number): Frame => ({
        width: 2,
        height: 2,
        pixels: new Uint8Array([seed, seed, seed, seed]),
        offsetX: 1,
        offsetY: 1,
    });
    const frames: Frame[] = [frame(0)];
    const sequences = [];
    for (let slot = 0; slot < 8; slot++) {
        if (slot < 5) {
            const first = frames.length;
            frames.push(frame(first), frame(first + 1));
            sequences.push({ frameRefs: [first, first + 1], facing: "none" as const });
        } else {
            sequences.push({ frameRefs: [0, 0], facing: "none" as const });
        }
    }
    const animation: IndexedAnimation = { palette: palette(), sequences, frames, meta: { sourceFormat: "bam" } };
    return serializeBamV1(animation);
}

const SET: AnimationSet = {
    id: 0x1234,
    code: "TST",
    name: "TEST_ANIM",
    prefixByArmour: new Map([[1, "TSTB"]]),
    paperdollPrefix: undefined,
    scheme: { kind: "unimplemented", scheme: 1, reason: "the monster scheme is not implemented yet" },
    layout: "cycles",
};

function ioFor(files: Record<string, Uint8Array>): StanceIo {
    return {
        exists: (resref) => Object.hasOwn(files, resref.toUpperCase()),
        read: (resref) => files[resref.toUpperCase()],
    };
}

describe("opening an animation set", () => {
    it("opens on the set's first action, without reading a file", async () => {
        const source = vi.fn(() => ({ set: SET, io: ioFor({ TSTBG1: baseFileBam() }) }));

        const document = await ImageEditorDocument.open(setUri("1234"), undefined, undefined, source);

        expect(source).toHaveBeenCalledWith("/games/bgee", 0x1234);
        expect(document.setState?.action.resref).toBe("TSTBG1");
        expect(workspace.fs.readFile).not.toHaveBeenCalled();
    });

    it("reloads from the game, never from the set address", async () => {
        const files: Record<string, Uint8Array> = { TSTBG1: baseFileBam() };
        const document = await ImageEditorDocument.open(setUri("1234"), undefined, undefined, () => ({
            set: SET,
            io: ioFor(files),
        }));

        await document.reload();

        expect(document.setState?.action.resref).toBe("TSTBG1");
        expect(workspace.fs.readFile).not.toHaveBeenCalled();
    });

    it("refuses a set no open game declares, naming the animation", async () => {
        await expect(ImageEditorDocument.open(setUri("1234"), undefined, undefined, () => undefined)).rejects.toThrow(
            "No open game declares animation 0x1234.",
        );
    });

    it("refuses a set the install ships no files for, naming the animation", async () => {
        const source = (): { set: AnimationSet; io: StanceIo } => ({ set: SET, io: ioFor({}) });

        await expect(ImageEditorDocument.open(setUri("1234"), undefined, undefined, source)).rejects.toThrow(
            "This install ships no files for animation 0x1234.",
        );
    });
});
