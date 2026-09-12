/**
 * Converting the open set into another game's files: what the editor shows before anything is written.
 *
 * The bytes are real - a BAM the direction interpreter reads as one eight-slot block - because the whole
 * question here is what the conversion DOES with a file, and a hand-built stand-in would be answering
 * about itself. What each layer below decides has its own tests in `animation/`; this pins the editor's
 * own contract: which targets are offered, what a refusal says, and what a run would write.
 */
import { describe, expect, it } from "vitest";
import { type AnimationSet, type StanceIo } from "@bgforge/animation";
import { type Frame, type IndexedAnimation, type Rgba, parseBamV1, parseFrm, serializeBamV1 } from "@bgforge/image";
import { bandedPair, packedBands, unevenBand } from "../../../image/test/bam-fixtures.ts";
import { convertOpenSet, defaultPrefix, suggestTargetId } from "../../src/image-editor/conversion";

function palette(): Rgba[] {
    return Array.from({ length: 256 }, (_, i) => ({ r: i, g: i, b: i, a: 255 }));
}

/** One 8-cycle block, five slots drawn and three padded - the shape a mirrored IE member stores. */
function baseFileBam(): Uint8Array {
    const frame = (seed: number): Frame => ({
        width: 2,
        height: 2,
        pixels: new Uint8Array([seed, seed, seed, seed]),
        offsetX: 1,
        offsetY: 1,
    });
    const frames: Frame[] = [frame(0)];
    const sequences = [];
    for (let slot = 0; slot < 8; slot++) {
        if (slot < 5) {
            const first = frames.length;
            frames.push(frame(first), frame(first + 1));
            sequences.push({ frameRefs: [first, first + 1], facing: "none" as const });
        } else {
            sequences.push({ frameRefs: [0, 0], facing: "none" as const });
        }
    }
    const animation: IndexedAnimation = { palette: palette(), sequences, frames, meta: { sourceFormat: "bam" } };
    return serializeBamV1(animation);
}

/**
 * One nine-cycle block, every cycle drawn - the shape the sixteen-point scheme stores, and the source a
 * character-family conversion needs: the target stores nine facings, so an eight-slot source cannot fill it.
 */
function wideBandBam(): Uint8Array {
    const frame = (seed: number): Frame => ({
        width: 2,
        height: 2,
        pixels: new Uint8Array([seed, seed, seed, seed]),
        offsetX: 1,
        offsetY: 1,
    });
    const frames: Frame[] = [];
    const sequences = [];
    for (let slot = 0; slot < 9; slot++) {
        const first = frames.length;
        frames.push(frame(first), frame(first + 1));
        sequences.push({ frameRefs: [first, first + 1], facing: "none" as const });
    }
    const animation: IndexedAnimation = { palette: palette(), sequences, frames, meta: { sourceFormat: "bam" } };
    return serializeBamV1(animation);
}

/**
 * A two-action monster set, named in the two-letter family.
 *
 * Deliberately not the cycle-numbered layout: a `G1` names a file's position and nothing about what it
 * depicts, so a set read from one can only ever be written back cycle-numbered. Naming is exactly what a
 * conversion has to get right, so the fixture has to be a set whose actions mean something.
 */
const SET: AnimationSet = {
    id: 0x1234,
    code: "TST",
    name: "TEST_ANIM",
    prefixByArmour: new Map([[1, "TSTB"]]),
    paperdollPrefix: undefined,
    scheme: { kind: "layout" },
    layout: "actions",
};

const FILES: Record<string, Uint8Array> = { TSTBSD: baseFileBam(), TSTBWK: baseFileBam() };

const io: StanceIo = {
    exists: (resref) => Object.hasOwn(FILES, resref.toUpperCase()),
    read: (resref) => FILES[resref.toUpperCase()],
};

