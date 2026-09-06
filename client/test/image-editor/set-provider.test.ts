/**
 * The set-shaped messages, driven through the provider's own channel: picking another set, and the
 * three steps of a conversion.
 *
 * Everything here is orchestration - which host prompt is shown, what the webview is told, which files
 * land on disk - so it is driven the way the webview drives it, by message, and asserted on what the
 * host was actually asked to do. What a conversion DECIDES has its own tests in `conversion.test.ts`;
 * the bytes are real all the same, because a conversion that wrote nothing would pass a count check.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type * as vscode from "vscode";
import { type AnimationSet, type StanceIo } from "@bgforge/animation";
import { parseBamV1 } from "@bgforge/image";
import { bandedPair } from "../../../image/test/bam-fixtures.ts";
import type { AnimationSetLookup, AnimationSetSource } from "../../src/image-editor/set-document";
import type { AnimationChannel, AnimationSurface } from "../../src/image-editor/provider";
import type { HostToWebview, WebviewToHost } from "../../src/image-editor/webview/messages";
import { CONVERSION_PROFILES } from "../../src/image-editor/conversion";

const GAME_DIR = "/games/bgee";
const GAME_SCHEME = "bgforge-ie-resource";
const OUT_DIR = "/out";

const { readFileMock, writeFileMock, showOpenDialogMock, showQuickPickMock, showInformationMock } = vi.hoisted(() => ({
    readFileMock: vi.fn(),
    writeFileMock: vi.fn(),
    showOpenDialogMock: vi.fn(),
    showQuickPickMock: vi.fn(),
    showInformationMock: vi.fn(),
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
            joinPath: (base: { path: string }, ...parts: string[]) => make([base.path, ...parts].join("/")),
            from: (parts: { scheme: string; path: string; query: string }) => ({
                ...make(parts.path),
                scheme: parts.scheme,
                query: parts.query,
                toString: () => `${parts.scheme}:${parts.path}?${parts.query}`,
            }),
        },
        window: {
            showOpenDialog: showOpenDialogMock,
            showQuickPick: showQuickPickMock,
            showInformationMessage: showInformationMock,
            showWarningMessage: vi.fn(),
            setStatusBarMessage: vi.fn(),
        },
        workspace: {
            fs: { readFile: readFileMock, writeFile: writeFileMock, stat: vi.fn(), createDirectory: vi.fn() },
        },
    };
});

const { ImageEditorProvider } = await import("../../src/image-editor/provider");

const context = { extensionUri: { fsPath: "/ext" } } as unknown as vscode.ExtensionContext;

/**
 * A two-action monster set, named in the two-letter family - the same shape `conversion.test.ts` uses,
 * because a cycle-numbered set is one no naming can carry and every conversion of it is a refusal.
 */
const SET: AnimationSet = {
    id: 0x1234,
    code: "TST",
    name: "TEST_ANIM",
    prefixByArmour: new Map([[1, "TSTB"]]),
    paperdollPrefix: undefined,
    scheme: { kind: "unimplemented", scheme: 1, reason: "the monster scheme is not implemented yet" },
    layout: "actions",
};

/** The set the picker offers beside the open one, so "open another set" has somewhere to go. */
const OTHER_SET: AnimationSet = { ...SET, id: 0x6004, name: "OTHER_ANIM", code: "OTH" };

const FILES: Record<string, Uint8Array> = {
    TSTBSD: bandedPair(2, [0, 1, 2, 3, 4]),
    TSTBWK: bandedPair(2, [0, 1, 2, 3, 4]),
};

/**
 * The refusable set: a cycle-numbered layout, whose files are named for where they sit rather than for
 * what they show. It opens like any other and no naming that carries meaning can file it, which is the
 * only way to reach a refusal through the whole path.
 */
const CYCLE_SET: AnimationSet = { ...SET, layout: "cycles" };
const CYCLE_FILES: Record<string, Uint8Array> = { TSTBG1: bandedPair(2, [0, 1, 2, 3, 4]) };

