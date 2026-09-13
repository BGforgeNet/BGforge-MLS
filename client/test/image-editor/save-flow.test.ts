/**
 * The host side of Save As, import and the set dialog's save, driven through `save-flow.ts` itself.
 *
 * The questions and consents are the behaviour here - which prompt is raised, what dismissing it leaves
 * alone, which files land - so each is asserted on what the host was asked and what reached the disk. The
 * disk is an in-memory map the `vscode.workspace.fs` stub reads and writes, which lets an export be read
 * straight back in as an import: the folder an import is handed is one the export side really produced.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type * as vscode from "vscode";
import { type AnimationSet, type StanceIo } from "@bgforge/animation";
import {
    DEFAULT_FALLOUT_PALETTE,
    type Rgba,
    type RgbaAnimation,
    exportPngDirectory,
    importPngDirectory,
    parseFrm,
    serializeBamV1,
    serializeFrm,
} from "@bgforge/image";
import { bandedPair } from "../../../image/test/bam-fixtures.ts";
import type { AnimationSetLookup, AnimationSetSource } from "../../src/image-editor/set-document";
import type { ActiveCreature, SaveContext } from "../../src/image-editor/save-flow";
import type { HostToWebview } from "../../src/image-editor/webview/messages";
import { makeIeBamBase, makeMiniBam, makeMiniFrm, makeMultiFrameBam } from "./fixtures";

const GAME_DIR = "/games/bgee";
const GAME_SCHEME = "bgforge-ie-resource";

const vsc = vi.hoisted(() => ({
    disk: new Map<string, Uint8Array>(),
    writeFile: vi.fn(),
    readDirectory: vi.fn(),
    createDirectory: vi.fn(),
    showOpenDialog: vi.fn(),
    showQuickPick: vi.fn(),
    showInputBox: vi.fn(),
    showWarningMessage: vi.fn(),
    showErrorMessage: vi.fn(),
    showInformationMessage: vi.fn(),
    setStatusBarMessage: vi.fn(),
}));

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
    const FileType = { File: 1, Directory: 2 };
    const enoent = (p: string): Error => new Error(`ENOENT: ${p}`);
    /** Every path below `dir` on the in-memory disk, as `[name, type]` of its direct children. */
    const children = (dir: string): [string, number][] => {
        const prefix = `${dir.replace(/\/$/, "")}/`;
        const seen = new Map<string, number>();
        for (const key of vsc.disk.keys()) {
            if (!key.startsWith(prefix)) continue;
            const [head, ...rest] = key.slice(prefix.length).split("/");
            if (head !== undefined) seen.set(head, rest.length > 0 ? FileType.Directory : FileType.File);
        }
        return [...seen];
    };
    return {
        EventEmitter,
        FileType,
        Uri: {
            file: make,
            parse: make,
            joinPath: (base: { path: string }, ...parts: string[]) => make([base.path, ...parts].join("/")),
        },
        window: {
            showOpenDialog: vsc.showOpenDialog,
            showQuickPick: vsc.showQuickPick,
            showInputBox: vsc.showInputBox,
            showWarningMessage: vsc.showWarningMessage,
            showErrorMessage: vsc.showErrorMessage,
            showInformationMessage: vsc.showInformationMessage,
            setStatusBarMessage: vsc.setStatusBarMessage,
        },
        workspace: {
            fs: {
                readFile: (uri: { path: string }) => {
                    const bytes = vsc.disk.get(uri.path);
                    return bytes === undefined ? Promise.reject(enoent(uri.path)) : Promise.resolve(bytes);
                },
                stat: (uri: { path: string }) => {
                    if (vsc.disk.has(uri.path)) return Promise.resolve({ type: FileType.File });
                    if (children(uri.path).length > 0) return Promise.resolve({ type: FileType.Directory });
                    return Promise.reject(enoent(uri.path));
                },
                readDirectory: vsc.readDirectory.mockImplementation((uri: { path: string }) =>
                    Promise.resolve(children(uri.path)),
                ),
                writeFile: vsc.writeFile,
                createDirectory: vsc.createDirectory,
            },
        },
    };
});

const { ImageEditorDocument } = await import("../../src/image-editor/document");
const flow = await import("../../src/image-editor/save-flow");

type Document = Awaited<ReturnType<typeof ImageEditorDocument.open>>;

/** A two-action monster set - the shape `set-provider.test.ts` opens, so the two suites read one creature. */
const SET: AnimationSet = {
    id: 0x1234,
    code: "TST",
    name: "TEST_ANIM",
    prefixByArmour: new Map([[1, "TSTB"]]),
    paperdollPrefix: undefined,
    scheme: { kind: "layout" },
    layout: "actions",
};

const FILES: Record<string, Uint8Array> = {
    TSTBSD: bandedPair(2, [0, 1, 2, 3, 4]),
    TSTBWK: bandedPair(2, [0, 1, 2, 3, 4]),
};

