import { describe, expect, it } from "vitest";
import fs from "fs";
import { loadImage } from "@bgforge/image";
import { corpusFiles, FALLOUT_ART, IE_CORPUS } from "./fixtures.ts";

const frm = corpusFiles(FALLOUT_ART, ".frm")[0];
const bam = corpusFiles(IE_CORPUS, ".bam")[0];

describe("loadImage", () => {
    it("throws on unrecognized input", () => {
        expect(() => loadImage(new Uint8Array([0, 1, 2, 3]), "mystery.dat")).toThrow();
    });
    it.skipIf(!frm)("loads an FRM by extension", () => {
        expect(loadImage(new Uint8Array(fs.readFileSync(frm!)), frm!).meta.sourceFormat).toBe("frm");
    });
    it.skipIf(!bam)("loads a BAM/BAMC by signature", () => {
        const anim = loadImage(new Uint8Array(fs.readFileSync(bam!)), bam!);
        expect(["bam", "bamc"]).toContain(anim.meta.sourceFormat);
    });
});
