import { describe, expect, it } from "vitest";
import { type AnimationSet, type StanceIo } from "@bgforge/animation";
import { type Frame, type IndexedAnimation, type Rgba, serializeBamV1 } from "@bgforge/image";
import { AnimationSetState, createAnimationSetSource, setView } from "../../src/image-editor/set-document";
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
     * A creature file packs several direction bands, and the editor already has a control for choosing
     * between them. Listing one action per band offers that choice twice - and, since every band of a file
     * carries the same resref, gives the picker duplicate keys for rows it cannot tell apart.
     */
    it("offers one action per file, however many direction bands the file packs", () => {
        const state = AnimationSetState.open(setOf(), fakeIo({ TSTBG1: baseFileBam(3) }));
        expect(state?.actions.map((action) => action.resref)).toEqual(["TSTBG1"]);
    });

    it("has no document for a set the install ships nothing of", () => {
        expect(AnimationSetState.open(setOf(), fakeIo({}))).toBeUndefined();
    });

    it("swaps the model when another action is selected", () => {
        const io = fakeIo({ TSTBG1: baseFileBam(1, 0), TSTBG2: baseFileBam(1, 100) });
        const state = AnimationSetState.open(setOf(), io);
        const before = drawnPixel(state!);

        expect(state?.select("TSTBG2")).toBe("changed");
        expect(state?.action.resref).toBe("TSTBG2");
        expect(drawnPixel(state!)).not.toBe(before);
        expect(drawnPixel(state!)).toBe(101);
    });

    it("keeps the open action when asked for one the set does not name", () => {
        const state = AnimationSetState.open(setOf(), fakeIo({ TSTBG1: baseFileBam(1) }));

        expect(state?.select("TSTBCA")).toBe("refused");
        expect(state?.action.resref).toBe("TSTBG1");
    });

    /** Showing what is already shown is not a failure, and reporting it as one puts an error in the way. */
    it("reports re-picking the open action and the open armour as no change, not as a refusal", () => {
        const state = AnimationSetState.open(setOf(), fakeIo({ TSTBG1: baseFileBam(1) }));

        expect(state?.select("TSTBG1")).toBe("unchanged");
        expect(state?.selectArmour(1)).toBe("unchanged");
    });

    it("keeps the open action when the one asked for will not parse", () => {
        const io = fakeIo({ TSTBG1: baseFileBam(1), TSTBG2: new Uint8Array([1, 2, 3, 4]) });
        const state = AnimationSetState.open(setOf(), io);

        expect(state?.select("TSTBG2")).toBe("refused");
        expect(state?.action.resref).toBe("TSTBG1");
    });

    it("builds each action's model once, however often it is reselected", () => {
        const io = fakeIo({ TSTBG1: baseFileBam(1), TSTBG2: baseFileBam(1) });
        const state = AnimationSetState.open(setOf(), io);
        state?.select("TSTBG2");
        // Counted from here rather than from zero: resolving the action list reads every member's cycle
        // table, so an absolute count would measure that pass rather than the model cache.
        const settled = io.reads.length;

        state?.select("TSTBG1");
        state?.select("TSTBG2");

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
        expect(state?.actions.map((action) => action.resref)).toEqual(["TSTCG2"]);
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
        const state = AnimationSetState.open(set, fakeIo({ TSTBG1: baseFileBam(1), TSTBG2: baseFileBam(1) }));

        expect(setView(state!)).toEqual({
            id: 0x1234,
            title: "TEST_ANIM",
            armours: [
                { level: 1, label: "None" },
                { level: 2, label: "Leather" },
            ],
            armour: 1,
            actions: [
                { label: "G1", resref: "TSTBG1" },
                { label: "G2", resref: "TSTBG2" },
            ],
            action: "TSTBG1",
        });
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
});