/** A whole-set request as the dialog sends one, writing the set as it stands under its own stem. */
const AS_IT_STANDS = {
    format: "bam" as const,
    bamVersion: 1 as const,
    compressed: false,
    naming: "action-codes",
    prefix: "TSTB",
    targetId: 0x9000,
    section: "monster_old",
    notes: true,
    destination: "folder" as const,
};

/** A creature whose every colour is the one red, so a colour that crossed into a file is recognisable. */
const RED: Rgba = { r: 200, g: 10, b: 10, a: 255 };
const CREATURE: ActiveCreature = {
    resref: "AGNASI",
    name: "Agnasi",
    palette: Array.from({ length: 256 }, () => ({ ...RED })),
};

function ioFor(files: Record<string, Uint8Array>): StanceIo {
    return {
        exists: (resref) => Object.hasOwn(files, resref.toUpperCase()),
        read: (resref) => files[resref.toUpperCase()],
    };
}

function setSource(io: StanceIo = ioFor(FILES)): AnimationSetSource {
    return {
        lookup: (_dir, id) => {
            const answer: AnimationSetLookup =
                id === SET.id ? { kind: "set", set: SET, io, flavour: "tob" } : { kind: "not-declared" };
            return answer;
        },
        list: () => [SET],
    };
}

function saveContext(sets: AnimationSetSource | undefined, creature?: ActiveCreature) {
    const context: SaveContext = { animationSets: sets, activeCreature: new WeakMap() };
    return {
        context,
        withCreature(document: Document): SaveContext {
            if (creature !== undefined) context.activeCreature.set(document, creature);
            return context;
        },
    };
}

function uriOf(scheme: string, uriPath: string, query = ""): vscode.Uri {
    const make = (p: string): vscode.Uri =>
        ({
            scheme,
            path: p,
            fsPath: p,
            query,
            toString: () => `${scheme}:${p}${query === "" ? "" : `?${query}`}`,
            with: (change: { path?: string }) => make(change.path ?? p),
        }) as unknown as vscode.Uri;
    return make(uriPath);
}

/** Put a file on the disk and open it as the editor would. */
async function openFile(fsPath: string, bytes: Uint8Array, scheme = "file"): Promise<Document> {
    vsc.disk.set(fsPath, bytes);
    return ImageEditorDocument.open(uriOf(scheme, fsPath));
}

async function openSet(sets: AnimationSetSource = setSource()): Promise<Document> {
    const query = `g=${encodeURIComponent(GAME_DIR)}&a=1234`;
    return ImageEditorDocument.open(uriOf(GAME_SCHEME, "/TEST_ANIM.animset", query), undefined, undefined, sets);
}

/** Every path written, in write order. */
function writtenPaths(): string[] {
    return vsc.writeFile.mock.calls.map((call: unknown[]) => (call[0] as { path: string }).path);
}

function writtenBytes(fsPath: string): Uint8Array {
    const call = vsc.writeFile.mock.calls.find((c: unknown[]) => (c[0] as { path: string }).path === fsPath);
    if (call === undefined) throw new Error(`nothing written at ${fsPath}`);
    return call[1] as Uint8Array;
}

/** Move everything written so far onto the disk, as the folder an import will be pointed at. */
function commitWrites(): void {
    for (const call of vsc.writeFile.mock.calls) {
        vsc.disk.set((call[0] as { path: string }).path, call[1] as Uint8Array);
    }
    vsc.writeFile.mockClear();
}

/** The warning prompts raised, as `[message, detail]`. */
function warnings(): [string, string | undefined][] {
    return vsc.showWarningMessage.mock.calls.map((call: unknown[]) => [
        String(call[0]),
        (call[1] as { detail?: string } | undefined)?.detail,
    ]);
}

/** Answer every warning with its button (or dismiss the ones named), the way a reader pressing on would. */
function answerWarnings(dismiss: (message: string) => boolean = () => false): void {
    vsc.showWarningMessage.mockImplementation((message: string, _options: unknown, ...items: string[]) =>
        Promise.resolve(dismiss(message) ? undefined : items[0]),
    );
}

function pickFolder(fsPath: string | undefined): void {
    vsc.showOpenDialog.mockResolvedValue(fsPath === undefined ? undefined : [{ fsPath, path: fsPath }]);
}

/**
 * A PNG directory of one true-colour frame in four hundred distinct colours - more than a 256-entry palette
 * holds, so bringing it into an indexed document has to quantize and lose some.
 */
function writeTruecolourDirectory(dir: string): void {
    const width = 400;
    const pixels = new Uint8Array(width * 4);
    for (let i = 0; i < width; i++) pixels.set([i % 256, Math.floor(i / 2), 255 - (i % 256), 255], i * 4);
    const truecolour: RgbaAnimation = {
        colorModel: "rgba",
        sequences: [{ frameRefs: [0], facing: "none" }],
        frames: [{ width, height: 1, pixels, offsetX: 0, offsetY: 0 }],
        meta: { sourceFormat: "bamv2", fps: 15 },
    };
    const stale = [...vsc.disk.keys()].filter((key) => key.startsWith(`${dir}/`));
    for (const key of stale) vsc.disk.delete(key);
    for (const [relative, bytes] of exportPngDirectory(truecolour)) vsc.disk.set(`${dir}/${relative}`, bytes);
}

