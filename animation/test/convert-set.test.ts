import { describe, expect, it } from "vitest";
import { parseBamV1 } from "@bgforge/image";
import { type AnimationSet } from "../src/animation-index";
import { type StanceIo } from "../src/set-stances";
import { readNeutralSet } from "../src/neutral/read";
import { type NeutralSet } from "../src/neutral/model";
import { FALLOUT_FRM, IE_8_POINT_MIRRORED, IE_8_POINT_PAIRED } from "../src/convert/target";
import { type ConversionOptions, convertSet } from "../src/convert/convert";
import { decodeActionCode } from "../src/animation-schemes/actions";
import { bandedPair, multiCycle, packedBands } from "../../image/test/bam-fixtures.ts";

/** A west-arc band: five drawn facings and three the engine mirrors, which is the stored IE shape. */
const band = () => bandedPair(4, [0, 1, 2, 3, 4]);

function setOf(over: Partial<AnimationSet> = {}): AnimationSet {
    return {
        id: 0x6004,
        code: "CGMC",
        name: "CLERIC_MALE_GNOME",
        prefixByArmour: new Map([[1, "CDMB"]]),
        paperdollPrefix: undefined,
        scheme: { kind: "character" },
        section: "character",
        ...over,
    };
}

function read(files: Record<string, Uint8Array>, over: Partial<AnimationSet> = {}): NeutralSet {
    const io: StanceIo = { exists: (resref) => resref in files, read: (resref) => files[resref] };
    return readNeutralSet(setOf(over), io, { flavour: "tob" });
}

const OPTIONS: ConversionOptions = { prefix: "XYZ", scheme: "character", targetId: 0x6100 };

/** Which direction bands of a written file hold cycles with frames in them. */
function bandsWithArt(written: ReturnType<typeof parseBamV1>, stride: number): number[] {
    const drawn: number[] = [];
    for (let index = 0; index * stride < written.sequences.length; index++) {
        const cycles = written.sequences.slice(index * stride, index * stride + stride);
        if (cycles.some((cycle) => cycle.frameRefs.length > 0)) drawn.push(index);
    }
    return drawn;
}

function converted(set: NeutralSet, target = IE_8_POINT_MIRRORED, options = OPTIONS) {
    const result = convertSet(set, target, options);
    if (result.outcome === "refused") throw new Error(`expected a conversion, got a refusal: ${result.reason}`);
    return result;
}

