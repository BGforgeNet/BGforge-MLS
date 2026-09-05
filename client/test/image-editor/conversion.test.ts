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
import { type Frame, type IndexedAnimation, type Rgba, serializeBamV1 } from "@bgforge/image";
import { packedBands } from "../../../image/test/bam-fixtures.ts";
import {
    CONVERSION_PROFILES,
    convertOpenSet,
    conversionProfile,
    defaultPrefix,
    suggestTargetId,
} from "../../src/image-editor/conversion";

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
    scheme: { kind: "unimplemented", scheme: 1, reason: "the monster scheme is not implemented yet" },
    layout: "actions",
};

const FILES: Record<string, Uint8Array> = { TSTBSD: baseFileBam(), TSTBWK: baseFileBam() };

const io: StanceIo = {
    exists: (resref) => Object.hasOwn(FILES, resref.toUpperCase()),
    read: (resref) => FILES[resref.toUpperCase()],
};

const request = {
    profileId: "ie-monster",
    prefix: "NEWB",
    targetId: 0x9000,
    notes: true,
};

describe("convertOpenSet", () => {
    it("writes one file per action, under the target's own names", () => {
        const result = convertOpenSet(SET, io, "tob", request);

        expect(result.outcome).toBe("lossless");
        // The stem is the reader's and the codes are the target's naming of what each action depicts, so
        // the result is named for the destination rather than copied from the source.
        expect(result.writes.map((write) => write.resref)).toEqual(["NEWBSD", "NEWBWK"]);
        expect(result.writes.every((write) => write.bytes.length > 0)).toBe(true);
        expect(result.losses).toEqual([]);
    });

    it("writes the east into its own file for a target that stores it", () => {
        const result = convertOpenSet(SET, io, "tob", { ...request, profileId: "ie-monster-paired" });

        expect(result.outcome).toBe("lossless");
        expect(result.writes.map((write) => write.resref)).toEqual(["NEWBSD", "NEWBSDE", "NEWBWK", "NEWBWKE"]);
    });

    it("refuses a target whose file layout is not modelled, and writes nothing", () => {
        const result = convertOpenSet(SET, io, "tob", { ...request, profileId: "fallout-frm" });

        expect(result.outcome).toBe("refused");
        expect(result.reason).toContain("Fallout");
        expect(result.writes).toEqual([]);
        expect(result.notesFile).toBeUndefined();
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
        expect(result.reason).toContain("no file the target can name");
        expect(result.writes).toEqual([]);
    });

    /**
     * A packed file, which is what most of an install ships: the two-letter family names one file per
     * action, so the blocks come apart - and the blocks the documentation refuses to pin come back as
     * named losses rather than as files under a guessed name.
     */
    it("reports what a packed file's unnamed blocks cost, beside the files it did write", () => {
        const packed: AnimationSet = { ...SET, layout: "cycles" };
        const files: Record<string, Uint8Array> = { TSTBG2: packedBands(2, 3, [0, 1, 2, 3, 4]) };
        const packedIo: StanceIo = {
            exists: (resref) => Object.hasOwn(files, resref.toUpperCase()),
            read: (resref) => files[resref.toUpperCase()],
        };

        const result = convertOpenSet(packed, packedIo, "tob", request);

        expect(result.outcome).toBe("lossy");
        expect(result.writes.map((write) => write.resref)).toEqual(["NEWBA1"]);
        expect(result.losses).toEqual([
            "A2/CA - attack or cast (TSTBG2) has no counterpart in the target",
            "A3/SP - attack or spell (TSTBG2) has no counterpart in the target",
        ]);
        // The informational half stays separate: nothing here is a reason to hesitate.
        expect(result.notes.some((note) => note.includes("loss"))).toBe(false);
    });

    it("refuses a target it does not offer", () => {
        const result = convertOpenSet(SET, io, "tob", { ...request, profileId: "playstation" });

        expect(result.outcome).toBe("refused");
        expect(result.reason).toBe("No such conversion target.");
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

        expect(result.writes.map((write) => write.resref)).toEqual(["TSTBSD", "TSTBWK"]);
    });
});

describe("the offered conversions", () => {
    it("names each one once, and finds them by id", () => {
        const ids = CONVERSION_PROFILES.map((profile) => profile.id);

        expect(new Set(ids).size).toBe(ids.length);
        expect(conversionProfile("ie-character")?.scheme).toBe("character");
        expect(conversionProfile("nothing")).toBeUndefined();
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
