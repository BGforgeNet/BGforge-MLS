import { describe, expect, it } from "vitest";
import { type AnimationSet, type StanceIo } from "@bgforge/animation";
import { type Frame, type IndexedAnimation, type Rgba, encodeBamc, serializeBamV1 } from "@bgforge/image";
import { AnimationSetState, createAnimationSetSource, setView, stanceKey } from "../../src/image-editor/set-document";
import type { Game } from "@bgforge/binary";

function palette(): Rgba[] {
    return Array.from({ length: 256 }, (_, i) => ({ r: i, g: i, b: i, a: 255 }));
}

function frame(seed: number): Frame {
    return { width: 2, height: 2, pixels: new Uint8Array([seed, seed, seed, seed]), offsetX: 1, offsetY: 1 };
}

/**
 * A base-file shaped BAM: `bands` blocks of 8 cycles, the first five carrying their own frames and the
 * last three padded with one shared frame - the shape the direction interpreter recognises.
 *
 * `seed` shifts every drawn pixel, so two members built here are distinguishable by what they draw rather
 * than only by their names - which is what lets a test tell one action's model from another's.
 */
function baseFileBam(bands: number, seed = 0): Uint8Array {
    const frames: Frame[] = [frame(seed)];
    const sequences = [];
    for (let band = 0; band < bands; band++) {
        for (let slot = 0; slot < 8; slot++) {
            if (slot < 5) {
                const first = frames.length;
                frames.push(frame(seed + first), frame(seed + first + 1));
                sequences.push({ frameRefs: [first, first + 1], facing: "none" as const });
            } else {
                sequences.push({ frameRefs: [0, 0], facing: "none" as const });
            }
        }
    }
    const animation: IndexedAnimation = { palette: palette(), sequences, frames, meta: { sourceFormat: "bam" } };
    return serializeBamV1(animation);
}

/** The io a set reads its members through, plus a tally of what it was asked for. */
function fakeIo(files: Record<string, Uint8Array>): StanceIo & { reads: string[] } {
    const reads: string[] = [];
    return {
        reads,
        exists: (resref) => Object.hasOwn(files, resref.toUpperCase()),
        read: (resref) => {
            reads.push(resref.toUpperCase());
            return files[resref.toUpperCase()];
        },
    };
}

function setOf(overrides: Partial<AnimationSet> = {}): AnimationSet {
    return {
        id: 0x1234,
        code: "TST",
        name: "TEST_ANIM",
        prefixByArmour: new Map([[1, "TSTB"]]),
        paperdollPrefix: undefined,
        scheme: { kind: "unimplemented", scheme: 1, reason: "the monster scheme is not implemented yet" },
        layout: "cycles",
        ...overrides,
    };
}

/** What the open model's first drawn frame paints - the cheapest way to tell two members apart. */
function drawnPixel(state: AnimationSetState): number | undefined {
    return state.model.indexedAnimation()?.frames[1]?.pixels[0];
}

