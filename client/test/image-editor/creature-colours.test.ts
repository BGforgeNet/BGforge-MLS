/**
 * Showing an IE creature animation in a real creature's colours, driven through the provider's channel.
 *
 * A creature BAM ships placeholder gradients that the engine overwrites per creature, so the choice is a
 * VIEW state: the palette the surfaces are told to draw with changes, the document does not. Export is the
 * one place it is baked in, and that is asserted on the bytes that land - a palette resolved into a
 * message nothing writes would be no feature at all.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type * as vscode from "vscode";
import { type Rgba, parseBamV1, serializeBamV1 } from "@bgforge/image";
import type { CreatureEntry } from "../../src/ie-resources/creature-index";
import type { AnimationChannel, AnimationSurface, CreatureColorSource } from "../../src/image-editor/provider";
import type { HostToWebview, WebviewToHost } from "../../src/image-editor/webview/messages";
import { asIndexedView, makeMiniBam } from "./fixtures";

/** The document these open: its first four characters are the animation code a creature is matched by. */
const DOC_PATH = "/games/MOGH1.bam";
const ANIMATION_CODE = "MOGH";

const { readFileMock, writeFileMock, showWarningMock, showErrorMock, createDirectoryMock } = vi.hoisted(() => ({
    readFileMock: vi.fn(),
    writeFileMock: vi.fn(),
    showWarningMock: vi.fn(),
    showErrorMock: vi.fn(),
    createDirectoryMock: vi.fn(),
}));

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
            parse: make,
            joinPath: (base: { path: string }, ...p: string[]) => make([base.path, ...p].join("/")),
        },
        window: {
            showWarningMessage: showWarningMock,
            showErrorMessage: showErrorMock,
            showOpenDialog: vi.fn(),
            showQuickPick: vi.fn(),
            setStatusBarMessage: vi.fn(),
        },
        workspace: {
            fs: {
                readFile: readFileMock,
                writeFile: writeFileMock,
                createDirectory: createDirectoryMock,
                stat: vi.fn(() => Promise.reject(new Error("ENOENT"))),
            },
        },
    };
});

const { ImageEditorProvider } = await import("../../src/image-editor/provider");

const context = { extensionUri: { fsPath: "/ext" } } as unknown as vscode.ExtensionContext;

/** A gradient row: twelve colours, which is exactly one recolourable range. */
function gradientRow(seed: number): Rgba[] {
    return Array.from({ length: 12 }, (_, i) => ({ r: seed, g: i, b: 255 - seed, a: 255 }));
}

/** The install's gradient table. Row 1 is the one the creature below selects for its metal range. */
const GRADIENTS: Rgba[][] = [gradientRow(0), gradientRow(50), gradientRow(100)];

const NO_COLORS = { metal: 0, minor: 0, major: 0, skin: 0, leather: 0, armor: 0, hair: 0 };

const CREATURES: CreatureEntry[] = [
    {
        resref: "AGNASI",
        name: "Agnasi",
        animationId: 0x6004,
        animationCode: ANIMATION_CODE,
        colors: { ...NO_COLORS, metal: 1 },
    },
    // Named by nothing the string table could resolve, so the picker has only its resref to sort it by.
    { resref: "ZOMBIE1", name: "", animationId: 0x6004, animationCode: ANIMATION_CODE, colors: NO_COLORS },
    { resref: "IMOEN", name: "Imoen", animationId: 0x5000, animationCode: "CHMD", colors: NO_COLORS },
    // An install that names no code for this creature's animation id: never a match, whatever is open.
    { resref: "BEAR", name: "Bear", animationId: 0x7000, animationCode: "", colors: NO_COLORS },
];

function colorSource(over: Partial<CreatureColorSource> = {}): CreatureColorSource {
    return { creatures: () => CREATURES, gradients: () => GRADIENTS, ...over };
}

/** A BAM whose palette entry `i` is the grey `i`, so a colour that was not replaced is recognisable. */
function greyRampBam(): Uint8Array {
    const palette: Rgba[] = Array.from({ length: 256 }, (_, i) => ({ r: i, g: i, b: i, a: 255 }));
    return serializeBamV1({ ...makeMiniBam(), palette });
}

function fileUri(fsPath: string): vscode.Uri {
    return {
        scheme: "file",
        path: fsPath,
        fsPath,
        query: "",
        toString: () => `file:${fsPath}`,
        with: (change: { path?: string }) => fileUri(change.path ?? fsPath),
    } as unknown as vscode.Uri;
}

function makeChannel(): {
    channel: AnimationChannel;
    posted: HostToWebview[];
    send: (message: WebviewToHost) => Promise<void>;
} {
    const posted: HostToWebview[] = [];
    let handler: ((message: WebviewToHost) => Promise<void>) | undefined;
    const channel: AnimationChannel = {
        post: (message) => void posted.push(message),
        onMessage: (h) => {
            handler = h;
            return { dispose: () => {} } as vscode.Disposable;
        },
    };
    return {
        channel,
        posted,
        send: async (message) => {
            if (handler === undefined) throw new Error("nothing attached to the channel");
            await handler(message);
        },
    };
}

const surface: AnimationSurface = { save: async () => {}, showSet: async () => {} };

/** An open animation with the protocol running on it, against an install that has creatures. */
async function open(colors: CreatureColorSource = colorSource()) {
    const provider = new ImageEditorProvider(context, undefined, colors);
    const document = await provider.openDocument(fileUri(DOC_PATH));
    const first = makeChannel();
    provider.attach(document, first.channel, surface);
    return { provider, document, ...first };
}

/** The palette a `palette` message carried, or a legible failure naming what arrived instead. */
function palettes(posted: HostToWebview[]): { palette: Rgba[]; creature?: string }[] {
    return posted.flatMap((message) => (message.type === "palette" ? [message] : []));
}