/** Its refusal, in the conversion's own words - the provider forwards it verbatim to both surfaces. */
const REFUSAL = "Nothing states what this set's actions depict, so the target can name none of them: G1.";

function ioFor(files: Record<string, Uint8Array>): StanceIo {
    return {
        exists: (resref) => Object.hasOwn(files, resref.toUpperCase()),
        read: (resref) => files[resref.toUpperCase()],
    };
}

const io = ioFor(FILES);

/** The conversion the reader has filled in: the two-letter target, under a stem of their own. */
const REQUEST = { profileId: "ie-monster", prefix: "NEWB", targetId: 0x9000, notes: true };

function setSource(declared: readonly AnimationSet[] = [SET], archive = io): AnimationSetSource {
    return {
        lookup: (_dir, id) => {
            const set = declared.find((entry) => entry.id === id);
            const answer: AnimationSetLookup =
                set === undefined ? { kind: "not-declared" } : { kind: "set", set, io: archive, flavour: "tob" };
            return answer;
        },
        list: () => declared,
    };
}

/** A set address, as the gallery mints one: the label in the path, the identity in the query. */
function setUri(hex: string): vscode.Uri {
    const uriPath = "/TEST_ANIM.animset";
    const query = `g=${encodeURIComponent(GAME_DIR)}&a=${hex}`;
    return {
        scheme: GAME_SCHEME,
        path: uriPath,
        query,
        fsPath: uriPath,
        toString: () => `${GAME_SCHEME}:${uriPath}?${query}`,
    } as unknown as vscode.Uri;
}

/** A plain file document's address - the negative half: nothing set-shaped may act on one. */
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