describe("AnimationSetState", () => {
    it("opens on the first action the armour declares", () => {
        const state = AnimationSetState.open(setOf(), fakeIo({ TSTBG1: baseFileBam(2) }));
        expect(state?.action.resref).toBe("TSTBG1");
        expect(state?.armour).toBe(1);
    });

    /**
     * One row per STANCE, spanning the set's files. Which file holds a given stance is a convention of the
     * naming family - the same creature ships as ten single-band files under one and three packed ones
     * under another - so a reader choosing a file first is being asked about packaging, not about what
     * they want to see. The file is still the unit a model and a save work in; it just is not a choice.
     */
    it("offers one stance per direction band, across every file the set draws", () => {
        const state = AnimationSetState.open(setOf(), fakeIo({ TSTBG1: baseFileBam(3), TSTBG2: baseFileBam(2) }));

        expect(state?.stances.map((stance) => [stance.resref, stance.band])).toEqual([
            ["TSTBG1", 0],
            ["TSTBG1", 1],
            ["TSTBG1", 2],
            ["TSTBG2", 0],
            ["TSTBG2", 1],
        ]);
    });

    /** Every band of a file shares its resref, so the file alone cannot address a row. */
    it("keys each stance by its file AND its band", () => {
        const state = AnimationSetState.open(setOf(), fakeIo({ TSTBG1: baseFileBam(3) }));
        const keys = state?.stances.map((stance) => stanceKey(stance)) ?? [];

        expect(new Set(keys).size).toBe(keys.length);
    });

    it("moves the drawn band without reloading the model when the stance stays in one file", () => {
        const state = AnimationSetState.open(setOf(), fakeIo({ TSTBG1: baseFileBam(3) }));
        const model = state?.model;

        expect(state?.select(stanceKey({ resref: "TSTBG1", band: 2 }))).toBe("changed");
        expect(state?.band).toBe(2);
        // The same object, not merely an equal one: a reload would discard the reader's unsaved edits.
        expect(state?.model).toBe(model);
    });

    /**
     * A save writes each half of a two-file member back in the encoding it was read in, so the state has to
     * answer per file rather than from the one model both halves were composed into.
     */
    it("reports each member file's stored encoding", () => {
        const io = fakeIo({ TSTBG1: baseFileBam(1), TSTBG1E: encodeBamc(baseFileBam(1)) });
        const state = AnimationSetState.open(setOf(), io);

        expect(state?.storedFormat("TSTBG1")).toBe("bam");
        expect(state?.storedFormat("TSTBG1E")).toBe("bamc");
        expect(state?.storedFormat("TSTBCA")).toBe("bam");
    });

    it("has no document for a set the install ships nothing of", () => {
        expect(AnimationSetState.open(setOf(), fakeIo({}))).toBeUndefined();
    });

    it("swaps the model when a stance in another file is selected", () => {
        const io = fakeIo({ TSTBG1: baseFileBam(1, 0), TSTBG2: baseFileBam(1, 100) });
        const state = AnimationSetState.open(setOf(), io);
        const before = drawnPixel(state!);

        expect(state?.select("TSTBG2#0")).toBe("changed");
        expect(state?.action.resref).toBe("TSTBG2");
        expect(drawnPixel(state!)).not.toBe(before);
        expect(drawnPixel(state!)).toBe(101);
    });

    it("keeps the open stance when asked for one the set does not name", () => {
        const state = AnimationSetState.open(setOf(), fakeIo({ TSTBG1: baseFileBam(1) }));

        expect(state?.select("TSTBCA#0")).toBe("refused");
        expect(state?.action.resref).toBe("TSTBG1");
    });

    /** Showing what is already shown is not a failure, and reporting it as one puts an error in the way. */
    it("reports re-picking the open stance and the open armour as no change, not as a refusal", () => {
        const state = AnimationSetState.open(setOf(), fakeIo({ TSTBG1: baseFileBam(1) }));

        expect(state?.select("TSTBG1#0")).toBe("unchanged");
        expect(state?.selectArmour(1)).toBe("unchanged");
    });

    it("keeps the open stance when the file it sits in will not parse", () => {
        const io = fakeIo({ TSTBG1: baseFileBam(1), TSTBG2: new Uint8Array([1, 2, 3, 4]) });
        const state = AnimationSetState.open(setOf(), io);

        expect(state?.select("TSTBG2#0")).toBe("refused");
        expect(state?.action.resref).toBe("TSTBG1");
    });

    it("builds each file's model once, however often its stances are reselected", () => {
        const io = fakeIo({ TSTBG1: baseFileBam(1), TSTBG2: baseFileBam(1) });
        const state = AnimationSetState.open(setOf(), io);
        state?.select("TSTBG2#0");
        // Counted from here rather than from zero: resolving the stance list reads every member's cycle
        // table, so an absolute count would measure that pass rather than the model cache.
        const settled = io.reads.length;

        state?.select("TSTBG1#0");
        state?.select("TSTBG2#0");

        expect(io.reads.length).toBe(settled);
    });

    it("re-reads the open action's members on reload", () => {
        const files: Record<string, Uint8Array> = { TSTBG1: baseFileBam(1, 0) };
        const state = AnimationSetState.open(setOf(), fakeIo(files));
        files.TSTBG1 = baseFileBam(1, 100);

        expect(state?.reload()).toBe(true);
        expect(state?.action.resref).toBe("TSTBG1");
        expect(drawnPixel(state!)).toBe(101);
    });

    it("keeps the loaded picture when reload finds nothing left to draw", () => {
        const files: Record<string, Uint8Array> = { TSTBG1: baseFileBam(1, 0) };
        const state = AnimationSetState.open(setOf(), fakeIo(files));
        delete files.TSTBG1;

        expect(state?.reload()).toBe(false);
        expect(drawnPixel(state!)).toBe(1);
    });

    /**
     * The declared level count is the animation family's, not the install's: a classic archive ships no
     * plate-armoured thief, and a picker offering the declared level hands the reader an empty row.
     */
    it("offers only the armour levels this install draws", () => {
        const set = setOf({
            prefixByArmour: new Map([
                [1, "TSTB"],
                [2, "TSTC"],
                [3, "TSTD"],
            ]),
        });
        const state = AnimationSetState.open(set, fakeIo({ TSTBG1: baseFileBam(1), TSTDG1: baseFileBam(1) }));

        expect(state?.armours).toEqual([1, 3]);
    });

    it("opens on the lowest level that draws rather than the lowest declared", () => {
        const set = setOf({
            prefixByArmour: new Map([
                [1, "TSTB"],
                [2, "TSTC"],
            ]),
        });
        const state = AnimationSetState.open(set, fakeIo({ TSTCG1: baseFileBam(1) }));

        expect(state?.armour).toBe(2);
        expect(state?.armours).toEqual([2]);
    });

    it("re-resolves the action list when the armour changes", () => {
        const set = setOf({
            prefixByArmour: new Map([
                [1, "TSTB"],
                [2, "TSTC"],
            ]),
        });
        const state = AnimationSetState.open(set, fakeIo({ TSTBG1: baseFileBam(1), TSTCG2: baseFileBam(1) }));

        expect(state?.armours).toEqual([1, 2]);
        expect(state?.selectArmour(2)).toBe("changed");
        expect(state?.armour).toBe(2);
        expect(state?.stances.map((stance) => stance.resref)).toEqual(["TSTCG2"]);
    });

    /**
     * A model carries its own unsaved edits, so a cache the armour picker cleared would throw them away
     * silently: the member would come back from the archive looking untouched.
     */
    it("keeps a member's unsaved edits across an armour change", () => {
        const set = setOf({
            prefixByArmour: new Map([
                [1, "TSTB"],
                [2, "TSTC"],
            ]),
        });
        const state = AnimationSetState.open(set, fakeIo({ TSTBG1: baseFileBam(1), TSTCG1: baseFileBam(1) }));
        state?.model.applyMetaPatch({ transparentIndex: 7 });

        expect(state?.selectArmour(2)).toBe("changed");
        expect(state?.selectArmour(1)).toBe("changed");

        expect(state?.model.animation.meta.transparentIndex).toBe(7);
    });

    it("keeps the open armour when the level asked for draws nothing", () => {
        const set = setOf({
            prefixByArmour: new Map([
                [1, "TSTB"],
                [2, "TSTC"],
            ]),
        });
        const state = AnimationSetState.open(set, fakeIo({ TSTBG1: baseFileBam(1) }));

        expect(state?.selectArmour(2)).toBe("refused");
        expect(state?.armour).toBe(1);
        expect(state?.action.resref).toBe("TSTBG1");
    });
});

