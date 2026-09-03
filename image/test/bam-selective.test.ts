import { describe, expect, it } from "vitest";
import { type IndexedAnimation, emptyPalette } from "../src/model/animation.ts";
import { parseBamV1 } from "../src/bam/parse.ts";
import { serializeBamV1 } from "../src/bam/serialize.ts";
import { encodeBamc } from "../src/bam/bamc.ts";
import { decodeBamV1Frames, readBamV1Tables } from "../src/bam/selective.ts";

// The package's tests build their inputs through the real serializer rather than committing binaries
// (bam-parse.test.ts:16, bam-roundtrip.test.ts). Four frames of distinct content, four cycles each
// starting on a different frame - the shape a multi-cycle thumbnail samples.
function multiCycleBam(): Uint8Array {
    const frames = Array.from({ length: 4 }, (_, i) => ({
        width: 2,
        height: 2,
        pixels: Uint8Array.from([i + 1, i + 2, i + 3, 0]),
        offsetX: i,
        offsetY: -i,
    }));
    const anim: IndexedAnimation = {
        palette: emptyPalette(),
        frames,
        sequences: Array.from({ length: 4 }, (_, i) => ({ frameRefs: [i, (i + 1) % 4], facing: "none" as const })),
        meta: { sourceFormat: "bam", transparentIndex: 0 },
    };
    return serializeBamV1(anim);
}

describe("selective BAM v1 decode", () => {
    const bytes = multiCycleBam();

    it("reads the cycle table without decoding frames", () => {
        const full = parseBamV1(bytes);
        const tables = readBamV1Tables(bytes);
        expect(tables.frameCount).toBe(full.frames.length);
        expect(tables.sequences.map((s) => s.frameRefs)).toEqual(full.sequences.map((s) => s.frameRefs));
        expect(tables.palette).toEqual(full.palette);
        expect(tables.transparentIndex).toBe(0);
    });

    it("decodes exactly the requested frames, pixel-identical to the full parse", () => {
        const full = parseBamV1(bytes);
        const picked = decodeBamV1Frames(bytes, [0, 2]);
        expect([...picked.keys()].sort((a, b) => a - b)).toEqual([0, 2]);
        for (const index of [0, 2]) {
            const a = picked.get(index)!;
            const b = full.frames[index]!;
            expect(a.width).toBe(b.width);
            expect(a.height).toBe(b.height);
            expect(a.offsetX).toBe(b.offsetX);
            expect(a.offsetY).toBe(b.offsetY);
            expect([...a.pixels]).toEqual([...b.pixels]);
        }
    });

    it("ignores an out-of-range index rather than throwing", () => {
        expect(decodeBamV1Frames(bytes, [0, 9999]).size).toBe(1);
    });

    // BAMC is ~99% of a classic install's BAMs and ~84% of an EE one's, and every fixture built with
    // serializeBamV1 is uncompressed - so without this case the whole selective path ships broken for
    // almost every real file and every test here stays green.
    it("reads a BAMC file, which is what most real BAMs are", () => {
        const compressed = encodeBamc(bytes);
        expect(readBamV1Tables(compressed).frameCount).toBe(readBamV1Tables(bytes).frameCount);
        const picked = decodeBamV1Frames(compressed, [0]);
        expect([...picked.get(0)!.pixels]).toEqual([...decodeBamV1Frames(bytes, [0]).get(0)!.pixels]);
    });
});