/** The webview's end of the protocol: what it was told, and a way to speak as it does. */
function makeChannel(): {
    channel: AnimationChannel;
    posted: HostToWebview[];
    send: (m: WebviewToHost) => Promise<void>;
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

function surfaceStub(): AnimationSurface & { showSet: ReturnType<typeof vi.fn> } {
    return { save: vi.fn(async () => {}), showSet: vi.fn(async () => {}) };
}

/** An open set document with the protocol running on it, as `resolveCustomEditor` leaves things. */
async function openSet(declared: readonly AnimationSet[] = [SET], archive = io) {
    const provider = new ImageEditorProvider(context, undefined, undefined, setSource(declared, archive));
    const document = await provider.openDocument(setUri("1234"));
    const surface = surfaceStub();
    const { channel, posted, send } = makeChannel();
    provider.attach(document, channel, surface);
    return { provider, document, surface, posted, send };
}

/** The folder the reader picks for a conversion's output. */
function outFolder(): vscode.Uri {
    return fileUri(OUT_DIR);
}

function writtenPaths(): string[] {
    return writeFileMock.mock.calls.map((call: unknown[]) => String(call[0]));
}

beforeEach(() => {
    readFileMock.mockReset();
    // The one file document these tests open, for the half that asserts nothing set-shaped acts on one.
    readFileMock.mockResolvedValue(FILES.TSTBSD);
    writeFileMock.mockReset();
    writeFileMock.mockResolvedValue(undefined);
    showOpenDialogMock.mockReset();
    showQuickPickMock.mockReset();
    showInformationMock.mockReset();
});

describe("picking another set", () => {
    it("offers every declared set by title and id, and shows the one chosen", async () => {
        const { surface, send } = await openSet([SET, OTHER_SET]);
        // Chosen by id, not by position: the item the reader clicks is the one the host must open.
        showQuickPickMock.mockImplementation((items: { id: number }[]) =>
            Promise.resolve(items.find((item) => item.id === OTHER_SET.id)),
        );

        await send({ type: "pickSet" });

        expect(showQuickPickMock.mock.calls[0]?.[0]).toEqual([
            { label: "TEST_ANIM", description: "0x1234", id: 0x1234 },
            { label: "OTHER_ANIM", description: "0x6004", id: 0x6004 },
        ]);
        // The id is what the tables key on, so it has to be searchable beside the title.
        expect(showQuickPickMock.mock.calls[0]?.[1]).toEqual({
            title: "Show which animation set?",
            matchOnDescription: true,
        });
        expect(surface.showSet).toHaveBeenCalledWith(GAME_DIR, 0x6004);
    });

    /** Neither case is a change of view, and opening the set already open would rebuild the document. */
    it.each([
        ["the picker is dismissed", undefined],
        ["the set already open is chosen", { label: "TEST_ANIM", description: "0x1234", id: 0x1234 }],
    ])("shows nothing when %s", async (_label, answer) => {
        const { surface, send } = await openSet([SET, OTHER_SET]);
        showQuickPickMock.mockResolvedValue(answer);

        await send({ type: "pickSet" });

        expect(surface.showSet).not.toHaveBeenCalled();
    });
});

describe("planning a conversion", () => {
    it("offers the host's conversions, the source's own stem and a free id", async () => {
        const { posted, send } = await openSet();

        await send({ type: "beginConversion" });

        // Ids and labels only: the target and the naming scheme are the host's business, and the id is
        // what comes back, so nothing downstream keys off the display text.
        expect(posted).toEqual([
            {
                type: "conversionSetup",
                setup: {
                    profiles: CONVERSION_PROFILES.map((profile) => ({ id: profile.id, label: profile.label })),
                    prefix: "TSTB",
                    // 0x1234 is declared, so the first free id at or above the source's is offered.
                    targetId: 0x1235,
                },
            },
        ]);
    });

    it("reports the outcome of the chosen target, and how many files it would write", async () => {
        const { posted, send } = await openSet();

        await send({ type: "planConversion", profileId: "ie-monster" });

        expect(posted).toEqual([
            {
                type: "conversionPlan",
                plan: { profileId: "ie-monster", outcome: "lossless", losses: [], notes: [], files: 2 },
            },
        ]);
    });

    it("reports a refusal as the plan, with the reason and no files", async () => {
        // A cycle-numbered set's files say where they sit and not what they show, so no naming that
        // carries meaning can file them.
        const { posted, send } = await openSet([CYCLE_SET], ioFor(CYCLE_FILES));

        await send({ type: "planConversion", profileId: "ie-monster" });

        expect(posted).toEqual([
            {
                type: "conversionPlan",
                plan: { profileId: "ie-monster", outcome: "refused", reason: REFUSAL, losses: [], notes: [], files: 0 },
            },
        ]);
    });
});

describe("running a conversion", () => {
    it("writes one file per member plus the notes, into the folder the reader picks", async () => {
        const { send } = await openSet();
        showOpenDialogMock.mockResolvedValue([outFolder()]);

        await send({ type: "runConversion", request: REQUEST });

        expect(writtenPaths()).toEqual(["file:/out/NEWBSD.BAM", "file:/out/NEWBWK.BAM", "file:/out/NEWB-notes.md"]);
        // The bytes are the deliverable: a file written from an empty conversion would pass the paths above.
        const [first] = writeFileMock.mock.calls;
        expect(parseBamV1(first?.[1] as Uint8Array).sequences).toHaveLength(8);
        // The notes carry the id to declare the result under - nothing writes it into any table.
        expect(new TextDecoder().decode(writeFileMock.mock.calls[2]?.[1] as Uint8Array)).toContain("9000");
        expect(showInformationMock).toHaveBeenCalledWith("Converted TEST_ANIM: 2 files in /out.");
    });

    it("writes no notes file when the reader asked for none", async () => {
        const { send } = await openSet();
        showOpenDialogMock.mockResolvedValue([outFolder()]);

        await send({ type: "runConversion", request: { ...REQUEST, notes: false } });

        expect(writtenPaths()).toEqual(["file:/out/NEWBSD.BAM", "file:/out/NEWBWK.BAM"]);
    });

    it("writes nothing when the folder prompt is dismissed", async () => {
        const { send } = await openSet();
        showOpenDialogMock.mockResolvedValue(undefined);

        await send({ type: "runConversion", request: REQUEST });

        expect(writeFileMock).not.toHaveBeenCalled();
    });

    it("says why a refused conversion wrote nothing, without asking where to put it", async () => {
        const { posted, send } = await openSet([CYCLE_SET], ioFor(CYCLE_FILES));

        await send({ type: "runConversion", request: REQUEST });

        expect(posted).toEqual([{ type: "error", message: REFUSAL }]);
        expect(showOpenDialogMock).not.toHaveBeenCalled();
        expect(writeFileMock).not.toHaveBeenCalled();
    });

    /**
     * The partial-failure posture. Nothing is rolled back - the folder is the reader's and may hold files
     * of their own - so the report has to say which member stopped the run and what is in the folder now,
     * or the reader is left with a half-converted set and no way to tell which half.
     */
    it("names the member a failed write stopped on, and what the folder holds", async () => {
        const { posted, send } = await openSet();
        showOpenDialogMock.mockResolvedValue([outFolder()]);
        writeFileMock.mockImplementation((target: { toString: () => string }) =>
            target.toString() === "file:/out/NEWBWK.BAM"
                ? Promise.reject(new Error("EACCES: permission denied"))
                : Promise.resolve(undefined),
        );

        await send({ type: "runConversion", request: REQUEST });

        expect(posted).toEqual([
            {
                type: "error",
                message:
                    "NEWBWK.BAM could not be written: EACCES: permission denied. /out now holds 1 of 2 " +
                    "converted files (NEWBSD.BAM); the rest were not written.",
            },
        ]);
        // The run stops there rather than carrying on into the notes file, which would describe a set
        // that is not in the folder.
        expect(writtenPaths()).toEqual(["file:/out/NEWBSD.BAM", "file:/out/NEWBWK.BAM"]);
    });

    /** The one failure that leaves the set itself complete - so it must not claim members are missing. */
    it("reports a notes file that could not be written beside the members that were", async () => {
        const { posted, send } = await openSet();
        showOpenDialogMock.mockResolvedValue([outFolder()]);
        writeFileMock.mockImplementation((target: { toString: () => string }) =>
            target.toString() === "file:/out/NEWB-notes.md"
                ? Promise.reject(new Error("ENOSPC: no space left on device"))
                : Promise.resolve(undefined),
        );

        await send({ type: "runConversion", request: REQUEST });

        expect(posted).toEqual([
            {
                type: "error",
                message:
                    "NEWB-notes.md could not be written: ENOSPC: no space left on device. /out now holds 2 of 2 " +
                    "converted files (NEWBSD.BAM, NEWBWK.BAM).",
            },
        ]);
        // No success notice: the run did not finish, whatever landed in the folder.
        expect(showInformationMock).not.toHaveBeenCalled();
    });

    it("reports the failure even when it is the first member, naming an empty folder", async () => {
        const { posted, send } = await openSet();
        showOpenDialogMock.mockResolvedValue([outFolder()]);
        writeFileMock.mockRejectedValue(new Error("EROFS: read-only file system"));

        await send({ type: "runConversion", request: REQUEST });

        expect(posted).toEqual([
            {
                type: "error",
                message:
                    "NEWBSD.BAM could not be written: EROFS: read-only file system. /out now holds 0 of 2 " +
                    "converted files; the rest were not written.",
            },
        ]);
    });
});

describe("a document that is not a set", () => {
    /** Every one of these reads the open document's set; a file document has none, so none may act. */
    it.each([
        ["beginConversion", { type: "beginConversion" } as const],
        ["planConversion", { type: "planConversion", profileId: "ie-monster" } as const],
        ["runConversion", { type: "runConversion", request: REQUEST } as const],
        ["pickSet", { type: "pickSet" } as const],
    ])("ignores %s", async (_label, message) => {
        const provider = new ImageEditorProvider(context, undefined, undefined, setSource());
        const document = await provider.openDocument(fileUri("/art/TSTBSD.bam"));
        const { channel, posted, send } = makeChannel();
        provider.attach(document, channel, surfaceStub());

        await send(message);

        expect(posted).toEqual([]);
        expect(showOpenDialogMock).not.toHaveBeenCalled();
        expect(showQuickPickMock).not.toHaveBeenCalled();
        expect(writeFileMock).not.toHaveBeenCalled();
    });
});
