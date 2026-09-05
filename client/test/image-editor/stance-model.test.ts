/**
 * What a stance does with a member it cannot read.
 *
 * Both surfaces that draw a set - the gallery's rose and the editor's set document - go through here, so a
 * member that throws or will not parse has to degrade the same way for both: a missing row, not a dead page.
 */
import { describe, expect, it } from "vitest";
import type { Game } from "@bgforge/binary";
import { type SetStance } from "@bgforge/animation";
import { type Frame, type IndexedAnimation, type Rgba, serializeBamV1 } from "@bgforge/image";
import { stanceIo, stanceModel } from "../../src/image-editor/stance-model";

function bam(): Uint8Array {
    const palette: Rgba[] = Array.from({ length: 256 }, (_, i) => ({ r: i, g: i, b: i, a: 255 }));
    const frame: Frame = { width: 2, height: 2, pixels: new Uint8Array(4), offsetX: 0, offsetY: 0 };
    const animation: IndexedAnimation = {
        palette,
        frames: [frame],
        sequences: [{ frameRefs: [0], facing: "none" }],
        meta: { sourceFormat: "bam" },
    };
    return serializeBamV1(animation);
}

/** A partial `Game`: the io reads only these two members, and a real one is fifteen of archive machinery. */
function fakeGame(over: Partial<Pick<Game, "canRead" | "read">>): Game {
    return { canRead: () => true, read: () => bam(), ...over } as unknown as Game;
}

function stanceOf(parts: string[]): SetStance {
    return { label: "G1", resref: parts[0]!, parts, band: 0, slots: [], confidence: "inferred" };
}

describe("stanceIo", () => {
    it("reads nothing for a member the archive does not hold", () => {
        expect(stanceIo(fakeGame({ canRead: () => false })).read("TSTBG1")).toBeUndefined();
    });

    it("reads nothing for a member the archive holds but cannot serve", () => {
        const game = fakeGame({
            read: () => {
                throw new Error("corrupt archive entry");
            },
        });
        expect(stanceIo(game).read("TSTBG1")).toBeUndefined();
    });
});

describe("stanceModel", () => {
    it("draws a single-file stance", () => {
        expect(stanceModel(stanceIo(fakeGame({})), stanceOf(["TSTBG1"]))?.animation.frames).toHaveLength(1);
    });

    it("has no model when the only member will not parse", () => {
        const game = fakeGame({ read: () => new Uint8Array([1, 2, 3, 4]) });
        expect(stanceModel(stanceIo(game), stanceOf(["TSTBG1"]))).toBeUndefined();
    });

    it("draws the parts that do parse when a quadrant is unreadable", () => {
        // The composer refuses a mismatched set, so this falls back to the first quarter - a corner rather
        // than the whole creature, which is the deliberate choice recorded at the fallback.
        const game = fakeGame({
            read: (resref: string) => (resref === "TSTBG11" ? bam() : new Uint8Array([1, 2, 3, 4])),
        });
        expect(stanceModel(stanceIo(game), stanceOf(["TSTBG11", "TSTBG12"]))?.animation.frames).toHaveLength(1);
    });
});
