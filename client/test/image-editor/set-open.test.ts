/**
 * Opening a whole animation set in the editor, rather than one of its files.
 *
 * A set address has no bytes of its own, so nothing in this path reads a file: the document is built from
 * the game the URI names. Both refusals are asserted, because a set that cannot open has to say which of
 * the two reasons applies - no such game, or no such files.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type * as vscode from "vscode";
import { type AnimationSet, type StanceIo } from "@bgforge/animation";
import { type Frame, type IndexedAnimation, type Rgba, serializeBamV1 } from "@bgforge/image";

const GAME_SCHEME = "bgforge-ie-resource";
const GAME_QUERY = "g=%2Fgames%2Fbgee";

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
        fsPath,
        query: "",
        toString: () => `file:${fsPath}`,
        with: (change: { path?: string }) => make(change.path ?? fsPath),
    });
    return {
        EventEmitter,
        Uri: { file: make },
        window: { showWarningMessage: vi.fn() },
        workspace: { fs: { readFile: readFileMock } },
    };
});

const { ImageEditorDocument } = await import("../../src/image-editor/document");
const { Uri } = await import("vscode");

/** A plain file document, for the negative half: everything set-shaped must be absent on one. */
function fileUri(fsPath: string): vscode.Uri {
    return Uri.file(fsPath);
}

/** A partial URI: the set path reads only these four members, and the mock supplies no `Uri` class. */
function setUri(hex: string): vscode.Uri {
    const uriPath = `/TEST_ANIM.animset`;
    const query = `${GAME_QUERY}&a=${hex}`;
    return {
        scheme: GAME_SCHEME,
        path: uriPath,
        query,
        fsPath: uriPath,
        toString: () => `${GAME_SCHEME}:${uriPath}?${query}`,
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
    beforeEach(() => {
        readFileMock.mockReset();
        readFileMock.mockRejectedValue(new Error("no such file"));
    });

    it("opens on the set's first action, without reading a file", async () => {
        const source = vi.fn(() => ({ kind: "set" as const, set: SET, io: ioFor({ TSTBG1: baseFileBam() }) }));

        const document = await ImageEditorDocument.open(setUri("1234"), undefined, undefined, source);

        expect(source).toHaveBeenCalledWith("/games/bgee", 0x1234);
        expect(document.setState?.action.resref).toBe("TSTBG1");
        expect(readFileMock).not.toHaveBeenCalled();
    });

    it("reloads from the game, never from the set address", async () => {
        const files: Record<string, Uint8Array> = { TSTBG1: baseFileBam() };
        const document = await ImageEditorDocument.open(setUri("1234"), undefined, undefined, () => ({
            kind: "set" as const,
            set: SET,
            io: ioFor(files),
        }));

        await document.reload();

        expect(document.setState?.action.resref).toBe("TSTBG1");
        expect(readFileMock).not.toHaveBeenCalled();
    });

    it("swaps the shown action, and reports a refusal for one the set does not draw", async () => {
        const document = await ImageEditorDocument.open(setUri("1234"), undefined, undefined, () => ({
            kind: "set" as const,
            set: SET,
            io: ioFor({ TSTBG1: baseFileBam(), TSTBG2: baseFileBam() }),
        }));

        expect(document.selectSetAction("TSTBG2")).toBe("changed");
        expect(document.toView().set?.action).toBe("TSTBG2");
        expect(document.selectSetAction("TSTBCA")).toBe("refused");
        expect(document.toView().set?.action).toBe("TSTBG2");
    });

    it("reports no set selection at all for a document opened on a file", async () => {
        readFileMock.mockResolvedValue(baseFileBam());

        const document = await ImageEditorDocument.open(fileUri("/art/TSTBG1.bam"));

        expect(document.setState).toBeUndefined();
        expect(document.toView().set).toBeUndefined();
        expect(document.selectSetAction("TSTBG1")).toBe("refused");
        expect(document.selectSetArmour(2)).toBe("refused");
    });

    it("asks for the game to be opened when it is not", async () => {
        const source = (): { kind: "no-game" } => ({ kind: "no-game" });
        await expect(ImageEditorDocument.open(setUri("1234"), undefined, undefined, source)).rejects.toThrow(
            "Open /games/bgee to show animation 0x1234.",
        );
    });

    it("says so for an id the open game does not declare", async () => {
        const source = (): { kind: "not-declared" } => ({ kind: "not-declared" });
        await expect(ImageEditorDocument.open(setUri("1234"), undefined, undefined, source)).rejects.toThrow(
            "This game declares no animation 0x1234.",
        );
    });

    it("refuses a set the install ships no files for, naming the animation", async () => {
        const source = (): { kind: "set"; set: AnimationSet; io: StanceIo } => ({
            kind: "set",
            set: SET,
            io: ioFor({}),
        });

        await expect(ImageEditorDocument.open(setUri("1234"), undefined, undefined, source)).rejects.toThrow(
            "This install ships no files for animation 0x1234.",
        );
    });
});
