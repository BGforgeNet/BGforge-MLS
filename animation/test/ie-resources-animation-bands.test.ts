import { describe, expect, it } from "vitest";
import type { Facing } from "@bgforge/image";
import {
    bandsOverlaying,
    declaredStride,
    type FileBands,
    schemeForStride,
    stancesOfMembers,
} from "../src/animation-schemes/bands";
import { decodeActionCode } from "../src/animation-schemes/actions";
import { type SchemeMember } from "../src/animation-schemes/members";

/**
 * A member as the two-letter naming family produces one; the code is what its label leads with.
 *
 * `name` defaults to the label, which is what every layout but that one does - only the action-code family
 * names a file after the stance it holds, so only there do the two forms differ.
 */
function member(label: string, resref: string, name = label): SchemeMember {
    return { label, name, action: decodeActionCode("action-codes", label.slice(0, 2)), resref, parts: [resref] };
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

describe("bandsOverlaying", () => {
    /**
     * Consecutive blocks, each addressing its own run of cycles - which `bands` above does not do (its
     * blocks all index the same slots), and which is the whole thing truncation reads.
     */
    function consecutive(count: number, slots = 8): FileBands {
        return {
            ...bands(count, slots),
            bands: Array.from({ length: count }, (_block, block) =>
                Array.from({ length: slots }, (_slot, i) => ({ seqIndex: block * slots + i, facing: "S" as Facing })),
            ),
        };
    }

    it("keeps every block an overlay of the same length reaches", () => {
        expect(bandsOverlaying(consecutive(4), 32)).toHaveLength(4);
    });

    /**
     * A shorter overlay carries a PREFIX of its base's blocks - the same rule the block tables take for a
     * shorter file of a family. Volo's stores five of its base's six, so the sixth addresses cycles it
     * does not have and is dropped rather than pointing past the end of the file.
     */
    it("drops the blocks an overlay's own cycles do not reach", () => {
        expect(bandsOverlaying(consecutive(6), 40)).toHaveLength(5);
    });

    it("keeps the blocks' own slot indices, so each still addresses its cycles in the file", () => {
        expect(
            bandsOverlaying(consecutive(6), 40)
                .at(-1)
                ?.map((slot) => slot.seqIndex),
        ).toEqual([32, 33, 34, 35, 36, 37, 38, 39]);
    });

    it("keeps no block where the overlay reaches none of them", () => {
        expect(bandsOverlaying(consecutive(4), 0)).toEqual([]);
    });
});

describe("stancesOfMembers", () => {
    it("keeps a single-band file on the member's own name", () => {
        // The member's NAME, not its label: the label leads with the code that finds the file in an
        // archive listing, and a stance list is not reading a file.
        const stances = stancesOfMembers([member("WK - walk", "METNWK", "Walk")], () => bands(1));
        expect(stances).toEqual([
            {
                label: "Walk",
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
        // MOGHG1's real shape: six 8-slot bands, five stored facings each. The dying band yields two rows -
        // this length carries no block for standing back up, so that is the same band run backwards.
        const stances = stancesOfMembers([member("G1", "MOGHG1")], () => bands(6));
        expect(stances.map((s) => s.label)).toEqual([
            "Walk",
            "Combat ready",
            "Stand",
            "Get hit",
            "Die",
            "Get up",
            "Twitch",
        ]);
        expect(stances.map((s) => s.band)).toEqual([0, 1, 2, 3, 4, 4, 5]);
        expect(stances.every((s) => s.resref === "MOGHG1")).toBe(true);
    });

    /**
     * The band's own meaning, not only its name. The file is called `G1` and the code stays `G1` - that is
     * where a same-scheme write puts it back - but what the band DEPICTS is what the block table says, and
     * a converter that only had the filename could file none of these under a target's own names.
     */
    it("gives each band of a packed file what the block table says it depicts", () => {
        const stances = stancesOfMembers([member("G1", "MOGHG1")], () => bands(6));

        expect(stances.map((s) => s.action.id)).toEqual([
            "walk",
            "ready",
            "stand",
            "get-hit",
            "die",
            "get-up",
            "twitch",
        ]);
        expect(stances.every((s) => s.action.code === "G1")).toBe(true);
    });

    it("carries the grip a block's own name pins", () => {
        // The nine-block character G1 names its stances by grip, and that is a detail a target which
        // distinguishes grips can file on - so it travels with the band rather than staying in the label.
        const stances = stancesOfMembers([member("G1", "CDMB1G1")], () => bands(9));

        // Ten rows for nine bands: the dying one is played for the get-up as well, and neither carries a
        // grip - only the four stances this family distinguishes by how the weapon is held do.
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

        expect(stances.map((s) => s.label)).toEqual(["Die", "Twitch", "Stand (emerged)"]);
        // The index is the band's address in the file, so dropping the first one must not renumber the rest.
        expect(stances.map((s) => s.band)).toEqual([1, 2, 3]);
    });

    it("takes the declared section's names over the ones the structural key alone would give", () => {
        const anonymous = stancesOfMembers([member("G2", "MAKHG2")], () => bands(3, 8));
        const declared = stancesOfMembers([member("G2", "MAKHG2")], () => bands(3, 8), "monster_ankheg");

        // The layered families' second and third blocks are each played for two sequences, so each is two
        // rows over one band - which is what makes the two readings of this file differ in length as well.
        expect(anonymous.map((s) => s.label)).toEqual(["Attack", "Attack", "Cast spell", "Attack", "Conjure spell"]);
        // The emerge band is two rows for the same reason: this family's get-up is the creature rising, so
        // the block is played for both and a reader picking a stance is offered each.
        expect(declared.map((s) => s.label)).toEqual(["Stand (hidden)", "Emerge", "Get up", "Hide"]);
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

    /**
     * Getting up is the dying band reversed only where it SHARES that band. The fine monster family gives
     * it a block of its own - the engine addresses that block directly, with no reversal - so a rule keyed
     * on the sequence alone would play this family's get-up backwards.
     */
    it("plays a get-up block of its own forwards", () => {
        const stances = stancesOfMembers([member("G1", "MOGHG1")], () => bands(8, 9, "ie9"));
        const getUp = stances.find((s) => s.label === "Get up");

        expect(getUp?.band).toBe(7);
        expect(getUp?.reversed).toBeUndefined();
    });

    /**
     * A monster file too short to carry a get-up block still gets up.
     *
     * The eight-block form gives getting up and sleeping blocks of their own, and the shorter files of the
     * same family stop before them - so a stance list read off the blocks alone offered no way to stand the
     * creature back up, for most of what an install ships. Both references derive it the same way: the
     * dying band, played back to front. They disagree about SLEEP, one folding it into the death and the
     * other into the twitch, so only the get-up is taken here.
     */
    it("offers a get-up on the dying band of a monster file too short to hold one", () => {
        const stances = stancesOfMembers([member("G1", "MEASG1")], () => bands(6, 9, "ie9"));
        const getUp = stances.find((stance) => stance.label.startsWith("Get up"));

        expect(getUp?.band, "the dying band is the one played backwards").toBe(4);
        expect(getUp?.reversed).toBe(true);
        // The death itself stays on that band and keeps its own meaning - the get-up is a second row over
        // the same cycles, not a replacement for it.
        expect(stances.filter((stance) => stance.band === 4).map((stance) => stance.action.id)).toEqual([
            "die",
            "get-up",
        ]);
    });

    /**
     * And offers NO sleep there, which is the decision this pins rather than an omission.
     *
     * The published format documentation is explicit that these lengths carry no sleep block. The two
     * references then fall back differently - one to the death, the other to the twitch - and both play
     * that band FORWARD, so either would put a second name on a clip the list already shows. The get-up
     * earns its row because reversal makes it a different clip; a sleep row would not.
     */
    it("offers no sleep on a body file whose length carries no sleep block", () => {
        const stances = stancesOfMembers([member("G1", "MEASG1")], () => bands(6, 9, "ie9"));

        expect(stances.map((stance) => stance.action.id)).not.toContain("sleep");
        // The bands a sleep row would have doubled are each still offered exactly once.
        expect(stances.filter((stance) => stance.band === 4 || stance.band === 5)).toHaveLength(3);
    });

    /**
     * The same six-block body at the coarser band width, which is what most of an install's creatures ship.
     * The layout is the one above rather than a second table, so the get-up follows it.
     */
    it("offers the same get-up on a six-block body banded at eight", () => {
        const stances = stancesOfMembers([member("G1", "MOGHG1")], () => bands(6, 8, "ie8"));
        const getUp = stances.find((stance) => stance.label.startsWith("Get up"));

        expect(getUp?.band).toBe(4);
        expect(getUp?.reversed).toBe(true);
    });

    /**
     * The wide-band families keep the body in a file of five blocks with no block for standing up at all,
     * so the same derivation applies - the reference addresses their get-up at the dying block.
     */
    it("offers a get-up on the dying band of a wide-band body file", () => {
        // No scheme on the file: a wide band is settled by the SECTION's declared stride, which is what
        // `blockScheme` reads when the file itself names none.
        const wide = { ...bands(5, 16), scheme: undefined };
        const stances = stancesOfMembers([member("G2", "MWYVG2")], () => wide, "monster_quadrant");
        const getUp = stances.find((stance) => stance.label.startsWith("Get up"));

        expect(getUp?.band).toBe(3);
        expect(getUp?.reversed).toBe(true);
    });

    /**
     * The static scenery creatures, whose whole vocabulary collapses onto five blocks of one file. This is
     * the one family whose get-up is NOT the death: the engine's own lookup array sends getting up to the
     * same block as the twitch, and there is no second reference for this family to check that against.
     */
    it("offers a get-up on the twitch band of a static scenery creature", () => {
        const wide = { ...bands(5, 16), scheme: undefined };
        const stances = stancesOfMembers([member("SN", "SNOMC")], () => wide, "town_static");
        const getUp = stances.find((stance) => stance.label.startsWith("Get up"));

        expect(getUp?.band, "the twitch band, not the dying one").toBe(4);
        expect(getUp?.reversed).toBe(true);
    });

    /**
     * The longer form addresses a get-up block directly, so it is played forwards. A rule keyed on the code
     * alone would reverse this family's get-up too.
     */
    it("leaves a monster file that carries its own get-up block playing forwards", () => {
        const stances = stancesOfMembers([member("G1", "MOGHG1")], () => bands(8, 9, "ie9"));
        const getUp = stances.find((stance) => stance.label.startsWith("Get up"));

        expect(getUp?.band).toBe(7);
        expect(getUp?.reversed).toBeUndefined();
    });

    /**
     * The character family splits one eleven-band skeleton across ten files, and the install ships each of
     * them carrying its neighbours' bands too - the same cycle range at the same frame count, so the art is
     * a copy rather than a second clip. Listing every band that holds art therefore offers one death once
     * per file that happens to carry it, and a reader picking between those rows is picking at random.
     */
    it("leaves a band of a shared skeleton to the file named for it", () => {
        const hit = { ...member("G14", "CHMB1G14"), ownBand: 4 };
        const dying = { ...member("G15", "CHMB1G15"), ownBand: 5 };
        const stances = stancesOfMembers([hit, dying], () => bands(11, 9, "ie9"));

        // The two bands both files carry: each keeps the one it is named for and leaves the other alone,
        // where before this every file carrying a copy offered it. The bands neither claims are not the
        // subject and stay with whoever draws them.
        const contested = stances.filter((stance) => stance.band === 4 || stance.band === 5);

        expect(contested.map((stance) => `${stance.resref} ${stance.label}`)).toEqual([
            "CHMB1G14 Get hit",
            "CHMB1G15 Die",
        ]);
    });

    /**
     * The skeleton runs one band past its last named file - there is no `G20` - so nothing claims that
     * band and the file drawing it is the only way to reach it. Dropping every band but a file's own would
     * lose it outright, which is the failure the surplus rows were never in danger of.
     */
    it("keeps a drawn band no file of the set is named for", () => {
        const sleeping = { ...member("G19", "CHMB1G19"), ownBand: 9 };
        const stances = stancesOfMembers([sleeping], () => bands(11, 9, "ie9"));

        expect(stances.filter((stance) => stance.band === 10).map((stance) => stance.label)).toEqual([
            "Sleep 2",
            "Get up 2",
        ]);
    });

    it("keeps every band of a file that declares none of them its own", () => {
        // The cast file is the other shape: eight bands, no sibling carrying any of them, and each one a
        // different clip. A filter keyed on the family rather than on the file would empty it.
        const stances = stancesOfMembers([member("CA", "CHMB1CA")], () => bands(8, 9, "ie9"));

        expect(stances).toHaveLength(8);
    });

    /**
     * The character family has no get-up clip either: it lies the creature down in two bands and stands it
     * back up by running one of them backwards, which the reference browser addresses at those same two
     * offsets under its reversed marker. So the pair a get-up shares is not always the death.
     */
    it("plays a character's get-up as its own lying-down band reversed", () => {
        const stances = stancesOfMembers([member("G19", "CHMW1G19")], () => bands(11, 9, "ie9"));
        const lying = stances.filter((stance) => stance.band >= 9);

        expect(lying.map((stance) => stance.label)).toEqual(["Sleep 1", "Get up 1", "Sleep 2", "Get up 2"]);
        expect(lying.map((stance) => stance.reversed)).toEqual([undefined, true, undefined, true]);
    });

    /**
     * The older character family ships its `G1` at two lengths, and the longer one splits sleeping out of
     * the dying band into a still of its own. The get-up stays on the DEATH either way - the reference
     * browser addresses it at that offset for the whole family, and a one-frame pose has no reverse.
     */
    it("keeps that family's get-up on the death when its sleep has a band of its own", () => {
        const stances = stancesOfMembers([member("G1", "UELM1G1")], () => bands(9), "character_old");

        expect(stances.filter((stance) => stance.band === 6).map((stance) => stance.label)).toEqual(["Die", "Get up"]);
        expect(stances.find((stance) => stance.label === "Get up")?.reversed).toBe(true);
        expect(stances.find((stance) => stance.label === "Sleep")?.band).toBe(8);
    });

    it("plays a get-up sharing the dying band in reverse", () => {
        const stances = stancesOfMembers([member("G1", "CDMB1G1")], () => bands(8), "character_old");
        const shared = stances.filter((s) => s.band === 6);

        expect(shared.map((s) => s.label)).toEqual(["Die", "Sleep", "Get up"]);
        expect(shared.map((s) => s.reversed)).toEqual([undefined, undefined, true]);
    });

    it("carries every member's bands, in member order", () => {
        const stances = stancesOfMembers([member("G1", "MOGHG1"), member("G2", "MOGHG2")], (row) =>
            row.resref === "MOGHG1" ? bands(6) : bands(2),
        );
        // Seven from the body file - its six bands plus the get-up its dying band also plays - and two
        // from the attack file.
        expect(stances).toHaveLength(9);
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
            "Die",
            "Twitch",
            "Stand (emerged)",
            "Die (second piece)",
            "Twitch (second piece)",
            "Stand (emerged) (second piece)",
        ]);
    });

    /** A numbered band already leads with the member's own label, which carries the layer. */
    it("does not name the layer twice on a band nothing documents", () => {
        const overlay = { ...member("G2", "MAKHDG2"), label: "G2 (second piece)", layer: "second piece" };

        const stances = stancesOfMembers([overlay], () => bands(2, 10, undefined));

        expect(stances.map((s) => s.label)).toEqual(["G2 (second piece) - group 1", "G2 (second piece) - group 2"]);
    });

    /**
     * An overlay is drawn over its base facing for facing, so its band geometry IS the base's - and its
     * own files cannot always supply it: the burrowing family's overlay is one still per cycle, which
     * gives the block reader nothing to cut on.
     */
    it("bands a member that overlays another from the member it overlays", () => {
        const base = member("G1", "MAKHG1");
        const overlay = { ...member("G1", "MAKHDG1"), layer: "second piece", overlays: "MAKHG1" };
        const seen: (FileBands | undefined)[] = [];

        stancesOfMembers([base, overlay], (row, from) => {
            seen.push(from);
            return bands(row.resref === "MAKHG1" ? 4 : 3, 8);
        });

        expect(seen[0]).toBeUndefined();
        expect(seen[1]?.bands).toHaveLength(4);
    });

    it("bands a member that overlays nothing from its own files", () => {
        const seen: (FileBands | undefined)[] = [];

        stancesOfMembers([member("G1", "MOGHG1")], (_row, from) => {
            seen.push(from);
            return bands(2);
        });

        expect(seen).toEqual([undefined]);
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
