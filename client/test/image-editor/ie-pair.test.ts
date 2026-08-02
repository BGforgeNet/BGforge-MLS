/**
 * These take URI paths, not filesystem paths - posix-separated on every host - because the caller
 * rebuilds each sibling with `uri.with({ path })` so a pair resolves inside whatever served the
 * opened member (see ie-pair.ts).
 */
import { describe, expect, it } from "vitest";
import { baseCandidatePath, eastCompanionCandidates, isBamPath } from "../../src/image-editor/ie-pair";

describe("isBamPath", () => {
    it("accepts .bam in any case and rejects other extensions", () => {
        expect(isBamPath("/mods/usar1ca.bam")).toBe(true);
        expect(isBamPath("/mods/USAR1CA.BAM")).toBe(true);
        expect(isBamPath("/mods/critter.frm")).toBe(false);
    });
});

describe("eastCompanionCandidates", () => {
    it("derives the stem+e/E siblings with the original extension", () => {
        expect(eastCompanionCandidates("/mods/usar1ca.bam")).toEqual(["/mods/usar1cae.bam", "/mods/usar1caE.bam"]);
    });

    // A game resource's URI path is a bare `<resref>.<ext>` with no folder above it; the siblings
    // must stay at that same level rather than picking up one.
    it("keeps a folderless resource path folderless", () => {
        expect(eastCompanionCandidates("/usar1ca.bam")).toEqual(["/usar1cae.bam", "/usar1caE.bam"]);
    });
});

describe("baseCandidatePath", () => {
    it("strips a trailing e/E from the stem", () => {
        expect(baseCandidatePath("/mods/usar1cae.bam")).toBe("/mods/usar1ca.bam");
        expect(baseCandidatePath("/mods/USAR1CAE.BAM")).toBe("/mods/USAR1CA.BAM");
    });

    it("is undefined when the stem cannot be a companion name", () => {
        expect(baseCandidatePath("/mods/usar1ca.bam")).toBeUndefined();
        expect(baseCandidatePath("/mods/e.bam")).toBeUndefined(); // nothing left after the suffix
    });
});