/** The same two actions, stored at sixteen points - the source a nine-stored target can be filled from. */
const WIDE_SET: AnimationSet = { ...SET, id: 0x1235, prefixByArmour: new Map([[1, "WIDB"]]) };
const WIDE_FILES: Record<string, Uint8Array> = { WIDBSD: wideBandBam(), WIDBWK: wideBandBam() };
const wideIo: StanceIo = {
    exists: (resref) => Object.hasOwn(WIDE_FILES, resref.toUpperCase()),
    read: (resref) => WIDE_FILES[resref.toUpperCase()],
};

/** The two-letter monster shape, named by action code. The section is what fixes the geometry. */
const request = {
    engine: "infinity" as const,
    section: "monster_old",
    naming: "action-codes" as const,
    prefix: "NEWB",
    targetId: 0x9000,
    notes: true,
};

describe("convertOpenSet uneven rotations", () => {
    /**
     * An FRM stores ONE frame count for all six of its rotations, and an Infinity Engine source routinely
     * differs by a frame or two between facings - a shipped stand runs 76 to 81. The reader's answer is
     * carried all the way to the bytes, so what the dialog says and what the file holds cannot disagree.
     */
    const JAGGED: Record<string, Uint8Array> = {
        TSTBSD: unevenBand(2, [0, 1, 2, 3, 4], 1),
        TSTBWK: bandedPair(2, [0, 1, 2, 3, 4]),
    };
    const jagged: StanceIo = {
        exists: (resref) => Object.hasOwn(JAGGED, resref.toUpperCase()),
        read: (resref) => JAGGED[resref.toUpperCase()],
    };
    const asFallout = { ...request, engine: "fallout" as const, naming: "fallout-critter" as const };

    function rotationLengths(bytes: Uint8Array): number[] {
        return parseFrm(bytes).sequences.map((sequence) => sequence.frameRefs.length);
    }

    it("says so, and holds the last frame by default", () => {
        const held = convertOpenSet(SET, jagged, "tob", asFallout);
        const first = held.writes[0];
        if (first === undefined) throw new Error("expected a written member");

        expect(held.unevenRotations).toBe(true);
        expect(new Set(rotationLengths(first.bytes)).size).toBe(1);
        expect(rotationLengths(first.bytes)[0]).toBe(3);
    });

    /** Cutting to the shortest is the one answer that discards frames, so it is asked for explicitly. */
    it("cuts every rotation to the shortest where the reader asks for it", () => {
        const cut = convertOpenSet(SET, jagged, "tob", { ...asFallout, unevenRotations: "clip" });
        const first = cut.writes[0];
        if (first === undefined) throw new Error("expected a written member");

        expect(rotationLengths(first.bytes)[0]).toBe(2);
    });

    /** A source whose facings already agree has nothing to resolve, so the dialog draws no control. */
    it("says a source whose rotations already agree has none", () => {
        expect(convertOpenSet(SET, io, "tob", asFallout).unevenRotations).toBe(false);
    });
});

