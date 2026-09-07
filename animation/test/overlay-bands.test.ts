/**
 * Banding a member that is drawn OVER another, against real BAM bytes rather than a game.
 *
 * The corpus suites cover this too, but they skip without an install - and these two paths are exactly
 * the ones a reader without one would ship blind: an overlay's own files need not carry the structure a
 * block reader cuts on, so the code that borrows the base's geometry never runs on the fixtures.
 */
import { describe, expect, it } from "vitest";
import { packedBands } from "../../image/test/bam-fixtures.ts";
import { type AnimationSet } from "../src/animation-index";
import { type StanceIo, overlaidStride, setMembers, setStances } from "../src/set-stances";

/**
 * The burrowing family's shape: a base under one prefix and a second set of files under another.
 *
 * `monster_ankheg` because its layer label is the one the section table names, so the members come back
 * marked the way a real set's do.
 */
const SET: AnimationSet = {
    id: 0x3000,
    code: "AKH",
    name: "TEST_BURROWER",
    prefixByArmour: new Map([[1, "MAKH"]]),
    paperdollPrefix: undefined,
    scheme: { kind: "unimplemented", scheme: 1, reason: "the burrowing scheme is not implemented yet" },
    layout: "cycles",
    section: "monster_ankheg",
    layerPrefixes: ["MAKHD"],
};

function ioFor(files: Record<string, Uint8Array>): StanceIo {
    return { exists: (resref) => Object.hasOwn(files, resref), read: (resref) => files[resref] };
}

/**
 * A member is the base file AND its eastern twin - the base stores the western five facings of each
 * block and pads the rest, the twin the reverse. Banding the base file alone reads a five-facing arc,
 * which is the file's shape and not the member's.
 */
const west = (): Uint8Array => packedBands(4, 2, [0, 1, 2, 3, 4]);
const east = (): Uint8Array => packedBands(4, 2, [5, 6, 7]);

/**
 * The overlay's files: every cycle one repeated frame. Real art - the frames are sixteen pixels - but
 * nothing varies across the file, which is what leaves a block reader with nothing to cut on.
 */
const stills = (): Uint8Array => packedBands(4, 2, []);

describe("banding an overlay against its base", () => {
    it("reads the base's band width for the overlay, whose own files do not carry one", () => {
        const io = ioFor({ MAKHG1: west(), MAKHG1E: east(), MAKHDG1: stills(), MAKHDG1E: stills() });

        const stances = setStances(SET, 1, io);
        const widths = new Map<string, number[]>();
        for (const stance of stances) {
            widths.set(stance.resref, [...(widths.get(stance.resref) ?? []), stance.slots.length]);
        }

        expect([...widths.keys()]).toEqual(["MAKHG1", "MAKHDG1"]);
        expect(widths.get("MAKHDG1")).toEqual(widths.get("MAKHG1"));
    });

    it("gives the base member's band width, and nothing for a member that overlays nothing", () => {
        const io = ioFor({ MAKHG1: west(), MAKHG1E: east(), MAKHDG1: stills(), MAKHDG1E: stills() });
        const members = setMembers(SET, 1, io.exists);
        const overlay = members.find((member) => member.layer !== undefined);
        const own = members.find((member) => member.layer === undefined);

        expect(overlaidStride(SET, 1, io, overlay!)).toEqual({ stride: 8, scheme: "ie8" });
        expect(overlaidStride(SET, 1, io, own!)).toBeUndefined();
    });

    /** A layer file whose base the install does not ship has nothing to borrow, and says so. */
    it("gives nothing where the base member is absent", () => {
        const io = ioFor({ MAKHDG1: stills(), MAKHDG1E: stills() });
        const overlay = setMembers(SET, 1, io.exists).find((member) => member.layer !== undefined);

        expect(overlay?.overlays).toBeUndefined();
        expect(overlaidStride(SET, 1, io, overlay!)).toBeUndefined();
    });
});
