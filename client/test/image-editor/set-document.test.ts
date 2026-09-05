import { describe, expect, it } from "vitest";
import { type AnimationSet, type StanceIo } from "@bgforge/animation";
import { type Frame, type IndexedAnimation, type Rgba, serializeBamV1 } from "@bgforge/image";
import { AnimationSetState, createAnimationSetSource } from "../../src/image-editor/set-document";
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

    it("has no document for a set the install ships nothing of", () => {
        expect(AnimationSetState.open(setOf(), fakeIo({}))).toBeUndefined();
    });

    it("swaps the model when another action is selected", () => {
        const io = fakeIo({ TSTBG1: baseFileBam(1, 0), TSTBG2: baseFileBam(1, 100) });
        const state = AnimationSetState.open(setOf(), io);
        const before = drawnPixel(state!);

        expect(state?.select("TSTBG2")).toBe(true);
        expect(state?.action.resref).toBe("TSTBG2");
        expect(drawnPixel(state!)).not.toBe(before);
        expect(drawnPixel(state!)).toBe(101);
    });

    it("keeps the open action when asked for one the set does not name", () => {
        const state = AnimationSetState.open(setOf(), fakeIo({ TSTBG1: baseFileBam(1) }));

        expect(state?.select("TSTBCA")).toBe(false);
        expect(state?.action.resref).toBe("TSTBG1");
    });

    it("keeps the open action when the one asked for will not parse", () => {
        const io = fakeIo({ TSTBG1: baseFileBam(1), TSTBG2: new Uint8Array([1, 2, 3, 4]) });
        const state = AnimationSetState.open(setOf(), io);

        expect(state?.select("TSTBG2")).toBe(false);
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
        expect(state?.selectArmour(2)).toBe(true);
        expect(state?.armour).toBe(2);
        expect(state?.actions.map((action) => action.resref)).toEqual(["TSTCG2"]);
    });

    it("keeps the open armour when the level asked for draws nothing", () => {
        const set = setOf({
            prefixByArmour: new Map([
                [1, "TSTB"],
                [2, "TSTC"],
            ]),
        });
        const state = AnimationSetState.open(set, fakeIo({ TSTBG1: baseFileBam(1) }));

        expect(state?.selectArmour(2)).toBe(false);
        expect(state?.armour).toBe(1);
        expect(state?.action.resref).toBe("TSTBG1");
    });
});

describe("createAnimationSetSource", () => {
    const set = setOf();
    const game = { canRead: () => false, read: () => undefined } as unknown as Game;
    const session = { dir: "/games/bgee", game };

    it("resolves a set the open install declares", () => {
        const source = createAnimationSetSource({ animations: () => [set], gameSession: () => session });
        expect(source("/games/bgee", 0x1234)?.set).toBe(set);
    });

    it("resolves nothing for an install other than the open one", () => {
        const source = createAnimationSetSource({ animations: () => [set], gameSession: () => session });
        expect(source("/games/tob", 0x1234)).toBeUndefined();
    });

    it("resolves nothing with no game open", () => {
        const source = createAnimationSetSource({ animations: () => [set], gameSession: () => undefined });
        expect(source("/games/bgee", 0x1234)).toBeUndefined();
    });

    it("resolves nothing for an id the install does not declare", () => {
        const source = createAnimationSetSource({ animations: () => undefined, gameSession: () => session });
        expect(source("/games/bgee", 0x1234)).toBeUndefined();
    });
});
