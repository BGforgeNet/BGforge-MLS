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
} from "@bgforge/image";
import { corpusFiles, FALLOUT_ART } from "./fixtures.ts";

function makeFrame(fill: number): Frame {
    return { width: 2, height: 2, pixels: new Uint8Array(4).fill(fill), offsetX: 0, offsetY: 0 };
}

// Build a 6-direction FRM whose directions are individually identifiable (facing d's two frames
// carry pixel values d*10+1 and d*10+2) and whose per-direction offsets are all distinct.
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

// Reproduce how a modding tool splits a combined critter into one `.frN` per facing: a full FRM
// carrying only facing d's frames, with facing d's offset replicated across all six header slots.
// Verified against real corpus splits (each .frN has doff-distinct=1 and a uniform offset).
function splitDirection(anim: IndexedAnimation, d: number): Uint8Array {
    const seq = anim.sequences[d];
    if (!seq) throw new Error(`no sequence ${d}`);
    const dirFrames = seq.frameRefs.map((r) => {
        const f = anim.frames[r];
        if (!f) throw new Error(`frame ${r} missing`);
        return f;
    });
    const x = anim.meta.dirOffsetsX?.[d] ?? 0;
    const y = anim.meta.dirOffsetsY?.[d] ?? 0;
    const single: IndexedAnimation = {
        palette: anim.palette,
        frames: dirFrames,
        sequences: FRM_FACINGS.map((facing) => ({ frameRefs: dirFrames.map((_, i) => i), facing })),
        meta: { ...anim.meta, dirOffsetsX: FRM_FACINGS.map(() => x), dirOffsetsY: FRM_FACINGS.map(() => y) },
    };
    return serializeFrm(single);
}

function directionPixels(anim: IndexedAnimation, d: number): number[] {
    const seq = anim.sequences[d];
    if (!seq) throw new Error(`no sequence ${d}`);
    return seq.frameRefs.map((r) => {
        const f = anim.frames[r];
        if (!f) throw new Error(`frame ${r} missing`);
        return f.pixels[0] ?? -1;
    });
}

describe("combineFrmDirections", () => {
    it("reassembles six single-direction files into one 6-facing FRM", () => {
        const original = sampleCombined();
        const files = FRM_FACINGS.map((_, d) => splitDirection(original, d));

        const combined = combineFrmDirections(files);

        expect(combined.meta.sourceFormat).toBe("frm");
        expect(combined.sequences.map((s) => s.facing)).toEqual(["NE", "E", "SE", "SW", "W", "NW"]);
        // Slot-0 offsets from each file reconstruct the original per-direction header offsets.
        expect(combined.meta.dirOffsetsX).toEqual([0, 1, 2, 3, 4, 5]);
        expect(combined.meta.dirOffsetsY).toEqual([5, 4, 3, 2, 1, 0]);
        // Each facing keeps its own frames, in order.
        FRM_FACINGS.forEach((_, d) => {
            expect(directionPixels(combined, d)).toEqual([d * 10 + 1, d * 10 + 2]);
        });
    });

    it("produces a combined FRM that serializes back to a valid 6-direction FRM", () => {
        const original = sampleCombined();
        const files = FRM_FACINGS.map((_, d) => splitDirection(original, d));

        const reparsed = parseFrm(serializeFrm(combineFrmDirections(files)));

        expect(reparsed.sequences).toHaveLength(6);
        expect(reparsed.meta.dirOffsetsX).toEqual([0, 1, 2, 3, 4, 5]);
        expect(reparsed.meta.dirOffsetsY).toEqual([5, 4, 3, 2, 1, 0]);
        FRM_FACINGS.forEach((_, d) => {
            expect(directionPixels(reparsed, d)).toEqual([d * 10 + 1, d * 10 + 2]);
        });
    });

    it("leaves a facing empty when its file is missing, without disturbing the others", () => {
        const original = sampleCombined();
        const files: (Uint8Array | undefined)[] = FRM_FACINGS.map((_, d) => splitDirection(original, d));
        files[3] = undefined; // SW absent (an incomplete set on disk)

        const combined = combineFrmDirections(files);

        expect(combined.sequences[3]?.frameRefs).toEqual([]);
        expect(combined.meta.dirOffsetsX?.[3]).toBe(0);
        expect(combined.meta.dirOffsetsY?.[3]).toBe(0);
        // A present neighbour is untouched.
        expect(directionPixels(combined, 4)).toEqual([41, 42]);
        expect(combined.meta.dirOffsetsX?.[4]).toBe(4);
    });
});

const CRITTERS = path.join(FALLOUT_ART, "critters");
const splitSet = (base: string): (Uint8Array | undefined)[] =>
    Array.from({ length: 6 }, (_, d) => {
        const p = path.join(CRITTERS, `${base}.fr${d}`);
        return fs.existsSync(p) ? new Uint8Array(fs.readFileSync(p)) : undefined;
    });
const haveRealSplit = fs.existsSync(path.join(CRITTERS, "haenrobd.fr0"));

describe.skipIf(!haveRealSplit)("combineFrmDirections (real corpus)", () => {
    it("combines a genuine .fr0-.fr5 critter set into a serializable 6-direction FRM", () => {
        const combined = combineFrmDirections(splitSet("haenrobd"));

        expect(combined.sequences).toHaveLength(6);
        // Every facing carries the same frame count, and every referenced frame is well-formed.
        const counts = combined.sequences.map((s) => s.frameRefs.length);
        expect(new Set(counts).size).toBe(1);
        expect(counts[0]).toBeGreaterThan(0);
        for (const seq of combined.sequences) {
            for (const ref of seq.frameRefs) {
                const f = combined.frames[ref];
                assert(f);
                expect(f.pixels).toHaveLength(f.width * f.height);
            }
        }
        // The combined animation re-serializes into a parseable 6-direction FRM.
        const reparsed = parseFrm(serializeFrm(combined));
        expect(reparsed.sequences).toHaveLength(6);
        expect(reparsed.sequences[0]?.frameRefs.length).toBe(counts[0]);
    });

    it("split-then-recombine reconstructs a real combined critter's directions and offsets", () => {
        // haenroaa.frm carries non-zero per-direction header offsets - splitting then recombining
        // must round-trip both the frames and those offsets (the resolution the split encodes).
        const file = corpusFiles(FALLOUT_ART, ".frm").find((f) => path.basename(f) === "haenroaa.frm");
        expect(file).toBeDefined();
        if (!file) return;
        const original = parseFrm(new Uint8Array(fs.readFileSync(file)));

        const files = FRM_FACINGS.map((_, d) => splitDirection(original, d));
        const combined = combineFrmDirections(files);

        expect(combined.meta.dirOffsetsX).toEqual(original.meta.dirOffsetsX);
        expect(combined.meta.dirOffsetsY).toEqual(original.meta.dirOffsetsY);
        FRM_FACINGS.forEach((_, d) => {
            const before = directionFrames(original, d);
            const after = directionFrames(combined, d);
            expect(after).toEqual(before);
        });
    });
});

// Per-direction frame content (dimensions + offset + pixels), the identity a split/recombine preserves.
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