beforeEach(() => {
    vsc.disk.clear();
    for (const mock of [
        vsc.writeFile,
        vsc.createDirectory,
        vsc.showOpenDialog,
        vsc.showQuickPick,
        vsc.showInputBox,
        vsc.showWarningMessage,
        vsc.showErrorMessage,
        vsc.showInformationMessage,
        vsc.setStatusBarMessage,
    ]) {
        mock.mockReset();
    }
    vsc.writeFile.mockResolvedValue(undefined);
    vsc.createDirectory.mockResolvedValue(undefined);
    vsc.readDirectory.mockClear();
    answerWarnings();
});

describe("Save As for a file", () => {
    /**
     * A resource read out of a game's archives has no folder, so naming the export "next to the source"
     * would put it at the filesystem root. The reader is asked for one instead.
     */
    it("asks for a folder when the document is not a file on disk, and writes there", async () => {
        const document = await openFile("/MINI.frm", serializeFrm(makeMiniFrm()), GAME_SCHEME);
        const { context } = saveContext(undefined);
        pickFolder("/out");

        await flow.handleSaveAs(context, document, "png-directory", undefined);

        expect(vsc.showOpenDialog.mock.calls[0]?.[0]).toMatchObject({ title: "Choose a folder for MINI.frm" });
        expect(writtenPaths()).toContain("/out/MINI/manifest.json");
        expect(writtenPaths().every((p) => p.startsWith("/out/MINI/"))).toBe(true);
    });

    it("writes nothing when that folder picker is dismissed", async () => {
        const document = await openFile("/MINI.frm", serializeFrm(makeMiniFrm()), GAME_SCHEME);
        pickFolder(undefined);

        await flow.handleSaveAs(saveContext(undefined).context, document, "png-directory", undefined);

        expect(vsc.writeFile).not.toHaveBeenCalled();
    });

    /** The one place a creature's colours are baked in, so it is consented to and then really in the file. */
    it("bakes a chosen creature's colours into a PNG export only once the reader agrees", async () => {
        const document = await openFile("/art/MULTI.bam", serializeBamV1(makeMultiFrameBam()));
        const context = saveContext(undefined, CREATURE).withCreature(document);

        answerWarnings(() => true);
        await flow.handleSaveAs(context, document, "png-directory", undefined);
        expect(warnings()).toEqual([
            [
                "Converting will lose data.",
                "- written in Agnasi (AGNASI)'s colours - the result cannot be recoloured as another creature",
            ],
        ]);
        expect(vsc.writeFile).not.toHaveBeenCalled();

        answerWarnings();
        await flow.handleSaveAs(context, document, "png-directory", undefined);
        commitWrites();
        const files = new Map(
            [...vsc.disk].flatMap(([p, bytes]) =>
                p.startsWith("/art/MULTI/") ? [[p.slice("/art/MULTI/".length), bytes] as const] : [],
            ),
        );
        const imported = importPngDirectory(files);
        if (imported.colorModel === "rgba")
            throw new Error("a PNG directory of an indexed BAM read back as true colour");
        // Frame 1's first pixel is index 1 - a colour the file's own palette has as black, the creature's as red.
        const index = imported.frames[1]?.pixels[0] ?? -1;
        expect(imported.palette[index]).toEqual(RED);
    });

    /** A multi-cycle animation with no directions cannot fill FRM's six rotations on its own. */
    it("asks which cycle a directionless animation's FRM uses, and writes that cycle", async () => {
        // Under the Fallout palette itself, so the nearest-match remap leaves every index as it was.
        const bam = { ...makeMultiFrameBam(), palette: DEFAULT_FALLOUT_PALETTE.map((c) => ({ ...c })) };
        const document = await openFile("/art/MULTI.bam", serializeBamV1(bam));
        vsc.showQuickPick.mockImplementation((items: string[]) => Promise.resolve(items[1]));

        await flow.handleSaveAs(saveContext(undefined).context, document, "frm", "nearest");

        expect(vsc.showQuickPick.mock.calls[0]?.[0]).toEqual(["Cycle 0", "Cycle 1"]);
        const frm = parseFrm(writtenBytes("/art/MULTI.frm"));
        expect(frm.sequences).toHaveLength(6);
        // makeMultiFrameBam's frame i holds the indices i and i + 10, so cycle 1 is frames 3-5.
        const drawn = new Set(frm.frames.flatMap((frame) => [...frame.pixels]));
        expect([...drawn].sort((a, b) => a - b)).toEqual([3, 4, 5, 13, 14, 15]);
    });

    it("writes nothing when the cycle picker is dismissed", async () => {
        const document = await openFile("/art/MULTI.bam", serializeBamV1(makeMultiFrameBam()));
        vsc.showQuickPick.mockResolvedValue(undefined);

        await flow.handleSaveAs(saveContext(undefined).context, document, "frm", "nearest");

        expect(vsc.writeFile).not.toHaveBeenCalled();
    });

    /** An IE creature file converts one direction block; the pick maps back through the block's own index. */
    it("asks which direction block an IE creature file's FRM uses, and writes that block", async () => {
        const document = await openFile("/art/MOGHG1.bam", serializeBamV1(makeIeBamBase()));
        vsc.showQuickPick.mockImplementation((items: string[]) => Promise.resolve(items[1]));

        await flow.handleSaveAs(saveContext(undefined).context, document, "frm", "nearest");

        expect(vsc.showQuickPick.mock.calls[0]?.[0]).toHaveLength(2);
        const frm = parseFrm(writtenBytes("/art/MOGHG1.frm"));
        // makeIeBamBase numbers block 1's west frames 17-21 and block 0's 1-5; the fixture's palette is the
        // Fallout one, so the nearest-match remap leaves the indices as they were.
        const drawn = new Set(frm.frames.flatMap((frame) => [...frame.pixels]));
        expect([...drawn].every((v) => v >= 17 && v <= 21)).toBe(true);
    });

    it("writes nothing when the direction block picker is dismissed", async () => {
        const document = await openFile("/art/MOGHG1.bam", serializeBamV1(makeIeBamBase()));
        vsc.showQuickPick.mockResolvedValue(undefined);

        await flow.handleSaveAs(saveContext(undefined).context, document, "frm", "nearest");

        expect(vsc.writeFile).not.toHaveBeenCalled();
    });

    it("writes no BAM v2 when the reader declines baking in a creature's colours", async () => {
        const document = await openFile("/art/MULTI.bam", serializeBamV1(makeMultiFrameBam()));
        const context = saveContext(undefined, CREATURE).withCreature(document);
        answerWarnings(() => true);

        await flow.handleSaveAs(context, document, "bamv2", undefined);

        expect(warnings()[0]?.[1]).toContain("written in Agnasi (AGNASI)'s colours");
        expect(vsc.writeFile).not.toHaveBeenCalled();
        expect(vsc.showInputBox).not.toHaveBeenCalled();
    });

    /** Save As names its destination itself, so replacing something already there needs its own consent. */
    it("asks before replacing an export already beside the source, and writes nothing if refused", async () => {
        const document = await openFile("/art/MULTI.bam", serializeBamV1(makeMultiFrameBam()));
        vsc.disk.set("/art/MULTI/manifest.json", Uint8Array.from([1]));
        answerWarnings(() => true);

        await flow.handleSaveAs(saveContext(undefined).context, document, "png-directory", undefined);

        expect(warnings()).toEqual([["MULTI already exists - overwrite?", undefined]]);
        expect(vsc.writeFile).not.toHaveBeenCalled();
    });

    /** Re-encoding a file onto its own name is the save itself, not a collision with something else. */
    it("writes over its own source without asking", async () => {
        const document = await openFile("/art/MULTI.bam", serializeBamV1(makeMultiFrameBam()));

        await flow.handleSaveAs(saveContext(undefined).context, document, "bam", undefined);

        expect(vsc.showWarningMessage).not.toHaveBeenCalled();
        expect(writtenPaths()).toEqual(["/art/MULTI.bam"]);
    });

    /**
     * One cycle fills every rotation with no question to ask. A creature named by nothing the string table
     * resolved is still named, by its resref, in the consent that bakes its colours in.
     */
    it("writes a one-cycle FRM in a nameless creature's colours only once the reader agrees", async () => {
        const document = await openFile("/art/MINI.bam", serializeBamV1(makeMiniBam()));
        const context = saveContext(undefined, { ...CREATURE, resref: "ZOMBIE1", name: "" }).withCreature(document);

        answerWarnings(() => true);
        await flow.handleSaveAs(context, document, "frm", undefined);
        expect(warnings().map(([, detail]) => detail)).toEqual([
            expect.stringContaining("written in ZOMBIE1's colours"),
        ]);
        expect(vsc.writeFile).not.toHaveBeenCalled();

        answerWarnings();
        await flow.handleSaveAs(context, document, "frm", undefined);
        expect(vsc.showQuickPick).not.toHaveBeenCalled();
        expect(parseFrm(writtenBytes("/art/MINI.frm")).sequences).toHaveLength(6);
    });
});

