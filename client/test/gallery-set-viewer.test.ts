import { describe, expect, it } from "vitest";
import type { Game } from "@bgforge/binary";
import { type Frame, type IndexedAnimation, type Rgba, serializeBamV1 } from "@bgforge/image";
import { type AnimationSet } from "../src/ie-resources/animation-index";
import { resolveSet, stanceAnimation } from "../src/gallery/set-viewer";

function palette(): Rgba[] {
    return Array.from({ length: 256 }, (_, i) => ({ r: i, g: i, b: i, a: 255 }));
}

function frame(seed: number): Frame {
    return { width: 2, height: 2, pixels: new Uint8Array([seed, seed, seed, seed]), offsetX: 1, offsetY: 1 };
}

/**
 * A base-file shaped BAM: `bands` blocks of 8 cycles, the first five carrying their own frames and the
 * last three padded with one shared frame - the shape the direction interpreter recognises, so the bands
 * resolve to five stored facings each.
 */
function baseFileBam(bands: number): Uint8Array {
    const frames: Frame[] = [frame(0)];
    const sequences = [];
    for (let band = 0; band < bands; band++) {
        for (let slot = 0; slot < 8; slot++) {
            if (slot < 5) {
                const first = frames.length;
                frames.push(frame(first), frame(first + 1));
                sequences.push({ frameRefs: [first, first + 1], facing: "none" as const });
            } else {
                sequences.push({ frameRefs: [0, 0], facing: "none" as const });
            }
        }
    }
    const animation: IndexedAnimation = {
        palette: palette(),
        sequences,
        frames,
        meta: { sourceFormat: "bam" },
    };
    return serializeBamV1(animation);
}

