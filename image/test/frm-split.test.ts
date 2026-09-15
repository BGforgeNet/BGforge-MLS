import { assert, describe, expect, it } from "vitest";
import fs from "fs";
import path from "path";
import {
    type IndexedAnimation,
    type Frame,
    combineFrmDirections,
    emptyPalette,
    FRM_FACINGS,
    parseFrm,
    serializeFrm,
    splitFrmDirections,
} from "@bgforge/image";
import { FALLOUT_ART } from "./fixtures.ts";

function makeFrame(fill: number): Frame {
    return { width: 2, height: 2, pixels: new Uint8Array(4).fill(fill), offsetX: 0, offsetY: 0 };
}

// A 6-direction FRM whose directions are individually identifiable (facing d's two frames carry
// pixel values d*10+1 and d*10+2) and whose per-direction offsets are all distinct.
function sampleCombined(): IndexedAnimation {
    const frames: Frame[] = [];
    const sequences = FRM_FACINGS.map((facing, d) => {
        const base = frames.length;
        frames.push(makeFrame(d * 10 + 1), makeFrame(d * 10 + 2));
        return { frameRefs: [base, base + 1], facing };
    });
    return {
        palette: emptyPalette(),
        frames,
        sequences,
        meta: {
            sourceFormat: "frm",
            fps: 10,
            actionFrame: 3,
            frmVersion: 4,
            directionLayout: "frm6",
            dirOffsetsX: [0, 1, 2, 3, 4, 5],
            dirOffsetsY: [5, 4, 3, 2, 1, 0],
        },
    };
}

// Frame content by facing (dimensions + offset + pixels), the identity a split must preserve.
function directionFrames(
    anim: IndexedAnimation,
    d: number,
): { w: number; h: number; ox: number; oy: number; px: string }[] {
    const seq = anim.sequences[d];
    if (!seq) throw new Error(`no sequence ${d}`);
    return seq.frameRefs.map((r) => {
        const f = anim.frames[r];
        if (!f) throw new Error(`frame ${r} missing`);
        return { w: f.width, h: f.height, ox: f.offsetX, oy: f.offsetY, px: Buffer.from(f.pixels).toString("base64") };
    });
}

/** The six data-region offsets a serialized FRM declares, read straight out of its header. */
function dataOffsets(bytes: Uint8Array): number[] {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    return FRM_FACINGS.map((_, d) => view.getUint32(0x22 + d * 4, false));
}

describe("splitFrmDirections", () => {
    it("gives each facing a file carrying only that facing's frames", () => {
        const files = splitFrmDirections(sampleCombined());

        expect(files).toHaveLength(6);
        files.forEach((file, d) => {
            expect(file.frames.map((f) => f.pixels[0])).toEqual([d * 10 + 1, d * 10 + 2]);
        });
    });

    it("replicates the facing's own offset across all six header slots", () => {
        const files = splitFrmDirections(sampleCombined());

        // Facing d's offsets in the combined header are dirOffsetsX[d] / dirOffsetsY[d]; the split file
        // repeats that one pair six times, which is what lets the combiner read it back from slot 0.
        files.forEach((file, d) => {
            expect(file.meta.dirOffsetsX).toEqual(FRM_FACINGS.map(() => d));
            expect(file.meta.dirOffsetsY).toEqual(FRM_FACINGS.map(() => 5 - d));
        });
    });

    it("aliases all six sequences onto one frame pool, so the file declares a single data region", () => {
        const files = splitFrmDirections(sampleCombined());

        for (const file of files) {
            const [first] = file.sequences;
            assert(first);
            expect(file.sequences).toHaveLength(6);
            for (const seq of file.sequences) expect(seq.frameRefs).toEqual(first.frameRefs);
            // The shape the header must end up with: every facing pointing at region 0.
            expect(dataOffsets(serializeFrm(file))).toEqual([0, 0, 0, 0, 0, 0]);
        }
    });

    it("carries the animation's timing and version onto every file", () => {
        const files = splitFrmDirections(sampleCombined());

        for (const file of files) {
            expect(file.meta.sourceFormat).toBe("frm");
            expect(file.meta.fps).toBe(10);
            expect(file.meta.actionFrame).toBe(3);
            expect(file.meta.frmVersion).toBe(4);
        }
    });

    it("round-trips through the combiner, restoring every facing and its offsets", () => {
        const original = sampleCombined();

        const recombined = combineFrmDirections(splitFrmDirections(original).map((file) => serializeFrm(file)));

        expect(recombined.meta.dirOffsetsX).toEqual([0, 1, 2, 3, 4, 5]);
        expect(recombined.meta.dirOffsetsY).toEqual([5, 4, 3, 2, 1, 0]);
        FRM_FACINGS.forEach((_, d) => {
            expect(directionFrames(recombined, d)).toEqual(directionFrames(original, d));
        });
    });

    it("yields a frameless file for a facing the animation draws nothing for", () => {
        const original = sampleCombined();
        // An incomplete set on disk combines to an empty sequence for the absent facing; splitting it
        // back must not invent frames for it. The caller decides whether such a file is written at all.
        original.sequences[3] = { frameRefs: [], facing: "SW" };

        const files = splitFrmDirections(original);

        expect(files[3]?.frames).toEqual([]);
        expect(files[4]?.frames).toHaveLength(2);
    });
});

const CRITTERS = path.join(FALLOUT_ART, "critters");
const haveRealSplit = fs.existsSync(path.join(CRITTERS, "haenrobd.fr0"));
const readSplitSet = (base: string): Uint8Array[] =>
    Array.from({ length: 6 }, (_, d) => new Uint8Array(fs.readFileSync(path.join(CRITTERS, `${base}.fr${d}`))));

describe.skipIf(!haveRealSplit)("splitFrmDirections (real corpus)", () => {
    it("re-splits a genuine .fr0-.fr5 critter into files carrying each original's own content", () => {
        const originals = readSplitSet("haenrobd");

        const rewritten = splitFrmDirections(combineFrmDirections(originals)).map((file) => serializeFrm(file));

        // Not byte equality: a real split file inherits the PARENT's frame-area size unchanged, so its
        // header declares roughly six directions' worth of data for the one it holds. Ours recomputes it.
        // Everything a reader takes from the file is compared instead.
        originals.forEach((originalBytes, d) => {
            const before = parseFrm(originalBytes);
            const after = parseFrm(rewritten[d] ?? new Uint8Array());
            expect(after.meta.fps).toBe(before.meta.fps);
            expect(after.meta.actionFrame).toBe(before.meta.actionFrame);
            expect(after.meta.frmVersion).toBe(before.meta.frmVersion);
            expect(after.meta.dirOffsetsX).toEqual(before.meta.dirOffsetsX);
            expect(after.meta.dirOffsetsY).toEqual(before.meta.dirOffsetsY);
            expect(directionFrames(after, 0)).toEqual(directionFrames(before, 0));
        });
    });

    it("keeps every real split file addressing one data region, as the originals do", () => {
        const originals = readSplitSet("haenrobd");

        const rewritten = splitFrmDirections(combineFrmDirections(originals)).map((file) => serializeFrm(file));

        for (const bytes of originals) expect(new Set(dataOffsets(bytes)).size).toBe(1);
        for (const bytes of rewritten) expect(dataOffsets(bytes)).toEqual([0, 0, 0, 0, 0, 0]);
    });
});