describe("the first PVRZ page", () => {
    it("asks once, keeps the answer, and does not ask again", async () => {
        const document = await openFile("/art/MULTI.bam", serializeBamV1(makeMultiFrameBam()));
        vsc.showInputBox.mockResolvedValue(" 4200 ");

        expect(await flow.ensureBasePage(document, true)).toBe(true);
        expect(await flow.ensureBasePage(document, true)).toBe(true);

        expect(vsc.showInputBox).toHaveBeenCalledTimes(1);
        expect(document.chosenBasePage()).toBe(4200);
    });

    /** Never defaulted: a number the game already ships corrupts its graphics, so only a real number passes. */
    it("accepts only a page number of up to four digits", async () => {
        const document = await openFile("/art/MULTI.bam", serializeBamV1(makeMultiFrameBam()));
        vsc.showInputBox.mockResolvedValue(undefined);

        expect(await flow.ensureBasePage(document, true)).toBe(false);

        const options = vsc.showInputBox.mock.calls[0]?.[0] as
            | { validateInput: (value: string) => string | undefined }
            | undefined;
        if (options === undefined) throw new Error("no page number was asked for");
        const refusal = "Enter a page number between 0 and 9999.";
        expect([" 12 ", "9999", "abc", "10000", ""].map((value) => options.validateInput(value))).toEqual([
            undefined,
            undefined,
            refusal,
            refusal,
            refusal,
        ]);
        expect(document.chosenBasePage()).toBeUndefined();
    });

    it("asks nothing when no page is needed", async () => {
        const document = await openFile("/art/MULTI.bam", serializeBamV1(makeMultiFrameBam()));

        expect(await flow.ensureBasePage(document, false)).toBe(true);

        expect(vsc.showInputBox).not.toHaveBeenCalled();
    });
});

