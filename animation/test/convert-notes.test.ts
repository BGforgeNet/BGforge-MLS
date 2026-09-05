import { describe, expect, it } from "vitest";
import { type Facing } from "@bgforge/image";
import { type NeutralAction, type NeutralSet } from "../src/neutral/model";
import { readNeutralSet } from "../src/neutral/read";
import { type AnimationSet } from "../src/animation-index";
import { type StanceIo } from "../src/set-stances";
import { FALLOUT_FRM, IE_8_POINT_MIRRORED } from "../src/convert/target";
import { type ConversionPlan, planConversion } from "../src/convert/plan";
import { conversionNotes } from "../src/convert/notes";
import { decodeActionCode } from "../src/animation-schemes/actions";
import { bandedPair } from "../../image/test/bam-fixtures.ts";

function setWithActions(actions: NeutralAction[]): NeutralSet {
    const set: AnimationSet = {
        id: 0x6004,
        code: "CGMC",
        name: "CLERIC_MALE_GNOME",
        prefixByArmour: new Map([[1, "CDMB"]]),
        paperdollPrefix: undefined,
        scheme: { kind: "character" },
        section: "character",
    };
    const files: Record<string, Uint8Array> = { CDMB1G1: bandedPair(4, [0, 1, 2, 3, 4]) };
    const io: StanceIo = { exists: (resref) => resref in files, read: (resref) => files[resref] };
    const read = readNeutralSet(set, io, { flavour: "tob" });
    return { ...read, variants: [{ ...read.variants[0]!, actions }] };
}

function directional(label: string, facings: Facing[], code = "G1"): NeutralAction {
    return {
        label,
        action: decodeActionCode("character", code),
        resrefs: ["CDMB1G1"],
        band: 0,
        cycles: { kind: "directional", directions: facings.map((facing, at) => ({ facing, sequenceIndex: at })) },
    };
}

/** A plan that went ahead, failing loudly rather than writing notes about a refusal. */
function planned(set: NeutralSet, target: Parameters<typeof planConversion>[1]) {
    const plan: ConversionPlan = planConversion(set, target);
    if (plan.outcome === "refused") throw new Error(`expected a plan, got a refusal: ${plan.reason}`);
    return plan;
}

const WEST_ARC_8: Facing[] = ["S", "SW", "W", "NW", "N"];
const ALL_8: Facing[] = ["S", "SW", "W", "NW", "N", "NE", "E", "SE"];

const walk = setWithActions([directional("WK - walk", WEST_ARC_8)]);

