import path from "path";
import { describe, expect, it } from "vitest";
import { baseCandidatePath, eastCompanionCandidates, isBamPath } from "../../src/image-editor/ie-pair";

describe("isBamPath", () => {
    it("accepts .bam in any case and rejects other extensions", () => {
        expect(isBamPath(path.join("mods", "usar1ca.bam"))).toBe(true);
        expect(isBamPath(path.join("mods", "USAR1CA.BAM"))).toBe(true);
        expect(isBamPath(path.join("mods", "critter.frm"))).toBe(false);
    });
});

describe("eastCompanionCandidates", () => {
    it("derives the stem+e/E siblings with the original extension", () => {
        expect(eastCompanionCandidates(path.join("mods", "usar1ca.bam"))).toEqual([
            path.join("mods", "usar1cae.bam"),
            path.join("mods", "usar1caE.bam"),
        ]);
    });
});

describe("baseCandidatePath", () => {
    it("strips a trailing e/E from the stem", () => {
        expect(baseCandidatePath(path.join("mods", "usar1cae.bam"))).toBe(path.join("mods", "usar1ca.bam"));
        expect(baseCandidatePath(path.join("mods", "USAR1CAE.BAM"))).toBe(path.join("mods", "USAR1CA.BAM"));
    });

    it("is undefined when the stem cannot be a companion name", () => {
        expect(baseCandidatePath(path.join("mods", "usar1ca.bam"))).toBeUndefined();
        expect(baseCandidatePath(path.join("mods", "e.bam"))).toBeUndefined(); // nothing left after the suffix
    });
});
