import { describe, expect, it } from "vitest";
import fs from "fs";
import { parseBamV1 } from "@bgforge/image";
import { corpusFiles, IE_CORPUS } from "./fixtures.ts";

// Uncompressed 'BAM ' files only here; BAMC is Task 8.
const bams = corpusFiles(IE_CORPUS, ".bam").filter((f) => {
    const sig = fs.readFileSync(f).subarray(0, 4).toString("latin1");
    return sig === "BAM ";
});

describe.skipIf(bams.length === 0)("parseBamV1", () => {
    it("parses frames, palette, and cycles of a real BAM", () => {
        const first = bams[0];
        if (!first) throw new Error("expected at least one corpus fixture");
        const anim = parseBamV1(new Uint8Array(fs.readFileSync(first)));
        expect(anim.meta.sourceFormat).toBe("bam");
        expect(anim.palette).toHaveLength(256);
        expect(anim.sequences.length).toBeGreaterThan(0);
        for (const f of anim.frames) expect(f.pixels).toHaveLength(f.width * f.height);
        for (const seq of anim.sequences) {
            for (const ref of seq.frameRefs) expect(anim.frames[ref]).toBeDefined();
        }
    });
});
