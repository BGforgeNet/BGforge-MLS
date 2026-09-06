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
import type { AnimationSetLookup, AnimationSetSource } from "../../src/image-editor/set-document";
import { type Frame, type IndexedAnimation, type Rgba, serializeBamV1 } from "@bgforge/image";

const GAME_SCHEME = "bgforge-ie-resource";
const GAME_QUERY = "g=%2Fgames%2Fbgee";

const { readFileMock } = vi.hoisted(() => ({ readFileMock: vi.fn() }));

vi.mock("vscode", () => {
    // The provider hands one back from `attach`, so the surfaces showing a document can be detached.
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
        Disposable,
        Uri: {
            file: make,
            // The set save addresses each member by its own resource URI, which is built this way.
            from: (parts: { scheme: string; path: string; query: string }) => ({
                ...make(parts.path),
                scheme: parts.scheme,
                query: parts.query,
                toString: () => `${parts.scheme}:${parts.path}?${parts.query}`,
            }),
        },
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

/** The set source as the editor takes it: a lookup plus the list its own set picker offers. */
function setSource(lookup: AnimationSetSource["lookup"]): AnimationSetSource {
    return { lookup, list: () => [SET] };
}

/** The lookup's answer for a set that resolves, carrying the install it was read from. */
function found(set: AnimationSet, io: StanceIo): AnimationSetLookup {
    return { kind: "set", set, io, flavour: "tob" };
}

/** The two members most of these need: one to open on, one to swap to. */
function twoMembers(): Record<string, Uint8Array> {
    return { TSTBG1: baseFileBam(), TSTBG2: baseFileBam() };
}

describe("opening an animation set", () => {
    beforeEach(() => {
        readFileMock.mockReset();
        readFileMock.mockRejectedValue(new Error("no such file"));
    });

    it("opens on the set's first action, without reading a file", async () => {
        const lookup = vi.fn(() => found(SET, ioFor({ TSTBG1: baseFileBam() })));
        const source = setSource(lookup);

        const document = await ImageEditorDocument.open(setUri("1234"), undefined, undefined, source);

        expect(lookup).toHaveBeenCalledWith("/games/bgee", 0x1234);
        expect(document.setState?.action.resref).toBe("TSTBG1");
        expect(readFileMock).not.toHaveBeenCalled();
    });

    it("reloads from the game, never from the set address", async () => {
        const files: Record<string, Uint8Array> = { TSTBG1: baseFileBam() };
        const document = await ImageEditorDocument.open(
            setUri("1234"),
            undefined,
            undefined,
            setSource(() => found(SET, ioFor(files))),
        );

        await document.reload();

        expect(document.setState?.action.resref).toBe("TSTBG1");
        expect(readFileMock).not.toHaveBeenCalled();
    });

    it("swaps the shown action, and reports a refusal for one the set does not draw", async () => {
        const document = await ImageEditorDocument.open(
            setUri("1234"),
            undefined,
            undefined,
            setSource(() => found(SET, ioFor(twoMembers()))),
        );

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

    it("writes only the members the reader changed", async () => {
        const document = await ImageEditorDocument.open(
            setUri("1234"),
            undefined,
            undefined,
            setSource(() => found(SET, ioFor(twoMembers()))),
        );

        // Nothing edited yet: a set save must not copy every member into the override folder.
        expect(document.setSaveWrites()).toEqual([]);

        document.applyMetaPatch({ transparentIndex: 3 });

        const writes = document.setSaveWrites() ?? [];
        expect(writes.map((write) => write.uri.path)).toEqual(["/tstbg1.bam"]);
        expect(writes[0]?.bytes.byteLength).toBeGreaterThan(0);
    });

    /**
     * A quadrant member's model is four files composed into one picture. Writing it back means cutting it
     * up again, which this path cannot do - so it says so rather than writing the whole composition over
     * the first quarter.
     */
    it("refuses in place to save a member drawn from several files", async () => {
        const quadrant: AnimationSet = { ...SET, layout: "quadrant" };
        const files = Object.fromEntries([1, 2, 3, 4].map((part) => [`TSTBG1${part}`, baseFileBam()] as const));
        const document = await ImageEditorDocument.open(
            setUri("1234"),
            undefined,
            undefined,
            setSource(() => found(quadrant, ioFor(files))),
        );
        document.applyMetaPatch({ transparentIndex: 3 });

        expect(() => document.setSaveWrites()).toThrow(/drawn from 4 files/);
    });

    it("has no set writes for a document opened on a file", async () => {
        readFileMock.mockResolvedValue(baseFileBam());
        const document = await ImageEditorDocument.open(fileUri("/art/TSTBG1.bam"));

        expect(document.setSaveWrites()).toBeUndefined();
    });

    it("carries every changed member through a hot-exit backup", async () => {
        const source = setSource(() => found(SET, ioFor(twoMembers())));
        const document = await ImageEditorDocument.open(setUri("1234"), undefined, undefined, source);
        document.applyMetaPatch({ transparentIndex: 3 });
        document.selectSetAction("TSTBG2");
        document.applyMetaPatch({ transparentIndex: 5 });

        const backup = document.backup();
        expect(backup.members?.map((member) => member.resref)).toEqual(["TSTBG1", "TSTBG2"]);

        // Restored over a set read fresh from the game: the unsaved members go back on top of it, so a
        // save after the restore still writes exactly them - carrying the edit, not the archive's copy.
        const restored = await ImageEditorDocument.open(setUri("1234"), backup, undefined, source);
        expect(restored.setSaveWrites()?.map((write) => write.uri.path)).toEqual(["/tstbg1.bam", "/tstbg2.bam"]);
        expect(restored.animation.meta.transparentIndex).toBe(3);
        restored.selectSetAction("TSTBG2");
        expect(restored.animation.meta.transparentIndex).toBe(5);
    });

    it("asks for the game to be opened when it is not", async () => {
        const source = setSource(() => ({ kind: "no-game" }));
        await expect(ImageEditorDocument.open(setUri("1234"), undefined, undefined, source)).rejects.toThrow(
            "Open /games/bgee to show animation 0x1234.",
        );
    });

    it("says so for an id the open game does not declare", async () => {
        const source = setSource(() => ({ kind: "not-declared" }));
        await expect(ImageEditorDocument.open(setUri("1234"), undefined, undefined, source)).rejects.toThrow(
            "This game declares no animation 0x1234.",
        );
    });

    it("refuses a set the install ships no files for, naming the animation", async () => {
        const source = setSource(() => found(SET, ioFor({})));

        await expect(ImageEditorDocument.open(setUri("1234"), undefined, undefined, source)).rejects.toThrow(
            "This install ships no files for animation 0x1234.",
        );
    });

    /**
     * The two empty sets are not the same fact and the reader can act on different things: files this model
     * cannot NAME are a gap in the editor, files the install does not ship are a gap in the install. The
     * scheme's own words carry the first, since only it knows what is unmodelled.
     */
    it("says what a set it cannot name any file for is refused for", async () => {
        const unmodelled: AnimationSet = {
            ...SET,
            scheme: { kind: "unimplemented", scheme: 9, reason: "the monster_icewind scheme is not implemented yet" },
            layout: undefined,
        };
        const source = setSource(() => found(unmodelled, ioFor({ TSTBG1: baseFileBam() })));

        await expect(ImageEditorDocument.open(setUri("1234"), undefined, undefined, source)).rejects.toThrow(
            "Cannot show animation 0x1234: the monster_icewind scheme is not implemented yet.",
        );
    });
});
