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
        expect(frm("hanpwrjj.frm", "critters")).toBe("jj: single shot, rifle");
        expect(frm("hmjmpsdm.frm", "critters")).toBe("dm: throw, knife");
        expect(frm("hmjmpsge.frm", "critters")).toBe("ge: parry (dodge), spear");
    });

    it("decodes the sfall extended weapon letters (codes 11-15) with the RP assignment as a hint", () => {
        expect(frm("hmjmpssj.frm", "critters")).toBe("sj: single shot, sfall weapon code 11 (RP: lightsaber)");
        expect(frm("hmmetlpj.frm", "critters")).toBe("pj: single shot, sfall weapon code 13 (RP: alternative rifle)");
        expect(frm("hmjmpstb.frm", "critters")).toBe("tb: walk, sfall weapon code 15");
    });

    it("decodes knockdown/death and single-frame death poses", () => {
        expect(frm("hmjmpsba.frm", "critters")).toBe("ba: fall back (death)");
        expect(frm("hmjmpsrb.frm", "critters")).toBe("rb: fall front (death pose)");
    });

    it("decodes position changes and the targeting picture", () => {
        expect(frm("hmjmpsch.frm", "critters")).toBe("ch: prone to standing");
        expect(frm("hmjmpscj.frm", "critters")).toBe("cj: back to standing");
        expect(frm("hmwarrna.frm", "critters")).toBe("na: targeting picture (called shot)");
    });

    it("decodes the suffix without a critters directory when the art is directional", () => {
        expect(frm("hanpwrjj.frm", undefined, distinct)).toBe("jj: single shot, rifle");
    });

    it("leaves single-orientation art outside critters undecoded (no false minigun on a windmill)", () => {
        expect(frm("windmill.frm", undefined)).toBeUndefined();
        expect(frm("windmill.frm", "scenery")).toBe("scenery art");
    });

    it("falls back to the art category when the suffix does not decode", () => {
        expect(frm("elderbf3.frm", "critters")).toBe("critter animation");
        expect(frm("iisxxxx1.frm", "intrface")).toBe("interface art");
        // Out-of-range letters in an otherwise valid-looking pair: 'az' exceeds the basic table,
        // 'cz' is not a defined position change.
        expect(frm("hmjmpsaz.frm", "critters")).toBe("critter animation");
        expect(frm("hmjmpscz.frm", "critters")).toBe("critter animation");
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
        expect(bam("mrakg2.bam")).toBe("G2: BG1 monster attack");
        expect(bam("mcarg11.bam")).toBe("G11: BG1 monster walk");
        expect(bam("msirg1e.bam")).toBe("G1: BG1 monster stand (combat), east-facing half");
    });

    // The G-code table is the coarse-scheme reading. The same tokens name the finer BG2 monster files,
    // where the blocks mean something else entirely - so asserting "BG1 monster" over one of those is a
    // confident wrong answer, and no answer is better.
    it("withholds the BG1 monster reading from a fine-scheme file", () => {
        expect(
            describeAnimationName({ basename: "mtrog2.bam", sourceFormat: "bam", sequences: [], scheme: "ie9" }),
        ).toBeUndefined();
        expect(
            describeAnimationName({ basename: "mrakg2.bam", sourceFormat: "bam", sequences: [], scheme: "ie8" }),
        ).toBe("G2: BG1 monster attack");
    });

    it("decodes the character-animation scheme", () => {
        expect(bam("chmf4a5.bam")).toBe("human male fighter, plate mail - attack (1-handed thrust)");
        expect(bam("cimt1sx.bam")).toBe("halfling male thief/bard, no armor - shoot (crossbow)");
        expect(bam("cefw3w.bam")).toBe("elf female mage, robe - walk");
        expect(bam("cdmc2sxe.bam")).toBe("dwarf/gnome male cleric, leather - shoot (crossbow), east-facing half");
    });

    // Measured against both installs: the scheme's own action and detail sets are much wider than the
    // six attack details and bare-or-X shoot details the decoder first shipped with, and the shortfall
    // is silent - the name simply falls through to the generic two-letter reading, or to nothing.
    it("decodes every documented shoot detail, including the sling", () => {
        expect(bam("cefc4ss.bam")).toBe("elf female cleric, plate mail - shoot (sling)");
        expect(bam("cefc4sa.bam")).toBe("elf female cleric, plate mail - shoot (bow)");
        expect(bam("cefc4sx.bam")).toBe("elf female cleric, plate mail - shoot (crossbow)");
    });

    it("decodes the two-weapon and throwing attack details", () => {
        expect(bam("chmf4a7.bam")).toBe("human male fighter, plate mail - attack (two-weapon)");
        expect(bam("chmf4a9.bam")).toBe("human male fighter, plate mail - attack (two-weapon, variant)");
    });

    it("decodes the two-letter cast action", () => {
        expect(bam("cimt1ca.bam")).toBe("halfling male thief/bard, no armor - cast");
    });

    it("decodes the common-base class and the split G-series stance files", () => {
        expect(bam("cdfb1g11.bam")).toBe("dwarf/gnome female common base, no armor - walk");
        expect(bam("cdfb1g1.bam")).toBe("dwarf/gnome female common base, no armor - combat stance (1-handed)");
        expect(bam("cdfb1g19.bam")).toBe("dwarf/gnome female common base, no armor - sleep");
    });

    it("names the inventory paperdoll", () => {
        expect(bam("cefc4inv.bam")).toBe("elf female cleric, plate mail - inventory paperdoll");
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