describe("the companion notes file", () => {
    /**
     * The point of the file. Declaring an animation is a merge into shared tables rather than a file write,
     * so the tool states the rows instead of writing them - an override copy of `ANIMATE.IDS` shadows the
     * archived one wholesale and collides with the next mod that edits it.
     */
    it("gives the two IDS rows to add by hand, under the id it assumed", () => {
        const notes = conversionNotes(walk, IE_8_POINT_MIRRORED, planned(walk, IE_8_POINT_MIRRORED), {
            targetId: 0x6100,
        });

        expect(notes).toContain("`ANIMATE.IDS`: `0x6100 CLERIC_MALE_GNOME`");
        expect(notes).toContain("`ANISND.IDS`: `0x6100 CGMC`");
    });

    /** Enough to trace the output back to what it came from without opening either install. */
    it("records where the set came from - game, id, section and the files read", () => {
        const notes = conversionNotes(walk, IE_8_POINT_MIRRORED, planned(walk, IE_8_POINT_MIRRORED), {
            targetId: 0x6100,
        });

        expect(notes).toContain("tob");
        expect(notes).toContain("0x6004");
        expect(notes).toContain("character");
        expect(notes).toContain("CDMB1G1");
    });

    /**
     * The codes rather than the labels: they are what the source's filenames carry, so a reader can check
     * this against an archive listing. What each one depicts is what the conversion matched on.
     */
    it("names each action once, with what its code depicts beside it", () => {
        const set = setWithActions([
            directional("Attack 5", WEST_ARC_8, "A5"),
            directional("Cast", WEST_ARC_8, "CA"),
            directional("Misc 13", WEST_ARC_8, "G13"),
            directional("Attack 5 again", WEST_ARC_8, "A5"),
        ]);

        const notes = conversionNotes(set, IE_8_POINT_MIRRORED, planned(set, IE_8_POINT_MIRRORED), {
            targetId: 0x6100,
        });

        // An unpinned code stands bare, which is the same statement the vocabulary makes about it.
        expect(notes).toContain("- Actions: A5 (attack, 1-handed thrust), CA (spell), G13");
    });

    it("says so in one line when nothing was lost", () => {
        const notes = conversionNotes(walk, IE_8_POINT_MIRRORED, planned(walk, IE_8_POINT_MIRRORED), {
            targetId: 0x6100,
        });

        expect(notes).toContain("Lossless.");
    });

    /** A named loss reaches the file verbatim - it is the record the user keeps after the dialog is gone. */
    it("lists every named loss when the conversion degrades something", () => {
        const drawn = setWithActions([directional("WK - walk", ALL_8)]);

        const notes = conversionNotes(drawn, IE_8_POINT_MIRRORED, planned(drawn, IE_8_POINT_MIRRORED), {
            targetId: 0x6100,
        });

        expect(notes).toContain("NE, E, SE are drawn and the target mirrors them: WK - walk");
        expect(notes).not.toContain("Lossless.");
    });

    /**
     * The IDS pair is an Infinity Engine table. Printing those rows for a Fallout target told the reader to
     * edit tables that game does not have - caught by reading a rendered file, not by a unit assertion.
     */
    it("does not hand a non-Infinity target the Infinity declaration rows", () => {
        const notes = conversionNotes(walk, FALLOUT_FRM, planned(walk, FALLOUT_FRM), { targetId: 0x6100 });

        expect(notes).not.toContain("ANIMATE.IDS");
        expect(notes).toContain("is not modelled here");
    });

    /**
     * A structural note still belongs in the file even though it leaves the conversion lossless: the reader
     * wants to know the target holds no such slot, and stating it once is what keeps it worth reading.
     */
    it("records a structural note without calling the conversion lossy", () => {
        const notes = conversionNotes(walk, FALLOUT_FRM, planned(walk, FALLOUT_FRM), { targetId: 0x6100 });

        expect(notes).toContain("the target holds its own palette and remaps what it is given");
        expect(notes).toContain("Lossless.");
    });

    /**
     * Plenty of shipped animations name nothing - the IDS tables cover a fraction of the ids an install
     * declares - so the heading falls back rather than rendering as an empty `#`, and an undeclared section
     * says so instead of leaving the line blank.
     */
    it("falls back through code then id when the set is unnamed", () => {
        const coded: NeutralSet = { ...walk, identity: { ...walk.identity, name: "" } };
        const anonymous: NeutralSet = {
            ...walk,
            identity: { ...walk.identity, name: "", code: "", sourceSection: undefined },
        };

        expect(
            conversionNotes(coded, IE_8_POINT_MIRRORED, planned(coded, IE_8_POINT_MIRRORED), { targetId: 1 }),
        ).toContain("# CGMC");
        const notes = conversionNotes(anonymous, IE_8_POINT_MIRRORED, planned(anonymous, IE_8_POINT_MIRRORED), {
            targetId: 1,
        });
        expect(notes).toContain("# 0x6004");
        expect(notes).toContain("Section `none declared`");
    });

    /**
     * Terse is a requirement of the file, not a preference: it is read beside the output, and a page of
     * prose is one nobody reads. Guarded loosely, since the bound is on bulk rather than on wording.
     */
    it("stays short enough to read at a glance", () => {
        const notes = conversionNotes(walk, IE_8_POINT_MIRRORED, planned(walk, IE_8_POINT_MIRRORED), {
            targetId: 0x6100,
        });

        expect(notes.split("\n").length).toBeLessThan(25);
    });
});