describe("Save As for a whole set, with no dialog behind it", () => {
    /** Named before the folder is picked: a reader who would rather fix the install should not pick first. */
    it("names the members it cannot read and writes the rest only once the reader agrees", async () => {
        const broken = ioFor({ ...FILES, TSTBWK: Uint8Array.from([1, 2, 3]) });
        const document = await openSet(setSource(broken));
        const context = saveContext(setSource(broken)).context;
        pickFolder("/out");

        answerWarnings(() => true);
        await flow.handleSaveAs(context, document, "bam", undefined);
        expect(warnings()).toEqual([["1 file(s) of this set cannot be read and will be left out.", "TSTBWK"]]);
        expect(vsc.showOpenDialog).not.toHaveBeenCalled();

        answerWarnings();
        await flow.handleSaveAs(context, document, "bam", undefined);
        expect(writtenPaths()).toEqual(["/out/TSTBSD.bam"]);
    });

    it("asks for the first page of a BAM v2 set once, and writes from it", async () => {
        const document = await openSet();
        const context = saveContext(setSource()).context;
        pickFolder("/out");
        vsc.showInputBox.mockResolvedValue("4200");

        await flow.handleSaveAs(context, document, "bamv2", undefined);

        expect(vsc.showInputBox).toHaveBeenCalledTimes(1);
        expect(vsc.showInputBox.mock.calls[0]?.[0]).toMatchObject({ title: "PVRZ page number for TEST_ANIM" });
        expect(writtenPaths()).toContain("/out/MOS4200.PVRZ");
    });

    it("writes no BAM v2 set when the page prompt is dismissed", async () => {
        const document = await openSet();
        pickFolder("/out");
        vsc.showInputBox.mockResolvedValue(undefined);

        await flow.handleSaveAs(saveContext(setSource()).context, document, "bamv2", undefined);

        expect(vsc.writeFile).not.toHaveBeenCalled();
    });

    it("writes no set in a creature's colours when the reader declines the loss", async () => {
        const document = await openSet();
        const context = saveContext(setSource(), CREATURE).withCreature(document);
        pickFolder("/out");
        answerWarnings(() => true);

        await flow.handleSaveAs(context, document, "bam", undefined);

        expect(warnings().map(([, detail]) => detail)).toEqual([
            expect.stringContaining("written in the chosen creature's colours"),
        ]);
        expect(vsc.writeFile).not.toHaveBeenCalled();

        answerWarnings();
        await flow.handleSaveAs(context, document, "bam", undefined);
        expect(writtenPaths().sort()).toEqual(["/out/TSTBSD.bam", "/out/TSTBWK.bam"]);
    });

    /** What a folder holds is only knowable once it is picked, so this consent survives the dialog's others. */
    it("names every member file the chosen folder already holds, and writes nothing if refused", async () => {
        const document = await openSet();
        vsc.disk.set("/out/TSTBSD.bam", Uint8Array.from([1]));
        vsc.disk.set("/out/TSTBWK.bam", Uint8Array.from([1]));
        pickFolder("/out");
        answerWarnings(() => true);

        await flow.handleSaveAs(saveContext(setSource()).context, document, "bam", undefined);

        expect(warnings()).toEqual([["2 files already exist - overwrite?", "TSTBSD.bam\nTSTBWK.bam"]]);
        expect(vsc.writeFile).not.toHaveBeenCalled();
    });

    /** The install a set came from is recorded for the reader where it is still known, and left out where not. */
    it("records no install in the manifest of a set whose game is no longer open", async () => {
        const document = await openSet();
        pickFolder("/out");

        await flow.handleSaveAs(saveContext(undefined).context, document, "png-directory", undefined);

        const manifest = JSON.parse(new TextDecoder().decode(writtenBytes("/out/set.json"))) as {
            source: Record<string, unknown>;
        };
        expect(manifest.source).toEqual({ id: 0x1234, title: "TEST_ANIM" });
    });
});

