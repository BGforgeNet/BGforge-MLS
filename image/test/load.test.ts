import { describe, expect, it } from "vitest";
import fs from "fs";
import { loadImage } from "@bgforge/image";
import { corpusFiles, FALLOUT_ART, IE_CORPUS } from "./fixtures.ts";

const frm = corpusFiles(FALLOUT_ART, ".frm")[0];
const bam = corpusFiles(IE_CORPUS, ".bam")[0];

describe("loadImage", () => {
    it("throws on unrecognized input", () => {
        expect(() => loadImage(new Uint8Array([0, 1, 2, 3]), "mystery.dat")).toThrow(/Unrecognized image format/);
    });
    it("throws on input shorter than a signature", () => {
        expect(() => loadImage(new Uint8Array([1]), "short.dat")).toThrow(/Unrecognized image format/);
    });
    it.skipIf(!frm)("loads an FRM by extension", () => {
        const f = frm;
        if (!f) throw new Error("expected an FRM corpus fixture");
        expect(loadImage(new Uint8Array(fs.readFileSync(f)), f).meta.sourceFormat).toBe("frm");
    });
    it.skipIf(!bam)("loads a BAM/BAMC by signature", () => {
        const b = bam;
        if (!b) throw new Error("expected a BAM corpus fixture");
        const anim = loadImage(new Uint8Array(fs.readFileSync(b)), b);
        expect(["bam", "bamc"]).toContain(anim.meta.sourceFormat);
    });
});