describe("convertOpenSet", () => {
    it("writes one file per action, under the target's own names", () => {
        const result = convertOpenSet(SET, io, "tob", request);

        expect(result.outcome).toBe("lossless");
        // The stem is the reader's and the codes are the target's naming of what each action depicts, so
        // the result is named for the destination rather than copied from the source.
        // Each member with its eastern companion: the section fixes the shape, and every eight-point family
        // an install declares keeps its east beside the base. A mirrored eight-point set is not a shape any
        // documented type uses, so it is no longer one this can be asked for.
        expect(result.writes.map((write) => write.resref)).toEqual(["NEWBSD", "NEWBSDE", "NEWBWK", "NEWBWKE"]);
        expect(result.writes.every((write) => write.bytes.length > 0)).toBe(true);
        expect(result.losses).toEqual([]);
    });

    /**
     * The character family stores nine facings and an eight-slot source holds art for five of them, with
     * the half-steps mirroring onto half-steps it also lacks. Refused rather than written with four of
     * every nine bands empty - the file would animate in five directions while declaring nine.
     */
    it("refuses an eight-slot source into the character family, which stores nine facings", () => {
        const result = convertOpenSet(SET, io, "tob", {
            ...request,
            section: "character",
            naming: "character" as const,
        });

        expect(result.outcome).toBe("refused");
        expect(result.reason).toMatch(/SSW, WSW, WNW, NNW/);
        expect(result.writes).toEqual([]);
    });

    /**
     * The character family, which is the one target that does not name a file per band on its own terms:
     * every one of its files carries the family's band skeleton and draws the band its code names, so what
     * lands on disk has to be the whole skeleton rather than the one band.
     */
    it("files a nine-cycle set into the character family's own files and band skeleton", () => {
        const result = convertOpenSet(WIDE_SET, wideIo, "tob", {
            ...request,
            section: "character",
            naming: "character" as const,
        });
        const written = parseBamV1(result.writes[0]?.bytes ?? new Uint8Array());

        expect(result.outcome).toBe("lossless");
        // The family names three stances and this source drew one, so the two it did not claim are filled
        // from it - each seated at its OWN band, which is what a skeleton family makes of a duplicate.
        expect(result.writes.map((write) => write.resref)).toEqual(["NEWB1G12", "NEWB1G11", "NEWB1G17", "NEWB1G18"]);
        // Eleven bands of the sixteen-point scheme's nine stored facings - what an install's own files hold.
        expect(written.sequences.length).toBe(11 * 9);
    });

    it("writes the east into its own file for a section whose type stores it", () => {
        // `monster_old` is one of the families that keeps its eastern facings in a companion, which is the
        // whole of what picks that shape now - there is no separate axis to ask for it.
        const result = convertOpenSet(SET, io, "tob", { ...request, section: "monster_old" });

        expect(result.outcome).toBe("lossless");
        expect(result.writes.map((write) => write.resref)).toEqual(["NEWBSD", "NEWBSDE", "NEWBWK", "NEWBWKE"]);
    });

    /**
     * The other game, through the profile the editor actually offers. A Fallout file is one action with its
     * six rotations inside, so the two-letter IE codes become the engine's own critter codes and the wheel
     * drops from eight points to six - a real loss, and one the reader is told about rather than left to
     * discover in the output.
     */
    it("converts into Fallout's own files and names what the narrower wheel costs", () => {
        const result = convertOpenSet(SET, io, "tob", {
            ...request,
            engine: "fallout" as const,
            naming: "fallout-critter" as const,
        });

        expect(result.outcome).toBe("lossy");
        expect(result.writes.map((write) => write.resref)).toEqual(["NEWB1AA", "NEWB1AB"]);
        // The bytes are FRM, so the name has to say so: everything downstream reads a name to pick a reader.
        expect(result.writes.map((write) => write.extension)).toEqual(["FRM", "FRM"]);
        // Fallout's wheel has no due-north or due-south, which is structural and so a note; the palette is
        // the game's own and moving a colour onto its nearest neighbour is the loss.
        expect(result.notes.join(" ")).toContain("no slot for");
        expect(result.losses.join(" ")).toContain("nearest match");
    });

    /**
     * The honesty requirement, at the case that actually arises: a cycle-numbered set's files say where
     * they sit and not what they show, so no naming that carries meaning can file them. The reader has to
     * be told that rather than handed an empty folder and a list of losses.
     */
    it("refuses a source whose actions the target's names cannot carry", () => {
        const cycles: AnimationSet = { ...SET, layout: "cycles" };
        const files: Record<string, Uint8Array> = { TSTBG1: baseFileBam() };
        const cycleIo: StanceIo = {
            exists: (resref) => Object.hasOwn(files, resref.toUpperCase()),
            read: (resref) => files[resref.toUpperCase()],
        };

        const result = convertOpenSet(cycles, cycleIo, "tob", request);

        expect(result.outcome).toBe("refused");
        expect(result.reason).toContain("Nothing states what this set's actions depict");
        expect(result.writes).toEqual([]);
    });

    /**
     * A packed file, which is what most of an install ships: the two-letter family names one file per
     * action, so the blocks come apart. Two of these three are played for an attack AND a spell, and the
     * target cannot share a clip between its files - so each is written under both names rather than
     * filed under one and lost to the other.
     */
    it("writes a shared block under every action the target names it by", () => {
        const packed: AnimationSet = { ...SET, layout: "cycles" };
        const files: Record<string, Uint8Array> = { TSTBG2: packedBands(2, 3, [0, 1, 2, 3, 4]) };
        const packedIo: StanceIo = {
            exists: (resref) => Object.hasOwn(files, resref.toUpperCase()),
            read: (resref) => files[resref.toUpperCase()],
        };

        const result = convertOpenSet(packed, packedIo, "tob", request);

        expect(result.outcome).toBe("lossless");
        expect(result.writes.map((write) => write.resref)).toEqual([
            "NEWBA1",
            "NEWBA1E",
            "NEWBA2",
            "NEWBA2E",
            "NEWBCA",
            "NEWBCAE",
            "NEWBA3",
            "NEWBA3E",
            "NEWBSP",
            "NEWBSPE",
        ]);
        expect(result.losses).toEqual([]);
    });

    /**
     * The honesty half, at a block the documentation genuinely refuses to pin: the older monster family's
     * second attack is documented as two different things, so nothing states what it depicts and no naming
     * that carries meaning can file it. It comes back as a named loss rather than a file under a guess.
     */
    it("reports what a block nothing pins costs, beside the files it did write", () => {
        const packed: AnimationSet = { ...SET, layout: "cycles", section: "monster_old" };
        const files: Record<string, Uint8Array> = { TSTBG2: packedBands(2, 2, [0, 1, 2, 3, 4]) };
        const packedIo: StanceIo = {
            exists: (resref) => Object.hasOwn(files, resref.toUpperCase()),
            read: (resref) => files[resref.toUpperCase()],
        };

        const result = convertOpenSet(packed, packedIo, "tob", request);

        expect(result.outcome).toBe("lossy");
        // The pinned attack fills the family's other two attack names as well, companion and all: this
        // naming separates them by nothing, so one clip is the honest answer under each.
        expect(result.writes.map((write) => write.resref)).toEqual([
            "NEWBA1",
            "NEWBA1E",
            "NEWBA2",
            "NEWBA2E",
            "NEWBA3",
            "NEWBA3E",
        ]);
        // The action, not the file it came from: an armoured set draws the same action out of a file per
        // level, so naming one of them would pick a level arbitrarily. The source files are listed once.
        expect(result.losses).toEqual(["Attack has no counterpart in the target"]);
        // The informational half stays separate: nothing here is a reason to hesitate.
        expect(result.notes.some((note) => note.includes("loss"))).toBe(false);
    });

    it("writes the companion notes unless the reader asked for none", () => {
        const withNotes = convertOpenSet(SET, io, "tob", request);
        const without = convertOpenSet(SET, io, "tob", { ...request, notes: false });

        // The notes are what carry the id and the hand-declaration step, so the id has to be in them.
        expect(withNotes.notesFile).toContain("9000");
        expect(without.notesFile).toBeUndefined();
        // Skipping the notes changes nothing about the files themselves.
        expect(without.writes.map((write) => write.resref)).toEqual(withNotes.writes.map((write) => write.resref));
    });

    it("falls back to the source's own stem when the reader names none", () => {
        const result = convertOpenSet(SET, io, "tob", { ...request, prefix: "" });

        expect(result.writes.map((write) => write.resref)).toEqual(["TSTBSD", "TSTBSDE", "TSTBWK", "TSTBWKE"]);
    });
});

describe("what the editor offers before the reader chooses", () => {
    it("offers the source's own stem", () => {
        expect(defaultPrefix(SET)).toBe("TSTB");
        expect(defaultPrefix({ ...SET, prefixByArmour: new Map() })).toBe("");
    });

    it("offers an id the install has not declared, at or above the source's", () => {
        const declared = [SET, { ...SET, id: 0x1235 }];

        // 0x1234 and 0x1235 are taken, so the first free neighbour is the one offered.
        expect(suggestTargetId(SET, declared)).toBe(0x1236);
        expect(suggestTargetId(SET, [])).toBe(0x1234);
    });
});