/** A game holding exactly the resources given. Only the members the viewer reaches are implemented. */
function fakeGame(files: Record<string, Uint8Array>): Game {
    const has = (resref: string): boolean => Object.hasOwn(files, resref.toUpperCase());
    // A partial stub: the viewer touches only these three members, and a full Game is ~15 methods of
    // archive machinery none of this code path enters.
    return {
        identity: { flavour: "tob" },
        canRead: (resref: string) => has(resref),
        read: (resref: string) => {
            const bytes = files[resref.toUpperCase()];
            if (bytes === undefined) throw new Error(`no such resource: ${resref}`);
            return bytes;
        },
    } as unknown as Game;
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

describe("resolveSet", () => {
    it("lists a band per stance, keyed to the file it lives in", () => {
        const game = fakeGame({ TSTBG1: baseFileBam(2) });
        const { detail, stances } = resolveSet(game, setOf());

        expect(detail.title).toBe("TEST_ANIM");
        expect(detail.id).toBe(0x1234);
        expect(detail.stances).toHaveLength(2);
        expect(detail.stances.map((s) => s.band)).toEqual([0, 1]);
        expect(detail.stances.every((s) => s.resref === "TSTBG1")).toBe(true);
        // Five stored facings: the padded eastern slots are not offered as directions.
        expect(detail.stances[0]?.slots.map((s) => s.facing)).toEqual(["S", "SW", "W", "NW", "N"]);
        expect(stances).toHaveLength(2);
    });

    it("numbers the bands when nothing documents the file's layout", () => {
        const game = fakeGame({ TSTBG1: baseFileBam(2) });
        expect(resolveSet(game, setOf()).detail.stances.map((s) => s.label)).toEqual(["G1 - group 1", "G1 - group 2"]);
    });

    it("offers the armour levels the set declares, and opens on the lowest", () => {
        const game = fakeGame({ TSTBG1: baseFileBam(1), TSTCG1: baseFileBam(1) });
        const set = setOf({
            prefixByArmour: new Map([
                [2, "TSTC"],
                [1, "TSTB"],
            ]),
        });
        const resolved = resolveSet(game, set);
        expect(resolved.detail.armours).toEqual([1, 2]);
        expect(resolved.detail.armour).toBe(1);
        expect(resolved.detail.stances[0]?.resref).toBe("TSTBG1");
    });

    it("honours a chosen armour level and draws that level's files", () => {
        const game = fakeGame({ TSTBG1: baseFileBam(1), TSTCG1: baseFileBam(1) });
        const set = setOf({
            prefixByArmour: new Map([
                [1, "TSTB"],
                [2, "TSTC"],
            ]),
        });
        const resolved = resolveSet(game, set, 2);
        expect(resolved.detail.armour).toBe(2);
        expect(resolved.detail.stances[0]?.resref).toBe("TSTCG1");
    });

    it("falls back to the lowest level when the chosen one is not declared", () => {
        // A pick carried over from a previously-viewed set must not empty the page.
        const game = fakeGame({ TSTBG1: baseFileBam(1) });
        expect(resolveSet(game, setOf(), 4).detail.armour).toBe(1);
    });

    it("says why the list is empty rather than showing a blank page", () => {
        const resolved = resolveSet(fakeGame({}), setOf());
        expect(resolved.detail.stances).toHaveLength(0);
        expect(resolved.detail.note).toBe("the monster scheme is not implemented yet");
    });

    it("names the install rather than the scheme when the scheme IS covered", () => {
        const resolved = resolveSet(fakeGame({}), setOf({ scheme: { kind: "character" } }));
        expect(resolved.detail.note).toBe("This install ships no files for this animation.");
    });

    it("falls back to the id when the install names the animation nothing", () => {
        const game = fakeGame({ TSTBG1: baseFileBam(1) });
        expect(resolveSet(game, setOf({ name: "", code: "" })).detail.title).toBe("0x1234");
    });
});

describe("stanceAnimation over a quadrant set", () => {
    /** One quarter of a 2x2 creature: `anchorX`/`anchorY` place it around the shared origin. */
    function quarterBam(anchorX: number, anchorY: number, fill: number): Uint8Array {
        const frames: Frame[] = [
            { width: 2, height: 2, pixels: new Uint8Array(4).fill(fill), offsetX: anchorX, offsetY: anchorY },
        ];
        return serializeBamV1({
            palette: palette(),
            frames,
            sequences: [{ frameRefs: [0], facing: "none" }],
            meta: { sourceFormat: "bam", transparentIndex: 0 },
        });
    }

    const quadrantGame = (): Game =>
        fakeGame({
            // Quarters meeting at the origin: top-left, top-right, bottom-left, bottom-right.
            MWYVG11: quarterBam(2, 2, 11),
            MWYVG12: quarterBam(0, 2, 22),
            MWYVG13: quarterBam(2, 0, 33),
            MWYVG14: quarterBam(0, 0, 44),
        });

    const quadrantSet = setOf({
        layout: "quadrant",
        prefixByArmour: new Map([[1, "MWYV"]]),
        bandStride: 16,
    });

    it("offers one stance per cycle, not one per quarter", () => {
        const { detail } = resolveSet(quadrantGame(), quadrantSet);
        expect(detail.stances).toHaveLength(1);
        expect(detail.stances[0]?.parts).toEqual(["MWYVG11", "MWYVG12", "MWYVG13", "MWYVG14"]);
    });

    it("draws the assembled creature rather than one corner", () => {
        const game = quadrantGame();
        const { stances } = resolveSet(game, quadrantSet);
        const view = stanceAnimation(game, stances[0]!);
        // Each quarter is 2x2, so the whole is 4x4 - a corner would still be 2x2.
        expect(view?.frames[0]?.width).toBe(4);
        expect(view?.frames[0]?.height).toBe(4);
    });

    it("falls back to a single quarter when the others are missing", () => {
        const game = fakeGame({ MWYVG11: quarterBam(2, 2, 11) });
        const { stances } = resolveSet(game, quadrantSet);
        expect(stances[0]?.parts).toEqual(["MWYVG11"]);
        expect(stanceAnimation(game, stances[0]!)?.frames[0]?.width).toBe(2);
    });
});

describe("stanceAnimation", () => {
    it("packs pixels for the band's own frames and no others", () => {
        const game = fakeGame({ TSTBG1: baseFileBam(2) });
        const { stances } = resolveSet(game, setOf());
        const first = stances[0];
        expect(first).toBeDefined();

        const view = stanceAnimation(game, first!);
        expect(view).toBeDefined();
        // Every frame's geometry crosses so a tile can lay out before its pixels arrive...
        expect(view!.frames.length).toBeGreaterThan(10);
        // ...but only the band's own frames carry any.
        const withPixels = view!.frames.filter((f) => f.span !== undefined).length;
        const bandFrames = new Set(first!.slots.flatMap((slot) => view!.sequences[slot.seqIndex]?.frameRefs ?? []));
        expect(withPixels).toBe(bandFrames.size);
    });

    it("packs a different frame set for a different band", () => {
        const game = fakeGame({ TSTBG1: baseFileBam(2) });
        const { stances } = resolveSet(game, setOf());
        const packed = (index: number): number[] => {
            const view = stanceAnimation(game, stances[index]!)!;
            return view.frames.flatMap((f, i) => (f.span !== undefined ? [i] : []));
        };
        expect(packed(0)).not.toEqual(packed(1));
    });

    it("answers undefined for a stance whose file the archive lost", () => {
        const game = fakeGame({ TSTBG1: baseFileBam(1) });
        const { stances } = resolveSet(game, setOf());
        expect(stanceAnimation(fakeGame({}), stances[0]!)).toBeUndefined();
    });
});