describe("createAnimationSetSource", () => {
    const set = setOf();
    const game = {
        canRead: () => false,
        read: () => undefined,
        identity: { flavour: "bgee" },
    } as unknown as Game;
    const gameAt = (dir: string): Game | undefined => (dir === "/games/bgee" ? game : undefined);

    it("resolves a set the open install declares", () => {
        const source = createAnimationSetSource({ animations: () => [set], gameAt });
        // The flavour travels with the answer: a conversion records which install its source came from,
        // and this lookup is the only place that still knows.
        expect(source.lookup("/games/bgee", 0x1234)).toMatchObject({ kind: "set", set, flavour: "bgee" });
    });

    it("resolves nothing for an install other than the open one", () => {
        const source = createAnimationSetSource({ animations: () => [set], gameAt });
        expect(source.lookup("/games/tob", 0x1234).kind).toBe("no-game");
    });

    it("opens a set before anything has opened the game in the view", () => {
        // The editor's own restore beats the resource view's: a tab reopened with the window runs before the
        // view is shown, so a source that read only an ALREADY-open session refused the set it had just
        // listed. `gameAt` is what opens the configured install on demand, as every other lookup does.
        let opened = 0;
        const lazy = (dir: string): Game | undefined => {
            opened += 1;
            return gameAt(dir);
        };
        const source = createAnimationSetSource({ animations: () => [set], gameAt: lazy });

        expect(source.lookup("/games/bgee", 0x1234)).toMatchObject({ kind: "set", set });
        expect(opened).toBe(1);
    });

    it("says the game declares nothing under that id", () => {
        const source = createAnimationSetSource({ animations: () => undefined, gameAt });
        expect(source.lookup("/games/bgee", 0x1234).kind).toBe("not-declared");
    });

    it("lists the install's sets for the editor's own picker", () => {
        // The list is what the set picker offers, and an install with nothing declared offers nothing
        // rather than an undefined the caller has to unwrap.
        const declared = (dir: string): AnimationSet[] | undefined => (dir === "/games/bgee" ? [set] : undefined);
        const source = createAnimationSetSource({ animations: declared, gameAt });

        expect(source.list("/games/bgee")).toEqual([set]);
        expect(source.list("/games/tob")).toEqual([]);
    });
});

