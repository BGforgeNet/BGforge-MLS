/**
 * Which layout a fresh open shows.
 *
 * The interesting case is the one this replaced: a character animation whose blocks are mostly the
 * family skeleton's placeholders. Its interpretation is not `detected` - the fingerprint that stamps what
 * the file is DECLARED to be stays conservative on purpose, because the save path reads that stamp - and
 * the default used to inherit that caution, so the file a reader most wants a rose for opened flat.
 */
import { describe, expect, it } from "vitest";
import type { AnimationView } from "../../src/image-editor/webview/messages";
import {
    defaultLayoutMode,
    directionBlocks,
    type DirectionBlocks,
} from "../../src/image-editor/webview/render/compass-layout";

/** `count` blocks of nine DRAWN facings each - a block's slots are the ones that actually draw. */
const blocks = (count: number, extra?: Partial<DirectionBlocks>): DirectionBlocks => ({
    groups: Array.from({ length: count }, (_block, block) =>
        Array.from({ length: 9 }, (_slot, index) => ({ seqIndex: block * 9 + index, facing: "S" as const })),
    ),
    scheme: "ie9",
    ...extra,
});

describe("defaultLayoutMode", () => {
    it("opens a tagged compass animation as a rose", () => {
        expect(defaultLayoutMode({ mode: "compass", tiles: [] }, undefined)).toBe("rose");
    });

    /** The regression this exists for: eleven blocks, undetected, and it must still open as a rose. */
    it("opens an undetected multi-block character animation as a rose", () => {
        expect(defaultLayoutMode({ mode: "grid", tiles: [] }, blocks(11))).toBe("rose");
    });

    it("opens a detected multi-block animation as a rose", () => {
        expect(defaultLayoutMode({ mode: "grid", tiles: [] }, blocks(11, { detected: true }))).toBe("rose");
    });

    /**
     * One block is a cycle list that merely happens to divide by a stride, so a flat grid is what it is
     * and reading it as one direction rose would be an invention - unless something SAYS the cycles are
     * facings, which is the pair below.
     */
    it("keeps a single unattested block flat", () => {
        expect(defaultLayoutMode({ mode: "grid", tiles: [] }, blocks(1))).toBe("grid");
    });

    /** The ToB dragons: one nine-facing wheel, detected, and it opened as a flat row of nine cycles. */
    it("opens a single DETECTED block as a rose", () => {
        expect(defaultLayoutMode({ mode: "grid", tiles: [] }, blocks(1, { detected: true }))).toBe("rose");
    });

    it("opens a single DECLARED block as a rose", () => {
        expect(defaultLayoutMode({ mode: "grid", tiles: [] }, blocks(1, { declared: true }))).toBe("rose");
    });

    it("keeps an animation with no direction reading at all flat", () => {
        expect(defaultLayoutMode({ mode: "grid", tiles: [] }, undefined)).toBe("grid");
    });

    it("has nothing to go on before a view arrives", () => {
        expect(defaultLayoutMode(null, undefined)).toBe("grid");
    });
});

/**
 * A nine-cycle view. `drawn` says which cycles hold real art; the rest carry the same NUMBER of frames
 * at 1x1, which is how a packed family's files ship - every file holds the whole cycle table and draws
 * only the one its name numbers, the other eight being single-pixel placeholders.
 *
 * Built as a view so the test runs the reading the panel runs, rather than hand-stating its answer.
 */
function nineFacingView(framesPerCycle: number, drawn?: readonly number[]): AnimationView {
    const draws = (cycle: number): boolean => drawn === undefined || drawn.includes(cycle);
    const frames = Array.from({ length: 9 * framesPerCycle }, (_f, index) => {
        const size = draws(Math.floor(index / framesPerCycle)) ? 8 : 1;
        return { width: size, height: size, offsetX: 0, offsetY: 0 };
    });
    return {
        colorModel: "indexed",
        palette: Array.from({ length: 256 }, () => ({ r: 0, g: 0, b: 0, a: 255 })),
        hasSidecarPal: false,
        externalPaletteActive: false,
        frames,
        pixels: new ArrayBuffer(0),
        sequences: Array.from({ length: 9 }, (_unused, cycle) => ({
            frameRefs: Array.from({ length: framesPerCycle }, (_inner, f) => cycle * framesPerCycle + f),
            facing: "none",
            dirOffsetX: 0,
            dirOffsetY: 0,
        })),
        meta: {},
        basename: "MDR11100.BAM",
        sourceFormat: "bam",
    } as AnimationView;
}

describe("directionBlocks", () => {
    it("carries the interpreter's detection through to the layout decision", () => {
        const read = directionBlocks(nineFacingView(4), undefined);
        expect(read?.detected).toBe(true);
        expect(defaultLayoutMode({ mode: "grid", tiles: [] }, read)).toBe("rose");
    });

    /**
     * One tile file of a packed family (MDR11100 and its 80 siblings): nine cycles, of which the one its
     * name numbers draws and eight are 1x1 placeholders. It is one facing of one tile, not a wheel, and
     * reading it as a rose puts eight empty compass points on the stage.
     *
     * The reference browser never hits this because it does not read the file structurally at all - the
     * animation's declared type tells it which cycle of which file is which facing, so a placeholder
     * cycle is simply never addressed. Reading structurally, the equivalent is that a cycle holding no
     * art is not a drawn facing.
     */
    it("does not read a cycle table of placeholders as a wheel", () => {
        const read = directionBlocks(nineFacingView(12, [0]), undefined);
        expect(read?.groups[0]).toHaveLength(1);
        expect(defaultLayoutMode({ mode: "grid", tiles: [] }, read)).toBe("grid");
    });

    it("keeps the drawn facings of a partly-packed file", () => {
        // Whichever cycle a file's name numbers is the one that draws - here the last.
        const read = directionBlocks(nineFacingView(12, [8]), undefined);
        expect(read?.groups[0]).toHaveLength(1);
    });
});
