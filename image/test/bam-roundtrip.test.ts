import { describe, expect, it } from "vitest";
import fs from "fs";
import { parseBamV1, serializeBamV1 } from "@bgforge/image";
import { corpusFiles, IE_CORPUS } from "./fixtures.ts";

const bams = corpusFiles(IE_CORPUS, ".bam").filter(
    (f) => fs.readFileSync(f).subarray(0, 4).toString("latin1") === "BAM ",
);

describe.skipIf(bams.length === 0)("BAM v1 round-trip (data-identical)", () => {
    it("preserves frames, palette, and cycles through parse -> serialize -> parse", () => {
        let checked = 0;
        let rleFramesSeen = 0;
        for (const file of bams.slice(0, 100)) {
            const a = parseBamV1(new Uint8Array(fs.readFileSync(file)));
            const b = parseBamV1(serializeBamV1(a));
            expect(b.palette).toHaveLength(256);
            expect(b.palette).toEqual(a.palette);
            expect(b.frames.map((f) => [f.width, f.height])).toEqual(a.frames.map((f) => [f.width, f.height]));
            expect(b.frames.map((f) => f.rleEncoded)).toEqual(a.frames.map((f) => f.rleEncoded));
            for (let i = 0; i < a.frames.length; i++) {
                const af = a.frames[i];
                const bf = b.frames[i];
                if (!af || !bf) throw new Error("index out of range against a.frames.length");
                expect(Buffer.from(bf.pixels).equals(Buffer.from(af.pixels))).toBe(true);
                if (af.rleEncoded) rleFramesSeen++;
            }
            expect(b.sequences.map((s) => s.frameRefs)).toEqual(a.sequences.map((s) => s.frameRefs));
            expect(b.meta.transparentIndex).toBe(a.meta.transparentIndex);
            checked++;
        }
        expect(checked).toBeGreaterThan(0);
        // Confirm the sample genuinely exercises the RLE decode/re-encode path, not just raw frames.
        expect(rleFramesSeen).toBeGreaterThan(0);
    });
});