beforeEach(() => {
    readFileMock.mockReset();
    readFileMock.mockResolvedValue(greyRampBam());
    writeFileMock.mockReset();
    writeFileMock.mockResolvedValue(undefined);
    createDirectoryMock.mockReset();
    createDirectoryMock.mockResolvedValue(undefined);
    showWarningMock.mockReset();
    showErrorMock.mockReset();
});

describe("the creatures on offer", () => {
    it("lists the ones using this animation first, then by the name they are shown under", async () => {
        const { posted, send } = await open();

        await send({ type: "requestCreatures" });

        expect(posted).toEqual([
            {
                type: "creatures",
                entries: [
                    { resref: "AGNASI", name: "Agnasi", matches: true },
                    { resref: "ZOMBIE1", name: "", matches: true },
                    { resref: "BEAR", name: "Bear", matches: false },
                    { resref: "IMOEN", name: "Imoen", matches: false },
                ],
            },
        ]);
    });

    it("offers none outside a game", async () => {
        // No colour source at all, which is every non-IE context and an IE one with no game open.
        const provider = new ImageEditorProvider(context);
        const document = await provider.openDocument(fileUri(DOC_PATH));
        const { channel, posted, send } = makeChannel();
        provider.attach(document, channel, surface);

        await send({ type: "requestCreatures" });

        expect(posted).toEqual([{ type: "creatures", entries: [] }]);
    });
});

describe("choosing a creature", () => {
    it("draws the chosen creature's resolved colours, on every surface showing the document", async () => {
        // Two surfaces, because a document is shown in a tab and in the gallery panel at once, and a
        // palette that reached only the one that asked would leave the other drawing placeholders.
        const { provider, document, posted, send } = await open();
        const second = makeChannel();
        provider.attach(document, second.channel, surface);

        await send({ type: "setCreature", resref: "AGNASI" });

        for (const seen of [posted, second.posted]) {
            const [message] = palettes(seen);
            expect(message?.creature).toBe("AGNASI");
            expect(message?.palette).toHaveLength(256);
            // The metal range starts at 0x04 and runs 12 entries; the creature selects gradient row 1.
            expect(message?.palette[4]).toEqual({ r: 50, g: 0, b: 205, a: 255 });
            expect(message?.palette[15]).toEqual({ r: 50, g: 11, b: 205, a: 255 });
            // Palette slot 1 is the drop shadow: always black once a creature is resolved.
            expect(message?.palette[1]).toEqual({ r: 0, g: 0, b: 0, a: 255 });
        }
    });

    it("goes back to the animation's own colours when the choice is cleared", async () => {
        const { posted, send } = await open();

        await send({ type: "setCreature", resref: "AGNASI" });
        await send({ type: "setCreature", resref: null });

        const [, cleared] = palettes(posted);
        expect(cleared?.creature).toBeUndefined();
        // The file's own entry 4, untouched: the recolour was never written into the document.
        expect(cleared?.palette[4]).toEqual({ r: 4, g: 4, b: 4, a: 255 });
    });

    /**
     * Both halves are properties of the install, and either can be missing under an open document. A
     * placeholder palette is the honest answer; inventing a recolour from half the inputs would look
     * like a real creature and be nobody's.
     */
    it.each([
        ["the creature is not in the install's index", colorSource(), "NOBODY"],
        ["the install ships no gradient table", colorSource({ gradients: () => undefined }), "AGNASI"],
    ])("keeps the animation's own colours when %s", async (_label, colors, resref) => {
        const { posted, send } = await open(colors);

        await send({ type: "setCreature", resref });

        const [message] = palettes(posted);
        expect(message?.creature).toBeUndefined();
        expect(message?.palette[4]).toEqual({ r: 4, g: 4, b: 4, a: 255 });
    });
});

describe("exporting in a creature's colours", () => {
    it("bakes the chosen colours into the file it writes, after saying they cannot be undone", async () => {
        const { document, send } = await open();
        showWarningMock.mockResolvedValue("Save anyway");

        await send({ type: "setCreature", resref: "AGNASI" });
        await send({ type: "saveAs", target: "bam" });

        expect(showErrorMock).not.toHaveBeenCalled();
        // The baking is what the reader is asked about, so the note has to say whose colours went in.
        const [, options, action] = showWarningMock.mock.calls[0] ?? [];
        expect(action).toBe("Save anyway");
        expect((options as { detail?: string } | undefined)?.detail).toContain(
            "written in Agnasi (AGNASI)'s colours - the result cannot be recoloured as another creature",
        );
        // The observable is the file's own palette: the modal above proves only what the reader was told.
        const written = writeFileMock.mock.calls.map((call: unknown[]) => call[1] as Uint8Array);
        expect(writeFileMock.mock.calls.map((call: unknown[]) => String(call[0]))).toEqual([`file:${DOC_PATH}`]);
        expect(parseBamV1(written[0] ?? new Uint8Array()).palette[4]).toEqual({ r: 50, g: 0, b: 205, a: 255 });
        // The document keeps its own placeholders: the choice is a view state, so the open file stays
        // recolourable as any other creature.
        expect(asIndexedView(document.toView()).palette[4]).toEqual({ r: 4, g: 4, b: 4, a: 255 });
    });

    it("writes the animation's own palette when no creature was chosen, with nothing to confirm", async () => {
        const { send } = await open();

        await send({ type: "saveAs", target: "bam" });

        expect(showWarningMock).not.toHaveBeenCalled();
        const written = writeFileMock.mock.calls.map((call: unknown[]) => call[1] as Uint8Array);
        expect(parseBamV1(written[0] ?? new Uint8Array()).palette[4]).toEqual({ r: 4, g: 4, b: 4, a: 255 });
    });
});
