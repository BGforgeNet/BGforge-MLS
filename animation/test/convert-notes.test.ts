import { describe, expect, it } from "vitest";
import { type Facing } from "@bgforge/image";
import { type NeutralSet } from "../src/neutral/model";
import { FALLOUT_FRM, IE_8_POINT_MIRRORED } from "../src/convert/target";
import { type ConversionPlan, planConversion } from "../src/convert/plan";
import { conversionNotes } from "../src/convert/notes";
import { directional, setWithActions } from "./ie-game-fixtures";

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
        expect(notes).toContain("- Actions: A5 (attack, jab), CA (spell), G13");
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
    /**
     * A target whose declaration step nothing here models says so. Printing nothing would read as "nothing
     * to declare", which is a stronger claim than anything has checked - so the section is never empty.
     */
    it("says so where a target's declaration step is not modelled", () => {
        const unmodelled = { ...FALLOUT_FRM, declaration: "unmodelled" as const };

        const notes = conversionNotes(walk, unmodelled, planned(walk, unmodelled), { targetId: 0x6100 });

        expect(notes).toContain("is not modelled here");
    });

    it("does not hand a non-Infinity target the Infinity declaration rows", () => {
        const notes = conversionNotes(walk, FALLOUT_FRM, planned(walk, FALLOUT_FRM), { targetId: 0x6100 });

        expect(notes).not.toContain("ANIMATE.IDS");
        expect(notes).not.toContain("ANISND.IDS");
    });

    /**
     * Fallout finds a critter's art by looking its base name up in the critter art list and appending the
     * two-letter code itself, so the list entry is the step that makes the written files reachable at all -
     * naming it is the difference between a folder of files and an animation the game can play.
     */
    it("tells a Fallout conversion which list its base name goes in", () => {
        const notes = conversionNotes(walk, FALLOUT_FRM, planned(walk, FALLOUT_FRM), {
            targetId: 0x6100,
            prefix: "XYZBAS",
        });

        expect(notes).toContain("CRITTERS.LST");
        expect(notes).toContain("XYZBAS");
    });

    it("points at the base name without inventing one where none was chosen", () => {
        const notes = conversionNotes(walk, FALLOUT_FRM, planned(walk, FALLOUT_FRM), { targetId: 0x6100 });

        expect(notes).toContain("CRITTERS.LST");
        expect(notes).toContain("the base name these files share");
    });

    /**
     * Each armour level is its own critter there, so each needs its own row - a notes file naming one base
     * for a four-level set would leave three of the written groups unreachable by the game.
     */
    it("lists one Fallout base per armour level", () => {
        const levels: NeutralSet = {
            ...walk,
            variants: [
                { ...walk.variants[0]!, armour: 1 },
                { ...walk.variants[0]!, armour: 2 },
            ],
        };

        const notes = conversionNotes(levels, FALLOUT_FRM, planned(levels, FALLOUT_FRM), {
            targetId: 0x6100,
            prefix: "XYZBAS",
        });

        expect(notes).toContain("XYZBAS1");
        expect(notes).toContain("XYZBAS2");
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
