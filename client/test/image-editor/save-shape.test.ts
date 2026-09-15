/**
 * Which sections a set can be written under, which is the one shape control the dialog has.
 *
 * The section fixes the geometry - its type decides how many facings are stored and whether the eastern
 * ones sit in a companion - so "can this set be written under that header" is the same question the planner
 * refuses on, asked before the reader picks. A section whose stored slots the source cannot fill is not a
 * lossy conversion but a file with declared facings and no art in them.
 */
import { describe, expect, it } from "vitest";
import { FRM_FACINGS, type Facing } from "@bgforge/image";
import { ieFacingsForStride } from "@bgforge/image/ie-direction";
import { sectionIsReachable } from "../../src/image-editor/conversion";

/** The western five of eight, which is what an eight-point base file stores. */
const WEST_ARC_8 = ieFacingsForStride(8).slice(0, 5);
const ALL_8 = ieFacingsForStride(8);
/** The nine an install's finer families store, the eastern seven being mirrored. */
const WEST_ARC_16 = ieFacingsForStride(9);

/** Sections standing for each shape, so a table row changing does not rewrite every assertion here. */
const EIGHT_POINT = "monster_old";
const SIXTEEN_POINT = "monster";
const WIDE = "monster_large16";

function reach(held: readonly Facing[], sections: readonly string[]): string[] {
    return sections.filter((section) => sectionIsReachable(section, held));
}

describe("sectionIsReachable", () => {
    /**
     * An eight-point source fills an eight-point family - the companion half by mirroring, which counts as
     * filling - and no finer one, whose half-steps it has no art for and cannot mirror onto.
     */
    it("offers an eight-point source only the families that store eight", () => {
        expect(reach(WEST_ARC_8, [EIGHT_POINT, SIXTEEN_POINT, WIDE])).toEqual([EIGHT_POINT]);
        expect(reach(ALL_8, [EIGHT_POINT, SIXTEEN_POINT, WIDE])).toEqual([EIGHT_POINT]);
    });

    /** A finer source holds the coarser wheel's facings too, so it reaches both. */
    it("offers a sixteen-point source the coarser families as well as its own", () => {
        expect(reach(WEST_ARC_16, [EIGHT_POINT, SIXTEEN_POINT])).toEqual([EIGHT_POINT, SIXTEEN_POINT]);
    });

    /** Six rotations that include neither due south nor due north, which every block stores. */
    it("offers no Infinity Engine family to a Fallout source", () => {
        expect(reach(FRM_FACINGS, [EIGHT_POINT, SIXTEEN_POINT, WIDE])).toEqual([]);
    });

    /**
     * An ambient, an effect, a town static: its cycles are not facings at all. Not every animation an
     * install declares is a creature, and one that is not has nothing a creature layout is built from.
     */
    it("offers nothing to a source with no directions", () => {
        expect(reach([], [EIGHT_POINT, SIXTEEN_POINT, WIDE])).toEqual([]);
    });

    /**
     * A family this project can state no shape for is unreachable whatever the source holds - there is no
     * target to check against, so offering it would mean offering a header and refusing it on pick.
     */
    it("offers nothing for a family whose shape nothing here states", () => {
        expect(sectionIsReachable("monster_quadrant", WEST_ARC_16)).toBe(false);
        expect(sectionIsReachable("some_mods_own_header", WEST_ARC_16)).toBe(false);
    });
});
