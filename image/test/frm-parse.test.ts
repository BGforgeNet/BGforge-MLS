import { describe, expect, it } from "vitest";
import fs from "fs";
import { parseFrm } from "@bgforge/image";
import { corpusFiles, FALLOUT_ART } from "./fixtures.ts";

const frms = corpusFiles(FALLOUT_ART, ".frm");

describe.skipIf(frms.length === 0)("parseFrm", () => {
    it("parses the header and 6 directions of a real FRM", () => {
        const first = frms[0];
        if (!first) throw new Error("expected at least one corpus fixture");
        const anim = parseFrm(new Uint8Array(fs.readFileSync(first)));
        expect(anim.meta.sourceFormat).toBe("frm");
        expect(anim.sequences).toHaveLength(6);
        expect(anim.sequences.map((s) => s.facing)).toEqual(["NE", "E", "SE", "SW", "W", "NW"]);
        // Every referenced frame exists and its pixel buffer matches its declared dimensions.
        for (const seq of anim.sequences) {
            for (const ref of seq.frameRefs) {
                const f = anim.frames[ref];
                if (!f) throw new Error(`frame ref ${ref} out of bounds`);
                expect(f.pixels).toHaveLength(f.width * f.height);
            }
        }
    });

    it("parses a representative sample of the corpus without throwing", () => {
        for (const file of frms.slice(0, 200)) {
            const anim = parseFrm(new Uint8Array(fs.readFileSync(file)));
            expect(anim.frames.length).toBeGreaterThan(0);
        }
    });
});
