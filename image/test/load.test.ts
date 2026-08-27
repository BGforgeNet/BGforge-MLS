import { describe, expect, it } from "vitest";
import fs from "fs";
import { loadImage } from "@bgforge/image";
import { corpusFiles, FALLOUT_ART, IE_CORPUS } from "./fixtures.ts";

const frm = corpusFiles(FALLOUT_ART, ".frm")[0];
const bam = corpusFiles(IE_CORPUS, ".bam")[0];
const header = (f: string): string => fs.readFileSync(f).subarray(0, 8).toString("latin1");
const bamV1 = corpusFiles(IE_CORPUS, ".bam").find((f) => header(f) === "BAM V1  ");
const bamV2 = corpusFiles(IE_CORPUS, ".bam").find((f) => header(f) === "BAM V2  ");

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

    it.skipIf(!bamV1)("routes an uncompressed v1 BAM to the v1 parser", () => {
        // Distinct from the case above: whichever file sorts first may be BAMC, which takes the
        // decompressing branch and leaves the plain-v1 dispatch unexercised.
        const b = bamV1;
        if (!b) throw new Error("expected a BAM V1 corpus fixture");

        expect(loadImage(new Uint8Array(fs.readFileSync(b)), b).meta.sourceFormat).toBe("bam");
    });

    it.skipIf(!bamV2)("names the PVRZ pages a v2 BAM needs instead of failing on its version", () => {
        // loadImage is synchronous and has no way to fetch pages, so v2 is out of its reach - but
        // the caller needs to know WHICH pages to resolve, not just that the version is unsupported.
        const b = bamV2;
        if (!b) throw new Error("expected a BAM V2 corpus fixture");

        expect(() => loadImage(new Uint8Array(fs.readFileSync(b)), b)).toThrow(/MOS\d{4}\.PVRZ/);
    });
});
