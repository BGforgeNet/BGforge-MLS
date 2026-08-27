import { describe, expect, it } from "vitest";
import fs from "fs";
import { type IndexedAnimation, FRM_FACINGS, emptyPalette, parseFrm, serializeFrm } from "@bgforge/image";
import { corpusFiles, FALLOUT_ART } from "./fixtures.ts";

const frms = corpusFiles(FALLOUT_ART, ".frm");

describe("parseFrm hostile input", () => {
    it("rejects a truncated header", () => {
        expect(() => parseFrm(new Uint8Array(10))).toThrow(/header truncated/);
    });

    it("rejects an unsupported version instead of reading garbage frames", () => {
        const bytes = new Uint8Array(0x3e);
        new DataView(bytes.buffer).setUint32(0x00, 5, false);
        expect(() => parseFrm(bytes)).toThrow(/unsupported FRM version 5/);
    });

    it("rejects a header promising frames the file does not contain", () => {
        const bytes = new Uint8Array(0x3e);
        const view = new DataView(bytes.buffer);
        view.setUint32(0x00, 4, false);
        view.setUint16(0x08, 1, false); // one frame per direction, but zero frame bytes follow
        expect(() => parseFrm(bytes)).toThrow(/frame header out of range/);
    });

    it("reports frame pixel data cut off at end-of-file as truncated", () => {
        const anim: IndexedAnimation = {
            palette: emptyPalette(),
            frames: [{ width: 2, height: 2, pixels: new Uint8Array([1, 2, 3, 4]), offsetX: 0, offsetY: 0 }],
            sequences: FRM_FACINGS.map((facing) => ({ frameRefs: [0], facing })),
            meta: { sourceFormat: "frm", frmVersion: 4, directionLayout: "frm6" },
        };
        const full = serializeFrm(anim);
        expect(() => parseFrm(full.subarray(0, -2))).toThrow(/pixel data truncated/);
    });
});

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
