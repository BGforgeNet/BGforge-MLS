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
import { bandedPair, unevenBand } from "../../../image/test/bam-fixtures.ts";
import type { AnimationSetLookup, AnimationSetSource } from "../../src/image-editor/set-document";
import type { AnimationChannel, AnimationSurface } from "../../src/image-editor/provider";
import { type HostToWebview, type WebviewToHost, saveRequestKey } from "../../src/image-editor/webview/messages";

const GAME_DIR = "/games/bgee";
const GAME_SCHEME = "bgforge-ie-resource";
const OUT_DIR = "/out";

const {
    readFileMock,
    writeFileMock,
    showOpenDialogMock,
    showQuickPickMock,
    showInputMock,
    readDirMock,
    showInformationMock,
    showErrorMock,
    statMock,
} = vi.hoisted(() => ({
    readFileMock: vi.fn(),
    writeFileMock: vi.fn(),
    showOpenDialogMock: vi.fn(),
    showQuickPickMock: vi.fn(),
    showInputMock: vi.fn(),
    readDirMock: vi.fn(),
    showInformationMock: vi.fn(),
    showErrorMock: vi.fn(),
    statMock: vi.fn(),
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
            showInputBox: showInputMock,
            showInformationMessage: showInformationMock,
            showWarningMessage: vi.fn(),
            showErrorMessage: showErrorMock,
            setStatusBarMessage: vi.fn(),
        },
        workspace: {
            fs: {
                readFile: readFileMock,
                writeFile: writeFileMock,
                stat: statMock,
                readDirectory: readDirMock,
                createDirectory: vi.fn(),
            },
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
    scheme: { kind: "layout" },
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
/**
 * A whole save request, as the dialog sends it - the same shape plans a save and runs it.
 *
 * A RETARGET of this fixture, by its STEM: the geometry and the naming match what the set already is, and
 * the new name is what makes it a new animation - files under names the source's install does not use,
 * which need their own declaration. Naming it the two-letter family is what the fixture's own actions can
 * be filed under, so the refusal case below has to come from a set whose actions mean nothing.
 */
const REQUEST = {
    format: "bam" as const,
    bamVersion: 1 as const,
    compressed: false,
    naming: "action-codes",
    prefix: "NEWB",
    targetId: 0x9000,
    // The section carries the shape now. `monster_old` is the eight-point family this fixture's own
    // facings fill; `monster` stores nine, which these five cannot reach.
    section: "monster_old",
    notes: true,
    destination: "folder" as const,
};

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
    showInputMock.mockReset();
    // An empty destination folder is the ordinary case; a test that wants one holding files says so.
    readDirMock.mockReset();
    readDirMock.mockResolvedValue([]);
    showInformationMock.mockReset();
    showErrorMock.mockReset();
    // An empty destination folder: stat throws for an absent path, which is how the overwrite gate reads
    // "nothing here to replace". Left as a resolving stub it would report every write as a collision.
    statMock.mockReset();
    statMock.mockRejectedValue(new Error("ENOENT"));
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
    /**
     * Only the two defaults. What the dialog can OFFER travels with the view, because it is a property of
     * the open set rather than an answer to opening a dialog - and the dialog has to be able to say when
     * there is nothing to offer, which it cannot do while waiting for a reply.
     */
    it("offers the source's own stem and a free id", async () => {
        const { posted, send } = await openSet();

        await send({ type: "beginSaveAs" });

        expect(posted).toEqual([
            {
                type: "saveAsSetup",
                // The answer names the set it is for: it is asynchronous, and a reader can move between
                // sets while it is in flight - without the id the dialog seeded from whichever answer
                // happened to arrive and offered the previous creature's stem.
                // 0x1234 is declared, so the first free id at or above the source's is offered.
                // Empty section: this fixture's install declares none, and an absent declaration is
                // offered as absent rather than as a plausible family nothing said.
                setup: { id: 0x1234, prefix: "TSTB", targetId: 0x1235, section: "" },
            },
        ]);
    });

    /**
     * The file NAMES, not a count. A count answers none of the questions a reader asks of a save - whether
     * the stem took, whether the names are the ones the target expects - and those are exactly what the
     * dialog is for.
     */
    it("names the files a save would write, where they would land, and what it would cost", async () => {
        const { posted, send } = await openSet();

        await send({ type: "planSave", request: REQUEST });

        expect(posted).toEqual([
            {
                type: "savePlan",
                plan: {
                    for: saveRequestKey(REQUEST),
                    outcome: "lossless",
                    losses: [],
                    notes: [],
                    // Each member with its eastern companion: the section's own type keeps the east beside
                    // the base, and the section is what names the shape.
                    shown: ["NEWBSD.BAM", "NEWBSDE.BAM", "NEWBWK.BAM", "NEWBWKE.BAM"],
                    files: 4,
                    destination: "a folder you choose",
                    retarget: true,
                    needsBasePage: false,
                    unevenRotations: false,
                },
            },
        ]);
    });

    /**
     * A plan is a round trip and the reader keeps moving controls, so an answer can arrive after the
     * settings it answers have changed. Without the echo the dialog took whatever came last as the answer
     * to what it was showing, and Save stayed live against a preview of other settings.
     */
    it("says which request each plan answers", async () => {
        const { posted, send } = await openSet();

        await send({ type: "planSave", request: REQUEST });
        await send({ type: "planSave", request: { ...REQUEST, prefix: "OTHR" } });

        const keys = posted.map((message) => (message.type === "savePlan" ? message.plan.for : undefined));
        expect(keys).toEqual([saveRequestKey(REQUEST), saveRequestKey({ ...REQUEST, prefix: "OTHR" })]);
        expect(keys[0]).not.toBe(keys[1]);
    });

    /**
     * Every question a save has belongs to the dialog. The page number used to arrive as an input box
     * AFTER the folder picker, which is past the point the reader has finished deciding - so the plan says
     * when one is still needed, and Save waits for it rather than the host interrupting later.
     */
    /**
     * The folder is picked from inside the dialog, so the host opens its picker on a message and answers
     * with the path. It used to be sprung after Save, which put the last question of the save after the
     * moment the reader had finished deciding.
     */
    it("opens the folder picker on the dialog's own message and answers with the path", async () => {
        const { posted, send } = await openSet();
        showOpenDialogMock.mockResolvedValue([outFolder()]);

        await send({ type: "chooseSaveFolder" });

        expect(posted).toEqual([{ type: "saveFolder", path: OUT_DIR }]);
    });

    /** Answered either way, or the dialog's Choose button waits on a reply that is never coming. */
    it("answers with no path when the picker is dismissed", async () => {
        const { posted, send } = await openSet();
        showOpenDialogMock.mockResolvedValue(undefined);

        await send({ type: "chooseSaveFolder" });

        expect(posted).toEqual([{ type: "saveFolder" }]);
    });

    /** The path, not a phrase: "a folder you choose" is not a destination anyone can check. */
    it("names the chosen folder in the plan, and what it already holds", async () => {
        const { posted, send } = await openSet();
        readDirMock.mockResolvedValue([["NEWBSD.BAM", 1]]);

        await send({ type: "planSave", request: { ...REQUEST, folder: OUT_DIR } });

        const [message] = posted;
        expect(message?.type === "savePlan" && message.plan.destination).toBe(OUT_DIR);
        expect(message?.type === "savePlan" && message.plan.notes).toContain(
            "1 of these files are already in that folder and will be replaced.",
        );
    });

    /**
     * The control for it is drawn only where there is something to decide, so the plan answers from a run
     * of the conversion: for a source whose facings already agree, every answer writes the same six files
     * and a set of radios for it would be a question with no consequence.
     */
    it("says whether a save has rotations of differing length to resolve", async () => {
        const uneven = ioFor({
            TSTBSD: unevenBand(2, [0, 1, 2, 3, 4], 1),
            TSTBWK: bandedPair(2, [0, 1, 2, 3, 4]),
        });
        const asFrm = { ...REQUEST, format: "frm" as const };
        const even = await openSet();
        await even.send({ type: "planSave", request: asFrm });
        const jagged = await openSet([SET], uneven);
        await jagged.send({ type: "planSave", request: asFrm });

        const flagOf = (posted: HostToWebview[]): boolean | undefined =>
            posted.flatMap((m) => (m.type === "savePlan" ? [m.plan.unevenRotations] : []))[0];
        expect(flagOf(even.posted)).toBe(false);
        expect(flagOf(jagged.posted)).toBe(true);
    });

    it("says a BAM v2 save takes a page number and a BAM v1 save does not", async () => {
        const { posted, send } = await openSet();
        const asV2 = { ...REQUEST, format: "bam" as const, bamVersion: 2 as const, prefix: "TSTB" };

        await send({ type: "planSave", request: { ...REQUEST, prefix: "TSTB" } });
        await send({ type: "planSave", request: asV2 });
        // Still true once one has been given: keyed on what is MISSING, the dialog's own field would
        // disappear the moment the reader typed into it.
        await send({ type: "planSave", request: { ...asV2, basePage: 4200 } });

        const asked = posted.map((m) => (m.type === "savePlan" ? m.plan.needsBasePage : undefined));
        expect(asked).toEqual([false, true, true]);
    });

    /** With the page answered in the dialog, the run writes without stopping to ask for it again. */
    it("writes a BAM v2 set from the page number the dialog carried", async () => {
        const { send } = await openSet();
        showOpenDialogMock.mockResolvedValue([outFolder()]);

        await send({
            type: "runSave",
            request: { ...REQUEST, format: "bam" as const, bamVersion: 2 as const, prefix: "TSTB", basePage: 4200 },
        });

        expect(showInputMock).not.toHaveBeenCalled();
        expect(writtenPaths()).toContain("file:/out/MOS4200.PVRZ");
    });

    /**
     * The converter re-serializes each member as BAM v1 and has no BAM v2 writer, so a reshape asking for
     * v2 used to write v1 files and report them as what was asked for. Refused where it cannot be done,
     * naming the path that can.
     */
    it("refuses to reshape a set into a container the converter cannot write", async () => {
        const { posted, send } = await openSet();

        await send({ type: "planSave", request: { ...REQUEST, bamVersion: 2 as const } });

        const [message] = posted;
        expect(message?.type === "savePlan" && message.plan.outcome).toBe("refused");
        expect(message?.type === "savePlan" && message.plan.reason).toContain("BAM v1");
        expect(message?.type === "savePlan" && message.plan.files).toBe(0);
    });

    /**
     * A set drawn in a layout no naming carries - a quadrant, a tiled static - can still be written back
     * over its own files, which is what the plain save does. The dialog has to seed its radios with
     * something, so an axis the SOURCE does not state cannot be what makes a save a reshape: comparing
     * against an absent value made every such set unwritable, refused by a converter that has no reader
     * for its layout.
     */
    it("writes a set whose layout no naming carries as it stands", async () => {
        // The bare layout: the file IS the animation, carrying no action code for a naming to read.
        const { posted, send } = await openSet([{ ...SET, layout: "bare" }], ioFor({ TSTB: bandedPair(2, [0, 1, 2]) }));

        await send({ type: "planSave", request: { ...REQUEST, prefix: "TSTB" } });

        const [message] = posted;
        expect(message?.type === "savePlan" && message.plan.retarget).toBe(false);
        expect(message?.type === "savePlan" && message.plan.shown).toEqual(["TSTB.bam"]);
    });

    it("reports a refusal as the plan, with the reason and no files", async () => {
        // A cycle-numbered set's files say where they sit and not what they show, so no naming that
        // carries meaning can file them.
        const { posted, send } = await openSet([CYCLE_SET], ioFor(CYCLE_FILES));

        await send({ type: "planSave", request: REQUEST });

        expect(posted).toEqual([
            {
                type: "savePlan",
                plan: {
                    for: saveRequestKey(REQUEST),
                    outcome: "refused",
                    reason: REFUSAL,
                    losses: [],
                    notes: [],
                    shown: [],
                    files: 0,
                    destination: "a folder you choose",
                    retarget: true,
                    needsBasePage: false,
                    unevenRotations: false,
                },
            },
        ]);
    });
});

describe("running a conversion", () => {
    /** With the folder chosen in the dialog, the run writes into it without opening a picker of its own. */
    it("writes into the folder the request carries, asking for none", async () => {
        const { send } = await openSet();

        await send({ type: "runSave", request: { ...REQUEST, folder: OUT_DIR } });

        expect(showOpenDialogMock).not.toHaveBeenCalled();
        expect(writtenPaths()).toContain("file:/out/NEWBSD.BAM");
    });

    it("writes one file per member plus the notes, into the folder the reader picks", async () => {
        const { send } = await openSet();
        showOpenDialogMock.mockResolvedValue([outFolder()]);

        await send({ type: "runSave", request: REQUEST });

        expect(writtenPaths()).toEqual([
            "file:/out/NEWBSD.BAM",
            "file:/out/NEWBSDE.BAM",
            "file:/out/NEWBWK.BAM",
            "file:/out/NEWBWKE.BAM",
            // The declaration itself, precomputed rather than described - the notes used to tell the
            // reader to write this by hand from values only the host knew.
            "file:/out/9000.ini",
            "file:/out/NEWB-notes.md",
        ]);
        // The bytes are the deliverable: a file written from an empty conversion would pass the paths above.
        const [first] = writeFileMock.mock.calls;
        expect(parseBamV1(first?.[1] as Uint8Array).sequences).toHaveLength(8);
        // The declaration is the family and the prefix, ready to copy into override rather than described.
        // Indexed off the END: the art is four files now that each member pairs its east, and counting
        // from the front made these two assertions depend on how many members the fixture happens to have.
        const calls = writeFileMock.mock.calls;
        expect(new TextDecoder().decode(calls.at(-2)?.[1] as Uint8Array)).toContain("resref=NEWB");
        // The notes still carry the id, since the IDS rows remain the reader's to add.
        expect(new TextDecoder().decode(calls.at(-1)?.[1] as Uint8Array)).toContain("9000");
        expect(showInformationMock).toHaveBeenCalledWith("Wrote TEST_ANIM: 6 files in /out.");
    });

    it("writes no notes file when the reader asked for none", async () => {
        const { send } = await openSet();
        showOpenDialogMock.mockResolvedValue([outFolder()]);

        await send({ type: "runSave", request: { ...REQUEST, notes: false } });

        expect(writtenPaths()).toEqual([
            "file:/out/NEWBSD.BAM",
            "file:/out/NEWBSDE.BAM",
            "file:/out/NEWBWK.BAM",
            "file:/out/NEWBWKE.BAM",
            "file:/out/9000.ini",
        ]);
    });

    it("writes nothing when the folder prompt is dismissed", async () => {
        const { send } = await openSet();
        showOpenDialogMock.mockResolvedValue(undefined);

        await send({ type: "runSave", request: REQUEST });

        expect(writeFileMock).not.toHaveBeenCalled();
    });

    it("says why a refused conversion wrote nothing, without asking where to put it", async () => {
        const { posted, send } = await openSet([CYCLE_SET], ioFor(CYCLE_FILES));

        await send({ type: "runSave", request: REQUEST });

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

        await send({ type: "runSave", request: REQUEST });

        expect(posted).toEqual([
            {
                type: "error",
                message:
                    "NEWBWK.BAM could not be written: EACCES: permission denied. /out now holds 2 of 6 " +
                    "files (NEWBSD.BAM, NEWBSDE.BAM); the rest were not written.",
            },
        ]);
        // The run stops there rather than carrying on into the declaration and the notes, which would
        // describe a set that is not in the folder.
        expect(writtenPaths()).toEqual(["file:/out/NEWBSD.BAM", "file:/out/NEWBSDE.BAM", "file:/out/NEWBWK.BAM"]);
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

        await send({ type: "runSave", request: REQUEST });

        expect(posted).toEqual([
            {
                type: "error",
                message:
                    "NEWB-notes.md could not be written: ENOSPC: no space left on device. /out now holds 5 of 6 " +
                    "files (NEWBSD.BAM, NEWBSDE.BAM, NEWBWK.BAM, NEWBWKE.BAM, 9000.ini); the rest were not written.",
            },
        ]);
        // No success notice: the run did not finish, whatever landed in the folder.
        expect(showInformationMock).not.toHaveBeenCalled();
    });

    it("reports the failure even when it is the first member, naming an empty folder", async () => {
        const { posted, send } = await openSet();
        showOpenDialogMock.mockResolvedValue([outFolder()]);
        writeFileMock.mockRejectedValue(new Error("EROFS: read-only file system"));

        await send({ type: "runSave", request: REQUEST });

        expect(posted).toEqual([
            {
                type: "error",
                message:
                    "NEWBSD.BAM could not be written: EROFS: read-only file system. /out now holds 0 of 6 " +
                    "files; the rest were not written.",
            },
        ]);
    });
});

describe("saving a set as another format", () => {
    /**
     * The wrinkle this exists to close: Save As used to write the animation on screen, so a set produced
     * ONE file under the set's own name while the button beside it saved the whole set. Two members,
     * both written, each under the file it came from.
     */
    it("writes every member of the set, not the stance on screen", async () => {
        const { send } = await openSet();
        showOpenDialogMock.mockResolvedValue([outFolder()]);

        await send({ type: "saveAs", target: "bam" });

        expect(writtenPaths().sort()).toEqual(["file:/out/TSTBSD.bam", "file:/out/TSTBWK.bam"]);
    });

    /** The bytes are the deliverable: a run that named two files and wrote one passes a path check. */
    it("writes a real BAM at each member's own name", async () => {
        const { send } = await openSet();
        showOpenDialogMock.mockResolvedValue([outFolder()]);

        await send({ type: "saveAs", target: "bam" });

        const byPath = new Map(writeFileMock.mock.calls.map((call) => [String(call[0]), call[1] as Uint8Array]));
        for (const resref of ["TSTBSD", "TSTBWK"]) {
            const bytes = byPath.get(`file:/out/${resref}.bam`);
            if (bytes === undefined) throw new Error(`nothing written for ${resref}`);
            expect(parseBamV1(bytes).sequences).toHaveLength(8);
        }
    });

    it("writes a set manifest beside the members for the directory target", async () => {
        const { send } = await openSet();
        showOpenDialogMock.mockResolvedValue([outFolder()]);

        await send({ type: "saveAs", target: "png-directory" });

        expect(writtenPaths()).toContain("file:/out/set.json");
        expect(writtenPaths().some((p) => p.startsWith("file:/out/TSTBSD/"))).toBe(true);
        expect(writtenPaths().some((p) => p.startsWith("file:/out/TSTBWK/"))).toBe(true);
    });

    /**
     * A set has no single FRM. Refused rather than writing the open stance under the set's name, which
     * is the same one-member-called-a-set the rest of this block exists to stop.
     */
    it("refuses FRM and points at the conversion mode", async () => {
        const { send } = await openSet();
        showOpenDialogMock.mockResolvedValue([outFolder()]);

        await send({ type: "saveAs", target: "frm" });

        expect(writeFileMock).not.toHaveBeenCalled();
        expect(String(showErrorMock.mock.calls[0]?.[0])).toMatch(/Another game's files/);
    });

    it("writes nothing when the reader dismisses the folder picker", async () => {
        const { send } = await openSet();
        showOpenDialogMock.mockResolvedValue(undefined);

        await send({ type: "saveAs", target: "bam" });

        expect(writeFileMock).not.toHaveBeenCalled();
    });
});

describe("a document that is not a set", () => {
    /** Every one of these reads the open document's set; a file document has none, so none may act. */
    it.each([
        ["beginSaveAs", { type: "beginSaveAs" } as const],
        ["planSave", { type: "planSave", request: REQUEST } as const],
        ["runSave", { type: "runSave", request: REQUEST } as const],
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
