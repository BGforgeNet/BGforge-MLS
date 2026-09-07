import { describe, expect, it } from "vitest";
import type { Facing } from "@bgforge/image";
import { declaredStride, type FileBands, schemeForStride, stancesOfMembers } from "../src/animation-schemes/bands";
import { decodeActionCode } from "../src/animation-schemes/actions";
import { type SchemeMember } from "../src/animation-schemes/members";

/** A member as the two-letter naming family produces one; the code is what its label leads with. */
function member(label: string, resref: string): SchemeMember {
    return { label, action: decodeActionCode("action-codes", label.slice(0, 2)), resref, parts: [resref] };
}

/** One band of `count` slots; the facings themselves do not matter to the naming. */
function band(count: number): { seqIndex: number; facing: Facing }[] {
    return Array.from({ length: count }, (_, i) => ({ seqIndex: i, facing: "S" as Facing }));
}

function bands(count: number, slots = 5, scheme: FileBands["scheme"] = "ie8"): FileBands {
    return {
        bands: Array.from({ length: count }, () => band(slots)),
        drawn: Array.from({ length: count }, () => true),
        scheme,
        confidence: "declared",
    };
}

describe("declaredStride", () => {
    // Nothing structural can settle these: a sixteen-cycle band divides evenly into two eight-slot blocks
    // and each half is uniform, so the reading looks sound while doubling the stances at half the facings.
    it("settles the sections whose files band at sixteen", () => {
        expect(declaredStride("monster_quadrant")).toBe(16);
        expect(declaredStride("monster_large16")).toBe(16);
        expect(declaredStride("town_static")).toBe(16);
    });

    /**
     * The paired section, whose members merge a base file with the `*E` companion holding real eastern art.
     * Inference reads a LONE base file right - dummy east slots are the fingerprint it looks for - but the
     * merged pair has no dummies, so it falls through to an unnamed cycle list and the eastern art stops
     * being eastern. A converter reading that would discard hand-drawn facings and report no loss.
     */
    it("settles the paired section, whose merged members have no dummy slots to recognise", () => {
        expect(declaredStride("character_old")).toBe(8);
    });

    it("leaves every other section to structural inference", () => {
        // Overriding where inference is already right would replace a measured answer with a guess.
        expect(declaredStride("monster")).toBeUndefined();
        expect(declaredStride("character")).toBeUndefined();
        expect(declaredStride("monster_old")).toBeUndefined();
        expect(declaredStride(undefined)).toBeUndefined();
    });
});

describe("schemeForStride", () => {
    /** Keeping the scheme is what keeps the block table's stance names on a declared-stride band. */
    it("reads an eight-cycle band as the eight-slot scheme", () => {
        expect(schemeForStride(8)).toBe("ie8");
    });

    it("leaves a wider band without a scheme, since the block table names none", () => {
        expect(schemeForStride(16)).toBeUndefined();
    });
});

