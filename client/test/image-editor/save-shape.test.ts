/**
 * The two direction axes the dialog offers, and what they resolve to.
 *
 * Direction count and whether the east is stored are independent radios rather than four named targets,
 * and every legal pairing of them IS one of the four the converter models - which is what lets the dialog
 * ask two questions instead of listing their product.
 */
import { describe, expect, it } from "vitest";
import { FRM_FACINGS, type Facing } from "@bgforge/image";
import { ieFacingsForStride } from "@bgforge/image/ie-direction";
import { IE_16_POINT_FULL, IE_16_POINT_MIRRORED, IE_8_POINT_MIRRORED, IE_8_POINT_PAIRED } from "@bgforge/animation";
import { ieTargetFor, reachableGeometries } from "../../src/image-editor/conversion";

const WEST_ARC_8 = ieFacingsForStride(8).slice(0, 5);
const ALL_8 = ieFacingsForStride(8);
const WEST_ARC_16 = ieFacingsForStride(9);

function pairs(held: readonly Facing[]): string[] {
    return reachableGeometries(held).map((g) => `${g.directions}${g.storeEast ? "-stored" : "-mirrored"}`);
}

describe("ieTargetFor", () => {
    /** The product of the two radios IS the four targets, so neither axis needs a target of its own. */
    it("resolves each pairing of the two axes to the target that holds it", () => {
        expect(ieTargetFor(8, false)).toBe(IE_8_POINT_MIRRORED);
        expect(ieTargetFor(8, true)).toBe(IE_8_POINT_PAIRED);
        expect(ieTargetFor(16, false)).toBe(IE_16_POINT_MIRRORED);
        expect(ieTargetFor(16, true)).toBe(IE_16_POINT_FULL);
    });
});

describe("reachableGeometries", () => {
    /**
     * An eight-point source fills both eight-point targets - the paired one by mirroring, which is
     * filling - and neither sixteen-point one, whose half-steps it has no art for and cannot mirror onto.
     */
    it("offers both eight-point pairings and neither sixteen-point one to an eight-point source", () => {
        expect(pairs(WEST_ARC_8)).toEqual(["8-mirrored", "8-stored"]);
    });

    it("offers every pairing to a sixteen-point source", () => {
        expect(pairs(WEST_ARC_16)).toEqual(["8-mirrored", "8-stored", "16-mirrored", "16-stored"]);
    });

    it("offers both eight-point pairings to a source that already stores all eight", () => {
        expect(pairs(ALL_8)).toEqual(["8-mirrored", "8-stored"]);
    });

    /** Six rotations that include neither due south nor due north, which every block stores. */
    it("offers no Infinity Engine geometry to a Fallout source", () => {
        expect(pairs(FRM_FACINGS)).toEqual([]);
    });

    /**
     * An ambient, an effect, a town static: its cycles are not facings at all. Not every animation an
     * install declares is a creature, and one that is not has nothing a creature layout is built from.
     */
    it("offers nothing to a source with no directions", () => {
        expect(pairs([])).toEqual([]);
    });
});
