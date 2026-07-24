import { describe, expect, it } from "vitest";
import { describeAnimationName } from "../../src/image-editor/webview/render/naming";

// Minimal sequence shapes for the FRM directionality gate: shared = one orientation copied across
// slots (scenery-style), distinct = real per-direction art (critter-style).
const shared = [{ frameRefs: [0] }, { frameRefs: [0] }];
const distinct = [{ frameRefs: [0] }, { frameRefs: [1] }];

function frm(basename: string, dirName: string | undefined, sequences = shared) {
    return describeAnimationName({ basename, dirName, sourceFormat: "frm", sequences });
}

function bam(basename: string) {
    return describeAnimationName({ basename, sourceFormat: "bam", sequences: [] });
}

describe("describeAnimationName - FRM", () => {
    it("decodes unarmed basic animations under a critters directory", () => {
        expect(frm("hmjmpsaa.frm", "critters")).toBe("aa: stand, unarmed");
        expect(frm("hmjmpsat.frm", "critters")).toBe("at: run, unarmed");
    });

    it("decodes weapon + action pairs", () => {
        expect(frm("hanpwrjj.frm", "critters")).toBe("jj: fire single, rifle");
        expect(frm("hmjmpsdm.frm", "critters")).toBe("dm: throw, knife");
        expect(frm("hmjmpsge.frm", "critters")).toBe("ge: parry (dodge), spear");
    });

    it("decodes the sfall extended weapon letters (codes 11-15)", () => {
        expect(frm("hmjmpssj.frm", "critters")).toBe("sj: fire single, custom weapon 11 (sfall)");
        expect(frm("hmjmpstb.frm", "critters")).toBe("tb: walk, custom weapon 15 (sfall)");
    });

    it("decodes knockdown/death and single-frame death poses", () => {
        expect(frm("hmjmpsba.frm", "critters")).toBe("ba: fall back (death)");
        expect(frm("hmjmpsrb.frm", "critters")).toBe("rb: fall front (death pose)");
    });

    it("decodes position changes and the targeting picture", () => {
        expect(frm("hmjmpsch.frm", "critters")).toBe("ch: prone to standing");
        expect(frm("hmwarrna.frm", "critters")).toBe("na: targeting picture (called shot)");
    });

    it("decodes the suffix without a critters directory when the art is directional", () => {
        expect(frm("hanpwrjj.frm", undefined, distinct)).toBe("jj: fire single, rifle");
    });

    it("leaves single-orientation art outside critters undecoded (no false minigun on a windmill)", () => {
        expect(frm("windmill.frm", undefined)).toBeUndefined();
        expect(frm("windmill.frm", "scenery")).toBe("scenery art");
    });

    it("falls back to the art category when the suffix does not decode", () => {
        expect(frm("elderbf3.frm", "critters")).toBe("critter animation");
        expect(frm("iisxxxx1.frm", "intrface")).toBe("interface art");
    });

    it("returns undefined with neither a known directory nor a decodable suffix", () => {
        expect(frm("elderbf3.frm", "somewhere")).toBeUndefined();
        expect(frm("elderbf3.frm", undefined)).toBeUndefined();
    });
});

describe("describeAnimationName - BAM", () => {
    it("decodes trailing IE sequence codes", () => {
        expect(bam("usar1ca.bam")).toBe("CA: cast (spell release)");
        expect(bam("mskaagu.bam")).toBe("GU: get up");
        expect(bam("mskaawk.bam")).toBe("WK: walk");
        expect(bam("mskaaa1.bam")).toBe("A1: attack");
    });

    it("recognizes the east-half suffix behind a sequence code", () => {
        expect(bam("usar1cae.bam")).toBe("CA: cast (spell release), east-facing half");
    });

    it("prefers the direct reading when a name fits both with and without the east suffix", () => {
        // "...sde" reads as DE (die) directly; the SD + east reading loses.
        expect(bam("morasde.bam")).toBe("DE: die");
    });

    it("decodes BG1 monster-style G-codes with the scheme named", () => {
        expect(bam("mrakg2.bam")).toBe("G2: attack - BG1 monster naming");
        expect(bam("mcarg11.bam")).toBe("G11: walk - BG1 monster naming");
        expect(bam("msirg1e.bam")).toBe("G1: stand (combat) - BG1 monster naming, east-facing half");
    });

    it("decodes the character-animation scheme", () => {
        expect(bam("chmf4a5.bam")).toBe("human male fighter, plate mail - attack (1-handed thrust)");
        expect(bam("cimt1sx.bam")).toBe("halfling male thief/bard, no armor - shoot (crossbow)");
        expect(bam("cefw3w.bam")).toBe("elf female mage, robe - walk");
    });

    it("falls through a near-miss character parse to the sequence code", () => {
        // Action C with a detail letter is not valid character-scheme shape, but the tail is CA.
        expect(bam("cimt1ca.bam")).toBe("CA: cast (spell release)");
    });

    it("treats bamc identically", () => {
        expect(describeAnimationName({ basename: "usar1ca.bam", sourceFormat: "bamc", sequences: [] })).toBe(
            "CA: cast (spell release)",
        );
    });

    it("returns undefined for names outside every scheme", () => {
        expect(bam("palette.bam")).toBeUndefined();
        expect(bam("gui.bam")).toBeUndefined();
    });
});