describe("stancesOfMembers", () => {
    it("keeps a single-band file on the member's own name", () => {
        const stances = stancesOfMembers([member("WK - walk", "METNWK")], () => bands(1));
        expect(stances).toEqual([
            {
                label: "WK - walk",
                action: { scheme: "action-codes", id: "walk", code: "WK" },
                resref: "METNWK",
                parts: ["METNWK"],
                band: 0,
                slots: band(5),
                confidence: "declared",
            },
        ]);
    });

    it("names each band of a file that packs several stances", () => {
        // MOGHG1's real shape: six 8-slot bands, five stored facings each.
        const stances = stancesOfMembers([member("G1", "MOGHG1")], () => bands(6));
        expect(stances.map((s) => s.label)).toEqual([
            "WK - walk",
            "SC - combat stance",
            "SD - stand",
            "GH - get hit",
            "DE - die",
            "TW - twitch",
        ]);
        expect(stances.map((s) => s.band)).toEqual([0, 1, 2, 3, 4, 5]);
        expect(stances.every((s) => s.resref === "MOGHG1")).toBe(true);
    });

    /**
     * The band's own meaning, not only its name. The file is called `G1` and the code stays `G1` - that is
     * where a same-scheme write puts it back - but what the band DEPICTS is what the block table says, and
     * a converter that only had the filename could file none of these under a target's own names.
     */
    it("gives each band of a packed file what the block table says it depicts", () => {
        const stances = stancesOfMembers([member("G1", "MOGHG1")], () => bands(6));

        expect(stances.map((s) => s.action.id)).toEqual(["walk", "ready", "stand", "get-hit", "die", "twitch"]);
        expect(stances.every((s) => s.action.code === "G1")).toBe(true);
    });

    it("carries the grip a block's own name pins", () => {
        // The nine-block character G1 names its stances by grip, and that is a detail a target which
        // distinguishes grips can file on - so it travels with the band rather than staying in the label.
        const stances = stancesOfMembers([member("G1", "CDMB1G1")], () => bands(9));

        expect(stances.map((s) => s.action.detail)).toEqual([
            undefined,
            "1-handed",
            "1-handed",
            "2-handed",
            "2-handed",
            undefined,
            undefined,
            undefined,
            undefined,
        ]);
    });

    it("leaves a band the block table does not pin on the file's own meaning", () => {
        // The cast blocks: the sources disagree over which half of each pair is the release, so the table
        // names them without saying what they are. The file's own code does say - `CA` is a spell - and
        // that is what the bands keep, rather than the table's silence overwriting it.
        const stances = stancesOfMembers([member("CA", "MOGHCA")], () => bands(8));

        expect(stances.map((s) => s.action.id)).toEqual(Array.from({ length: 8 }, () => "spell"));
    });

    // The burrowing G1 opens on a block no sequence addresses. It still holds a frame per facing, so it
    // passes the does-this-draw test and would otherwise be offered as a stance nobody can play.
    it("drops a band the scheme addresses no sequence to", () => {
        const stances = stancesOfMembers([member("G1", "MAKHG1")], () => bands(4, 8), "monster_ankheg");

        expect(stances.map((s) => s.label)).toEqual(["DE - die", "TW - twitch", "SD - stand (emerged)"]);
        // The index is the band's address in the file, so dropping the first one must not renumber the rest.
        expect(stances.map((s) => s.band)).toEqual([1, 2, 3]);
    });

    it("takes the declared section's names over the ones the structural key alone would give", () => {
        const anonymous = stancesOfMembers([member("G2", "MAKHG2")], () => bands(3, 8));
        const declared = stancesOfMembers([member("G2", "MAKHG2")], () => bands(3, 8), "monster_ankheg");

        expect(anonymous.map((s) => s.label)).toEqual([
            "A1 - attack",
            "A2/CA - attack or cast",
            "A3/SP - attack or spell",
        ]);
        expect(declared.map((s) => s.label)).toEqual(["SD - stand (hidden)", "EMERGE - emerge", "HIDE - burrow"]);
    });

    it("numbers the bands of a layout nothing documents, keeping the file's name", () => {
        // A wrong stance name is worse than an honest number - the same posture the block table takes.
        const stances = stancesOfMembers([member("G2", "MWYVG2")], () => bands(5, 10, undefined));
        expect(stances.map((s) => s.label)).toEqual([
            "G2 - group 1",
            "G2 - group 2",
            "G2 - group 3",
            "G2 - group 4",
            "G2 - group 5",
        ]);
        expect(stances[0]?.slots).toHaveLength(10);
    });

    it("carries every member's bands, in member order", () => {
        const stances = stancesOfMembers([member("G1", "MOGHG1"), member("G2", "MOGHG2")], (row) =>
            row.resref === "MOGHG1" ? bands(6) : bands(2),
        );
        expect(stances).toHaveLength(8);
        expect(stances.at(-1)?.resref).toBe("MOGHG2");
    });

    /**
     * A set with a second set of files bands both, and the block table names their bands identically - so
     * without the layer the two runs are indistinguishable, and a converter reading these as actions gets
     * eight pairs of colliding labels pointing at different files.
     */
    it("keeps a layer member's stances apart from the base member's of the same band", () => {
        const base = member("G1", "MAKHG1");
        const overlay = { ...member("G1", "MAKHDG1"), layer: "second piece" };

        const stances = stancesOfMembers([base, overlay], () => bands(4, 8), "monster_ankheg");

        expect(stances.map((s) => s.label)).toEqual([
            "DE - die",
            "TW - twitch",
            "SD - stand (emerged)",
            "DE - die (second piece)",
            "TW - twitch (second piece)",
            "SD - stand (emerged) (second piece)",
        ]);
    });

    /** A numbered band already leads with the member's own label, which carries the layer. */
    it("does not name the layer twice on a band nothing documents", () => {
        const overlay = { ...member("G2", "MAKHDG2"), label: "G2 (second piece)", layer: "second piece" };

        const stances = stancesOfMembers([overlay], () => bands(2, 10, undefined));

        expect(stances.map((s) => s.label)).toEqual(["G2 (second piece) - group 1", "G2 (second piece) - group 2"]);
    });

    it("drops a member the archive cannot band rather than offering a dead row", () => {
        const stances = stancesOfMembers([member("G1", "MOGHG1"), member("G9", "MISSING")], (row) =>
            row.resref === "MOGHG1" ? bands(1) : undefined,
        );
        expect(stances.map((s) => s.resref)).toEqual(["MOGHG1"]);
    });

    it("drops a band with no drawable facings", () => {
        const empty: FileBands = {
            bands: [band(5), [], band(5)],
            drawn: [true, true, true],
            scheme: "ie8",
            confidence: "declared",
        };
        expect(stancesOfMembers([member("G1", "X")], () => empty).map((s) => s.band)).toEqual([0, 2]);
    });

    /**
     * The other empty band: slots that address cycles, drawing nothing. A packed file carries one per band
     * of its family's skeleton, so listing them makes a file of eleven bands into eleven rows of which one
     * shows anything - and the band's own INDEX has to survive, since that is what addresses it in the file.
     */
    it("drops a band whose slots hold no art, keeping the index of the ones that do", () => {
        const skeleton: FileBands = {
            bands: [band(5), band(5), band(5)],
            drawn: [false, true, false],
            scheme: "ie8",
            confidence: "declared",
        };
        expect(stancesOfMembers([member("G1", "X")], () => skeleton).map((s) => s.band)).toEqual([1]);
    });
});