describe("planning a set save", () => {
    it("names the members that cannot be read and are left out", async () => {
        const broken = ioFor({ ...FILES, TSTBWK: Uint8Array.from([1, 2, 3]) });
        const document = await openSet(setSource(broken));

        const plan = await flow.planSave(saveContext(setSource(broken)).context, document, AS_IT_STANDS);

        expect(plan?.notes).toContain("1 file(s) cannot be read and are left out: TSTBWK");
        expect(plan?.shown).toEqual(["TSTBSD.bam"]);
    });

    it("lists baking in a creature's colours as the save's loss", async () => {
        const document = await openSet();
        const context = saveContext(setSource(), CREATURE).withCreature(document);

        const plan = await flow.planSave(context, document, AS_IT_STANDS);

        expect(plan?.outcome).toBe("lossy");
        expect(plan?.losses).toEqual([
            "written in the chosen creature's colours - the result cannot be recoloured as another creature",
        ]);
    });

    /** "Could not be read" is not "empty": a plan claiming no collisions in a folder it never saw would lie. */
    it("says when the chosen folder could not be looked into", async () => {
        const document = await openSet();
        vsc.readDirectory.mockRejectedValueOnce(new Error("EACCES"));

        const plan = await flow.planSave(saveContext(setSource()).context, document, {
            ...AS_IT_STANDS,
            folder: "/locked",
        });

        expect(plan?.notes).toContain("/locked could not be read, so what it already holds is unknown.");
    });

    /** The install's own override folder is a real place, so the plan names it and looks into it. */
    it("names the override folder as the destination and finds nothing there to replace", async () => {
        const document = await openSet();

        const plan = await flow.planSave(saveContext(setSource()).context, document, {
            ...AS_IT_STANDS,
            destination: "override",
        });

        expect(plan?.destination).toBe("/games/bgee/override");
        expect(plan?.notes).toEqual([]);
        expect(vsc.readDirectory).toHaveBeenCalledTimes(1);
    });

    /** Both write more files than the names listed, so the plan says so rather than counting them wrong. */
    it("says what a PNG directory or a BAM v2 set writes beyond the names it lists", async () => {
        const document = await openSet();
        const context = saveContext(setSource()).context;

        const directory = await flow.planSave(context, document, { ...AS_IT_STANDS, format: "png-directory" });
        const v2 = await flow.planSave(context, document, { ...AS_IT_STANDS, bamVersion: 2 });

        expect(directory?.shown).toEqual(["set.json", "TSTBSD", "TSTBWK"]);
        expect(directory?.notes).toEqual(["Each member is a folder of one PNG per frame."]);
        expect(v2?.notes).toEqual(["Each member also writes the MOS PVRZ pages its frames need."]);
        expect(v2?.needsBasePage).toBe(true);
    });

    it("plans nothing for a document that is not a set", async () => {
        const document = await openFile("/art/MULTI.bam", serializeBamV1(makeMultiFrameBam()));

        expect(await flow.planSave(saveContext(setSource()).context, document, AS_IT_STANDS)).toBeUndefined();
    });
});

describe("running a set save", () => {
    /** The plan disables Save on this, but a run reaching the converter must not write v1 files as v2. */
    it("refuses a reshape into BAM v2 without writing or asking anything", async () => {
        const document = await openSet();
        const posted: HostToWebview[] = [];

        await flow.runSave(
            saveContext(setSource()).context,
            document,
            { ...AS_IT_STANDS, prefix: "NEWB", bamVersion: 2 },
            (message) => void posted.push(message),
        );

        expect(posted).toEqual([
            {
                type: "error",
                message:
                    "A reshaped set is written as BAM v1 - nothing here writes BAM v2 into a new layout. " +
                    "Pick BAM v1, or write the set as it stands to get v2 files.",
            },
        ]);
        expect(vsc.showOpenDialog).not.toHaveBeenCalled();
        expect(vsc.writeFile).not.toHaveBeenCalled();
    });

    /** A reshape into BAM v1 can still be the compressed container, and the files are what was asked for. */
    it("writes a reshaped set as compressed BAMs when the request asks for them", async () => {
        const document = await openSet();

        await flow.runSave(
            saveContext(setSource()).context,
            document,
            { ...AS_IT_STANDS, prefix: "NEWB", compressed: true, notes: false, folder: "/out" },
            () => {},
        );

        const art = writtenPaths().filter((p) => !p.endsWith(".ini"));
        expect(art.length).toBeGreaterThan(0);
        for (const p of art) expect(new TextDecoder().decode(writtenBytes(p).subarray(0, 4))).toBe("BAMC");
        expect(vsc.showInformationMessage).toHaveBeenCalledWith(`Wrote TEST_ANIM: ${art.length + 1} files in /out.`);
    });
});