describe("converting a whole set", () => {
    it("writes one file per source file, named in the target's own scheme", () => {
        const result = converted(read({ CDMB1G1: band(), CDMB1A1: band() }));

        expect(result.writes.map((write) => write.resref)).toEqual(["XYZ1G1", "XYZ1A1"]);
        expect(result.writes.every((write) => write.bytes.byteLength > 0)).toBe(true);
    });

    /**
     * The codes are not interchangeable between naming families, so the same art lands under the code the
     * TARGET uses for what it depicts - and the grip its own name pinned is a detail the target's names do
     * not carry, which the report says out loud.
     */
    it("renames an action the target's scheme files differently, and says what it dropped", () => {
        const result = converted(read({ CDMB1A1: band() }), IE_8_POINT_MIRRORED, {
            ...OPTIONS,
            scheme: "action-codes",
        });

        expect(result.writes.map((write) => write.resref)).toEqual(["XYZA1"]);
        expect(result.report.items.map((item) => item.kind)).toContain("action-code-detail");
    });

    it("gives each action of a file group its own code rather than colliding them", () => {
        // Three melee attacks whose grips the target does not distinguish: it names three attacks, so each
        // takes the next one rather than three files landing on the same name.
        const result = converted(read({ CDMB1A1: band(), CDMB1A2: band(), CDMB1A3: band() }), IE_8_POINT_MIRRORED, {
            ...OPTIONS,
            scheme: "action-codes",
        });

        expect(result.writes.map((write) => write.resref)).toEqual(["XYZA1", "XYZA2", "XYZA3"]);
    });

    it("reports an action the target's scheme has no name for, and writes nothing for it", () => {
        // A completeness loss rather than a per-pixel one: the art is intact and the target simply has
        // nowhere to file it, which is worse hidden than stated. `A7` is the case: it ships, and what it
        // depicts is documented nowhere, so no other scheme can be told where to put it.
        const result = converted(read({ CDMB1A7: band(), CDMB1A1: band() }), IE_8_POINT_MIRRORED, {
            ...OPTIONS,
            scheme: "action-codes",
        });

        expect(result.writes.map((write) => write.resref)).toEqual(["XYZA1"]);
        expect(result.report.losses.map((loss) => loss.kind)).toContain("action-unmapped");
    });

    it("writes the eastern arc into its companion for a scheme that stores it", () => {
        const result = converted(read({ CDMB1G1: band() }), IE_8_POINT_PAIRED);

        expect(result.writes.map((write) => write.resref)).toEqual(["XYZ1G1", "XYZ1G1E"]);
    });

    it("keeps a set's own names when it is converted back to the scheme it came from", () => {
        // The strongest thing this can be asked: same scheme in and out, same prefix, so the files that
        // come back must be the files that went in - anything else is a naming table that cannot round-trip.
        const result = converted(read({ CDMB1G1: band(), CDMB1A1: band(), CDMB1CA: band() }), IE_8_POINT_MIRRORED, {
            ...OPTIONS,
            prefix: "CDMB",
        });

        expect(result.writes.map((write) => write.resref)).toEqual(["CDMB1G1", "CDMB1A1", "CDMB1CA"]);
    });

    /**
     * The written bytes, not the model: everything above asserts what the converter decided, and this is
     * the only check that what it decided reaches a file a reader can open.
     */
    it("writes art a reader gets back, in the slots the target stores", () => {
        const result = converted(read({ CDMB1G1: band() }), IE_8_POINT_MIRRORED, { ...OPTIONS, prefix: "CDMB" });
        const written = parseBamV1(result.writes[0]?.bytes ?? new Uint8Array());

        // The stance's own band of the character skeleton - the rest of the file is the empty bands.
        const drawnPixels = written.sequences.slice(8, 16).map((sequence) => {
            const frame = written.frames[sequence.frameRefs[0] ?? -1];
            return frame === undefined ? undefined : frame.pixels[0];
        });
        // The west arc carries the art; the three slots this target mirrors at playback are empty, where
        // the source held padding cycles repeating its first frame.
        expect(drawnPixels.slice(0, 5)).toEqual([1, 1, 1, 1, 1]);
        expect(drawnPixels.slice(5)).toEqual([undefined, undefined, undefined]);
        expect(written.frames.length).toBeGreaterThan(0);
    });

    it("gives every armour level the same codes, since the level is part of the name", () => {
        // A set-wide tally of codes taken would find level 2's action already claimed by level 1 and
        // report the whole level as unmappable, which is the shape this exists to prevent.
        const twoLevels = read(
            { CDMB1G1: band(), CDMC2G1: band() },
            {
                prefixByArmour: new Map([
                    [1, "CDMB"],
                    [2, "CDMC"],
                ]),
            },
        );

        expect(converted(twoLevels).writes.map((write) => write.resref)).toEqual(["XYZ1G1", "XYZ2G1"]);
    });

    it("writes the notes beside the output, and leaves them out when asked to", () => {
        const set = read({ CDMB1G1: band() });

        expect(converted(set).notes).toContain("ANIMATE.IDS");
        expect(convertSet(set, IE_8_POINT_MIRRORED, { ...OPTIONS, notes: false })).toMatchObject({
            notes: undefined,
        });
    });

    /** A monster set, whose files are named by the scheme's suffixes rather than by armour and action. */
    function monster(files: Record<string, Uint8Array>, layout: AnimationSet["layout"]): NeutralSet {
        return read(files, {
            code: "MOGH",
            name: "OGRE_MAGE",
            prefixByArmour: new Map([[1, "MOGH"]]),
            scheme: { kind: "unimplemented", scheme: 1, reason: "not implemented" },
            layout,
        });
    }

    /**
     * The case most of an install is: one BAM holding six direction blocks, whose NAME says only which
     * file it is. The block table says what each block depicts, so a naming that files one action per
     * file takes the packed file apart rather than filing the whole of it under its first block.
     */
    it("writes a packed file's blocks as one target file each, named for what each block depicts", () => {
        const packed = monster({ MOGHG1: packedBands(4, 6, [0, 1, 2, 3, 4]) }, "cycles");

        const result = converted(packed, IE_8_POINT_MIRRORED, { ...OPTIONS, scheme: "action-codes" });

        expect(result.writes.map((write) => write.resref)).toEqual([
            "XYZWK",
            "XYZSC",
            "XYZSD",
            "XYZGH",
            "XYZDE",
            "XYZTW",
        ]);
    });

    it("keeps a packed file packed for a naming that addresses files rather than actions", () => {
        // The same source into a cycle-numbered target: that family names the FILE, so taking its blocks
        // apart would write six files the target's own reader would not put back together.
        const packed = monster({ MOGHG1: packedBands(4, 6, [0, 1, 2, 3, 4]) }, "cycles");

        const result = converted(packed, IE_8_POINT_MIRRORED, { ...OPTIONS, scheme: "cycle-numbers" });

        expect(result.writes.map((write) => write.resref)).toEqual(["XYZG1"]);
    });

    /**
     * The character family's own file shape, and the reason it needs one.
     *
     * Its misc files all carry the same eleven-band skeleton and draw only the band their digit names, so a
     * writer that emitted the drawn band alone would put every stance at band 0 - where the engine reads the
     * walk. Both directions are asserted: a monster's walk into the file that draws the walk band, and a
     * character stance back into its own file at the band it came from.
     */
    it("pads a stance into the band the character file draws it at", () => {
        const walk = converted(monster({ MOGHWK: band() }, "actions"));
        const written = parseBamV1(walk.writes[0]?.bytes ?? new Uint8Array());
        const drawnBands = bandsWithArt(written, 8);

        expect(walk.writes.map((write) => write.resref)).toEqual(["XYZ1G11"]);
        expect(written.sequences.length).toBe(11 * 8);
        expect(drawnBands).toEqual([0]);
    });

    /**
     * A cast file is the skeleton, not one band of it: the character family stores four conjure and release
     * pairs in one `CA`, so a source that already holds those eight bands goes in whole. Filed a band at a
     * time, seven eighths of it would be reported lost to a file that had room for all of it.
     */
    it("writes a file whose bands already fill the target's own file as it stands", () => {
        const cast = read({ CDMB1CA: packedBands(4, 8, [0, 1, 2, 3, 4]) });

        const result = converted(cast, IE_8_POINT_MIRRORED, { ...OPTIONS, prefix: "CDMB" });
        const written = parseBamV1(result.writes[0]?.bytes ?? new Uint8Array());

        expect(result.writes.map((write) => write.resref)).toEqual(["CDMB1CA"]);
        expect(written.sequences.length).toBe(8 * 8);
        expect(result.report.losses).toEqual([]);
    });

    it("puts a combat stance at its own band rather than at the front of the file", () => {
        const stance = converted(read({ CDMB1G1: band() }), IE_8_POINT_MIRRORED, { ...OPTIONS, prefix: "CDMB" });
        const written = parseBamV1(stance.writes[0]?.bytes ?? new Uint8Array());

        expect(stance.writes.map((write) => write.resref)).toEqual(["CDMB1G1"]);
        expect(bandsWithArt(written, 8)).toEqual([1]);
    });

    it("names a shot by the weapon the target files it under, and says the weapon is assumed", () => {
        // The two-letter naming says only "ranged"; the character naming has a code per weapon, so the
        // conversion has to pick one - and say that it did, since nothing in the source chose it.
        const shot = converted(monster({ MOGHA4: band() }, "actions"));

        expect(shot.writes.map((write) => write.resref)).toEqual(["XYZ1SA"]);
        expect(shot.report.items.some((item) => item.detail.includes("names a weapon"))).toBe(true);
    });

    it("refuses a member whose file the set does not carry", () => {
        // The model can name a file the reader could not parse. Refusing says so; writing would emit a
        // file with no art in it.
        const set: NeutralSet = {
            identity: { sourceId: 0x1234, code: "MOGH", name: "OGRE_MAGE", sourceFlavour: "tob", sourceSection: "x" },
            variants: [
                {
                    armour: 1,
                    files: new Map(),
                    actions: [
                        {
                            label: "G1",
                            action: decodeActionCode("cycle-numbers", "G1"),
                            resrefs: ["MOGHG1"],
                            band: 0,
                            cycles: { kind: "ordered", sequenceIndices: [0] },
                        },
                    ],
                },
            ],
        };

        expect(convertSet(set, IE_8_POINT_MIRRORED, { ...OPTIONS, scheme: "cycle-numbers" })).toMatchObject({
            outcome: "refused",
        });
    });

    /**
     * A quadrant member is one sprite cut into quarters, each its own file. Every target offered here
     * writes a member as ONE file, so the quarters are assembled into the picture they draw together -
     * writing one quarter as the whole would be a wrong animation rather than a lossy one. The reader is
     * told, because the assembled sprite is larger than anything the source shipped.
     */
    it("composes a member's parts into the single file its target writes, and says it did", () => {
        const quarters = Object.fromEntries([1, 2, 3, 4].map((part) => [`MOGHG1${part}`, band()]));

        const result = converted(monster(quarters, "quadrant"), IE_8_POINT_MIRRORED, {
            ...OPTIONS,
            scheme: "cycle-numbers",
        });

        expect(result.writes.map((write) => write.resref)).toEqual(["XYZG1"]);
        expect(result.report.items.map((item) => item.kind)).toContain("parts-composed");
        // An assembly, not a degradation: nothing the source drew is missing from the output.
        expect(result.outcome).toBe("lossless");
    });

    it("refuses to pair a file whose cycles do not fill the target's blocks", () => {
        // The eastern half of a paired scheme is slots 5-7 of each block. A band whose cycles are an
        // ordered list of three has no blocks to take a half of, and splitting on the count alone would
        // carve a companion file out of arbitrary cycles. Built by hand: the shape needs a band the
        // reader only produces from a file whose block structure it could not recognise.
        const set: NeutralSet = {
            identity: { sourceId: 0x1234, code: "MOGH", name: "OGRE_MAGE", sourceFlavour: "tob", sourceSection: "x" },
            variants: [
                {
                    armour: undefined,
                    files: new Map([["MOGHG1", parseBamV1(multiCycle(4, 3))]]),
                    actions: [
                        {
                            label: "G1",
                            action: decodeActionCode("cycle-numbers", "G1"),
                            resrefs: ["MOGHG1"],
                            band: 0,
                            cycles: { kind: "ordered", sequenceIndices: [0, 1, 2] },
                        },
                    ],
                },
            ],
        };

        expect(convertSet(set, IE_8_POINT_PAIRED, { ...OPTIONS, scheme: "cycle-numbers" })).toMatchObject({
            outcome: "refused",
        });
    });

    /**
     * The skeleton seats ONE direction band. A member whose cycles are a bare ordered list is not one - it
     * has no facings to fill the band with - and padding it anyway would put an arbitrary run of cycles at a
     * position the engine reads as a direction block.
     */
    it("refuses to seat cycles that are not a direction band in a character file", () => {
        const set: NeutralSet = {
            identity: { sourceId: 0x1234, code: "MOGH", name: "OGRE_MAGE", sourceFlavour: "tob", sourceSection: "x" },
            variants: [
                {
                    armour: 1,
                    files: new Map([["MOGHWK", parseBamV1(multiCycle(4, 3))]]),
                    actions: [
                        {
                            label: "WK",
                            action: decodeActionCode("action-codes", "WK"),
                            resrefs: ["MOGHWK"],
                            band: 0,
                            cycles: { kind: "ordered", sequenceIndices: [0, 1, 2] },
                        },
                    ],
                },
            ],
        };

        const result = convertSet(set, IE_8_POINT_MIRRORED, OPTIONS);

        expect(result).toMatchObject({ outcome: "refused" });
        expect(result.outcome === "refused" && result.reason).toContain("G11");
    });

    it("refuses a target whose files this does not know how to lay out", () => {
        const result = convertSet(read({ CDMB1G1: band() }), FALLOUT_FRM, OPTIONS);

        expect(result).toMatchObject({ outcome: "refused" });
    });

    /**
     * Every action unmapped is not a lossy conversion, it is no conversion - reported as lossy the reader
     * gets a list of losses and an empty output folder, with nothing saying which of the two happened.
     *
     * The reason names the actions ONCE. Assembling it out of the report's own loss lines repeated the same
     * clause per action and mixed in whatever else the plan had recorded, so a set of a dozen bands produced
     * a paragraph the reader had to parse to find the one fact in it.
     */
    it("refuses a conversion the target can name nothing in, naming the actions once", () => {
        const result = convertSet(read({ CDMB1A7: band(), CDMB1A8: band() }), IE_8_POINT_MIRRORED, {
            ...OPTIONS,
            scheme: "action-codes",
        });
        const reason = result.outcome === "refused" ? result.reason : "";

        expect(result).toMatchObject({ outcome: "refused" });
        // Unpinned throughout, so the reason says the source never stated what these are.
        expect(reason).toContain("Nothing states what this set's actions depict");
        expect(reason).toContain("Attack 7, Attack 8");
        expect(reason).not.toContain("counterpart");
    });

    it("says the target simply has no such name when the source's actions are pinned", () => {
        // A walk is a named thing; the cycle-numbered family names files rather than actions, so it has no
        // file to put one in. A different sentence from "nobody has said what this is", and the difference
        // matters: this one is the target's limitation, not the source's silence.
        const result = convertSet(read({ CDMB1G11: band() }), IE_8_POINT_MIRRORED, {
            ...OPTIONS,
            scheme: "cycle-numbers",
        });
        const reason = result.outcome === "refused" ? result.reason : "";

        expect(result).toMatchObject({ outcome: "refused" });
        expect(reason).toContain("no counterpart");
        expect(reason).toContain("WK - walk");
    });

    it("refuses a set with nothing in it rather than naming an empty list", () => {
        const empty: NeutralSet = {
            identity: { sourceId: 0x1234, code: "MOGH", name: "OGRE_MAGE", sourceFlavour: "tob", sourceSection: "x" },
            variants: [],
        };

        expect(convertSet(empty, IE_8_POINT_MIRRORED, OPTIONS)).toMatchObject({
            outcome: "refused",
            reason: "This set has no member to convert.",
        });
    });

    it("refuses a set whose levels the target's names cannot tell apart", () => {
        // The two-letter names carry no armour level, so two levels would write the same files twice and
        // the second would silently replace the first.
        const twoLevels = read(
            { CDMB1G1: band(), CDMB2G1: band() },
            {
                prefixByArmour: new Map([
                    [1, "CDMB"],
                    [2, "CDMB"],
                ]),
            },
        );

        const result = convertSet(twoLevels, IE_8_POINT_MIRRORED, { ...OPTIONS, scheme: "action-codes" });

        expect(result).toMatchObject({ outcome: "refused" });
    });
});