describe("setView", () => {
    it("names the set and labels both pickers' options", () => {
        const set = setOf({
            prefixByArmour: new Map([
                [1, "TSTB"],
                [2, "TSTC"],
            ]),
        });
        // Both levels ship a file: the picker offers the levels this install DRAWS, so a level with no
        // files here would leave the second option out and the test would stop covering the labelling.
        const io = fakeIo({ TSTBG1: baseFileBam(1), TSTBG2: baseFileBam(1), TSTCG1: baseFileBam(1) });
        const state = AnimationSetState.open(set, io);

        expect(setView(state!)).toEqual({
            id: 0x1234,
            title: "TEST_ANIM",
            armours: [
                { level: 1, label: "None" },
                { level: 2, label: "Leather" },
            ],
            armour: 1,
            // One band each, so each file IS one stance and takes the file's own name - this family names
            // files rather than stances, and its suffix is the only name such a band has.
            stances: [
                { key: "TSTBG1#0", label: "G1", title: "TSTBG1, band 1" },
                { key: "TSTBG2#0", label: "G2", title: "TSTBG2, band 1" },
            ],
            stance: "TSTBG1#0",
            band: 0,
        });
    });

    /**
     * The file is out of the picker but not out of the editor: a save writes the BAM the open stance lives
     * in, so the reader has to be able to find out which one that is before they edit it.
     */
    it("names the files a stance draws, for the row's tooltip", () => {
        const io = fakeIo({ TSTBG1: baseFileBam(2), TSTBG1E: baseFileBam(2) });
        const state = AnimationSetState.open(setOf(), io);

        expect(setView(state!).stances.map((stance) => stance.title)).toEqual([
            "TSTBG1 + TSTBG1E, band 1",
            "TSTBG1 + TSTBG1E, band 2",
        ]);
    });

    /**
     * A tiled set composes its picture from a file per grid cell per facing - the red dragon's opening
     * stance draws 81. Listing them is not a tooltip, it is a wall, and the reader wants to know which
     * animation they are editing rather than to read an inventory of it.
     */
    it("counts the rest rather than listing every file of a stance drawn from many", () => {
        const quarters: Record<string, Uint8Array> = {};
        for (const quadrant of [1, 2, 3, 4]) {
            quarters[`TSTBG1${quadrant}`] = baseFileBam(1);
            quarters[`TSTBG1${quadrant}E`] = baseFileBam(1);
        }
        const state = AnimationSetState.open(setOf({ layout: "quadrant" }), fakeIo(quarters));

        expect(setView(state!).stances[0]?.title).toBe("TSTBG11 and 7 more files, band 1");
    });

    it("falls back to the id for a set the install names in no table", () => {
        const state = AnimationSetState.open(setOf({ name: "", code: "" }), fakeIo({ TSTBG1: baseFileBam(1) }));
        expect(setView(state!).title).toBe("0x1234");
    });

    // Several animation types pack different stances into the same sequence token, block scheme and block
    // count, so the block-name table needs the declaration to tell them apart - and a set the install
    // declares nothing for has to say so rather than name a type it does not have.
    it("carries the declared animation type, and omits it where the install declares none", () => {
        const io = fakeIo({ TSTBG1: baseFileBam(1) });
        const declared = AnimationSetState.open(setOf({ section: "monster_ankheg" }), io);
        const undeclared = AnimationSetState.open(setOf(), io);

        expect(setView(declared!).section).toBe("monster_ankheg");
        expect(setView(undeclared!)).not.toHaveProperty("section");
    });

    // Nothing structural can tell a sixteen-cycle band from two eight-cycle ones, so the declaration is the
    // only thing that stops the stage reading such a file as twice as many stances at half the facings.
    it("carries the declared band width, and the block scheme only where one covers it", () => {
        const io = fakeIo({ TSTBG1: baseFileBam(1) });
        const wide = AnimationSetState.open(setOf({ bandStride: 16 }), io);
        const narrow = AnimationSetState.open(setOf({ bandStride: 8 }), io);

        expect(setView(wide!).bands).toEqual({ stride: 16 });
        expect(setView(narrow!).bands).toEqual({ stride: 8, scheme: "ie8" });
        expect(setView(AnimationSetState.open(setOf(), io)!)).not.toHaveProperty("bands");
    });

    /**
     * A wide band holds eight pictures unless the animation declares a smooth path, and the rose is what
     * puts a facing name on each slot - so the flag has to reach the webview with the width.
     */
    it("carries how many facings a wide band holds beside its width", () => {
        const io = fakeIo({ TSTBG1: baseFileBam(1) });
        const coarse = AnimationSetState.open(setOf({ bandStride: 16, coarseBands: true }), io);

        expect(setView(coarse!).bands).toEqual({ stride: 16, coarse: true });
    });
});