describe("writing a set as it stands", () => {
    const post = (): void => {
        throw new Error("a save written as it stands posts nothing");
    };

    /** The override folder is where a plain Save already writes, so it takes no picker. */
    it("writes each member into the install's override folder without asking where", async () => {
        const document = await openSet();

        await flow.runSave(
            saveContext(setSource()).context,
            document,
            { ...AS_IT_STANDS, destination: "override" },
            post,
        );

        expect(vsc.showOpenDialog).not.toHaveBeenCalled();
        expect(writtenPaths().sort()).toEqual(["/games/bgee/override/TSTBSD.bam", "/games/bgee/override/TSTBWK.bam"]);
    });

    /** Every question was answered in the dialog, so the run raises none of them again. */
    it("writes a BAM v2 set from the folder and page the dialog carried, asking nothing", async () => {
        const document = await openSet();

        await flow.runSave(
            saveContext(setSource()).context,
            document,
            { ...AS_IT_STANDS, bamVersion: 2, folder: "/out", basePage: 4200 },
            post,
        );

        expect(vsc.showOpenDialog).not.toHaveBeenCalled();
        expect(vsc.showInputBox).not.toHaveBeenCalled();
        expect(writtenPaths()).toContain("/out/MOS4200.PVRZ");
    });
});

describe("importing a PNG directory", () => {
    it("does nothing when the picker is dismissed", async () => {
        const document = await openFile("/art/MULTI.bam", serializeBamV1(makeMultiFrameBam()));
        pickFolder(undefined);

        await flow.handleImport(document, "append");

        expect(document.animation.sequences).toHaveLength(2);
        expect(vsc.showWarningMessage).not.toHaveBeenCalled();
    });

    it("guides the reader to an export when the folder holds no manifest", async () => {
        const document = await openFile("/art/MULTI.bam", serializeBamV1(makeMultiFrameBam()));
        vsc.disk.set("/pictures/cat.png", Uint8Array.from([1]));
        pickFolder("/pictures");

        await flow.handleImport(document, "append");

        expect(warnings()).toEqual([
            [
                '"pictures" is not an exported animation (no manifest.json or set.json inside). Pick the folder ' +
                    'written by "Save as > PNG directory", or one of its manifests.',
                undefined,
            ],
        ]);
        expect(document.animation.sequences).toHaveLength(2);
    });

    /** Picking the manifest file is the same as picking its folder, and nested frame folders are read. */
    it("appends the cycles of a directory picked by its manifest", async () => {
        const source = await openFile("/art/MULTI.bam", serializeBamV1(makeMultiFrameBam()));
        await flow.handleSaveAs(saveContext(undefined).context, source, "png-directory", undefined);
        commitWrites();
        const document = await openFile("/art/OTHER.bam", serializeBamV1(makeMultiFrameBam()));
        pickFolder("/art/MULTI/manifest.json");

        await flow.handleImport(document, "append");

        expect(document.animation.sequences).toHaveLength(4);
    });

    it("says what is wrong with a malformed export instead of a codec's own prefix", async () => {
        const document = await openFile("/art/MULTI.bam", serializeBamV1(makeMultiFrameBam()));
        vsc.disk.set("/in/manifest.json", new TextEncoder().encode("{}"));
        pickFolder("/in");

        await flow.handleImport(document, "append");

        const [[message]] = warnings() as [[string, undefined]];
        expect(message).toMatch(/^Can't import "in": /);
        expect(message).not.toMatch(/importPngDirectory:/);
        expect(document.animation.sequences).toHaveLength(2);
    });

    /** True colour into an indexed document is the one lossy direction, so it sits behind the same consent. */
    it("quantizes true-colour frames into an indexed document only once the reader agrees", async () => {
        writeTruecolourDirectory("/in");
        const document = await openFile("/art/MULTI.bam", serializeBamV1(makeMultiFrameBam()));
        pickFolder("/in");

        answerWarnings(() => true);
        await flow.handleImport(document, "replace");
        expect(warnings()[0]?.[0]).toBe("Importing will lose data.");
        expect(document.animation.sequences).toHaveLength(2);

        answerWarnings();
        await flow.handleImport(document, "replace");
        expect(document.animation.sequences).toHaveLength(1);
        expect(document.animation.colorModel).toBeUndefined();
    });

    /** An FRM is always six rotations, so an import into one is reshaped and always replaces. */
    it("reshapes an import into an FRM through the cycle picker, replacing whatever it held", async () => {
        const source = await openFile("/art/MULTI.bam", serializeBamV1(makeMultiFrameBam()));
        await flow.handleSaveAs(saveContext(undefined).context, source, "png-directory", undefined);
        commitWrites();
        const document = await openFile("/art/MINI.frm", serializeFrm(makeMiniFrm()));
        pickFolder("/art/MULTI");

        vsc.showQuickPick.mockResolvedValue(undefined);
        await flow.handleImport(document, "append");
        expect(document.animation.frames).toHaveLength(6);

        vsc.showQuickPick.mockImplementation((items: string[]) => Promise.resolve(items[0]));
        await flow.handleImport(document, "append");
        expect(document.animation.sequences).toHaveLength(6);
        // Every rotation shows cycle 0's three frames - replaced, not appended to the six already there.
        expect(document.animation.sequences.every((sequence) => sequence.frameRefs.length === 3)).toBe(true);
    });
});

describe("importing an exported set", () => {
    /** The same creature drawn at three pixels a side, so a member the import reached is told by its width. */
    const WIDE = ioFor({ TSTBSD: bandedPair(3, [0, 1, 2, 3, 4]), TSTBWK: bandedPair(3, [0, 1, 2, 3, 4]) });

    /** Export the two-pixel set to `/exp` through Save As, and open the three-pixel one to import it into. */
    async function exportThenOpenWide(): Promise<Document> {
        const source = await openSet();
        pickFolder("/exp");
        await flow.handleSaveAs(saveContext(setSource()).context, source, "png-directory", undefined);
        commitWrites();
        return openSet(setSource(WIDE));
    }

    function widths(document: Document): Record<string, number | undefined> {
        const members = document.setState?.allMembers().members ?? [];
        return Object.fromEntries(members.map((m) => [m.resref, m.model.animation.frames[0]?.width]));
    }

    /** Rename members in the export's manifest, so the folder names files the open set does or does not draw. */
    function renameInManifest(renames: Record<string, string>): void {
        const bytes = vsc.disk.get("/exp/set.json");
        if (bytes === undefined) throw new Error("the export wrote no set.json");
        const manifest = JSON.parse(new TextDecoder().decode(bytes)) as { members: { resref: string }[] };
        for (const member of manifest.members) member.resref = renames[member.resref] ?? member.resref;
        vsc.disk.set("/exp/set.json", new TextEncoder().encode(JSON.stringify(manifest)));
    }

    it("replaces every member of the open set from its exported folder", async () => {
        const document = await exportThenOpenWide();
        expect(widths(document)).toEqual({ TSTBSD: 3, TSTBWK: 3 });

        await flow.handleImport(document, "replace");

        expect(widths(document)).toEqual({ TSTBSD: 2, TSTBWK: 2 });
        expect(vsc.setStatusBarMessage).toHaveBeenCalledWith("Imported 2 file(s) of TEST_ANIM", 3000);
    });

    /** A partial import is a legitimate thing to want; a silent one looks like a whole-set import and is not. */
    it("names both kinds of mismatch, and imports only the matched members once the reader agrees", async () => {
        const document = await exportThenOpenWide();
        renameInManifest({ TSTBWK: "TSTBXX" });

        answerWarnings(() => true);
        await flow.handleImport(document, "replace");
        expect(warnings()).toEqual([
            [
                "This folder covers 1 of the set's 2 files.",
                "- TSTBWK: nothing in the folder replaces it\n- TSTBXX: in the folder, not in this set",
            ],
        ]);
        expect(widths(document)).toEqual({ TSTBSD: 3, TSTBWK: 3 });

        answerWarnings();
        await flow.handleImport(document, "replace");
        expect(widths(document)).toEqual({ TSTBSD: 2, TSTBWK: 3 });
    });

    /** Each member is adapted against its own colour model, and a lossy one stops the whole import. */
    it("imports no member when one of them would lose colours and the reader declines", async () => {
        const document = await exportThenOpenWide();
        writeTruecolourDirectory("/exp/TSTBSD");
        answerWarnings(() => true);

        await flow.handleImport(document, "replace");

        expect(warnings()[0]?.[0]).toBe("Importing will lose data.");
        expect(widths(document)).toEqual({ TSTBSD: 3, TSTBWK: 3 });
    });

    it("refuses a folder none of whose files belong to the open set", async () => {
        const document = await exportThenOpenWide();
        renameInManifest({ TSTBSD: "OTHRSD", TSTBWK: "OTHRWK" });

        await flow.handleImport(document, "replace");

        expect(vsc.showErrorMessage).toHaveBeenCalledWith(
            'Import failed: None of the files in "TEST_ANIM" belong to the open set.',
        );
        expect(widths(document)).toEqual({ TSTBSD: 3, TSTBWK: 3 });
    });

    it("refuses a whole exported set for a single-file document, naming what to open", async () => {
        const set = await openSet();
        pickFolder("/exp");
        await flow.handleSaveAs(saveContext(setSource()).context, set, "png-directory", undefined);
        commitWrites();
        const document = await openFile("/art/MULTI.bam", serializeBamV1(makeMultiFrameBam()));

        await flow.handleImport(document, "replace");

        expect(vsc.showErrorMessage).toHaveBeenCalledWith(
            'Import failed: "TEST_ANIM" is a whole exported set. Open the set it belongs to, or pick one member ' +
                "folder inside it to import that member alone.",
        );
    });
});
