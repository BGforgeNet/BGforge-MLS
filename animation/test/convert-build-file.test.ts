import { describe, expect, it } from "vitest";
import { type Facing, type IndexedAnimation } from "@bgforge/image";
import { type NeutralAction } from "../src/neutral/model";
import { decodeActionCode } from "../src/animation-schemes/actions";
import {
    type ConversionTarget,
    FALLOUT_FRM,
    IE_8_POINT_MIRRORED,
    IE_8_POINT_PAIRED,
    IE_16_POINT_FULL,
} from "../src/convert/target";
import { buildTargetFile } from "../src/convert/build-file";
import { greyPalette } from "../../image/test/bam-fixtures.ts";

const WEST_ARC: Facing[] = ["S", "SW", "W", "NW", "N"];

/**
 * A file of `bands` eight-slot blocks, each cycle opening on a frame of its own.
 *
 * One frame per cycle so a rebuilt file can be traced back to the slot it came from: a frame index says
 * which block and which facing produced it.
 */
function fileOf(bands: number): IndexedAnimation {
    const cycles = bands * 8;
    return {
        palette: greyPalette(),
        frames: Array.from({ length: cycles }, (_, at) => ({
            width: 2,
            height: 2,
            pixels: new Uint8Array(4).fill(at % 256),
            offsetX: 0,
            offsetY: 0,
        })),
        sequences: Array.from({ length: cycles }, (_, at) => ({ frameRefs: [at], facing: "none" as const })),
        meta: { sourceFormat: "bam", transparentIndex: 0 },
    };
}

/** The band at `band`, storing the west arc in the first five slots of its block - the IE stored shape. */
function westBand(band: number): NeutralAction {
    return {
        label: `G1 - band ${band}`,
        action: decodeActionCode("character", "G1"),
        resrefs: ["CDMB1G1"],
        band,
        cycles: {
            kind: "directional",
            directions: WEST_ARC.map((facing, slot) => ({ facing, sequenceIndex: band * 8 + slot })),
        },
    };
}

describe("laying a converted file out in the target's blocks", () => {
    it("gives every band the target's full block, padding the slots it does not store", () => {
        // The file's shape is the block, not the stored count: an engine reads slot 5 of each block as the
        // mirrored east, so a file that packed five cycles per band would put band two where east belongs.
        const built = buildTargetFile(fileOf(2), [westBand(0), westBand(1)], IE_8_POINT_MIRRORED);

        expect(built?.sequences).toHaveLength(16);
        expect(built?.sequences.slice(0, 5).map((sequence) => sequence.frameRefs)).toEqual([[0], [1], [2], [3], [4]]);
        expect(built?.sequences.slice(5, 8).map((sequence) => sequence.frameRefs)).toEqual([[], [], []]);
        expect(built?.sequences[8]?.frameRefs).toEqual([8]);
    });

    it("fills a target that stores the east with mirrored art", () => {
        const built = buildTargetFile(fileOf(1), [westBand(0)], IE_8_POINT_PAIRED);

        expect(built?.sequences.map((sequence) => sequence.frameRefs.length)).toEqual([1, 1, 1, 1, 1, 1, 1, 1]);
        // Mirrors are new frames appended to the file's own pool, not references to the western ones.
        expect(built?.frames).toHaveLength(8 + 3);
    });

    it("appends each band's mirrors to ONE pool", () => {
        // A pool per band would ship the file's frames several times over - the same duplication the
        // neutral model exists to avoid on the way in.
        const built = buildTargetFile(fileOf(3), [westBand(0), westBand(1), westBand(2)], IE_8_POINT_PAIRED);

        expect(built?.frames).toHaveLength(24 + 9);
        expect(built?.sequences).toHaveLength(24);
    });

    it("carries a band whose cycles are not facings through in its own order", () => {
        const ordered: NeutralAction = {
            label: "G1",
            action: decodeActionCode("cycle-numbers", "G1"),
            resrefs: ["MOGHG1"],
            band: 1,
            cycles: { kind: "ordered", sequenceIndices: [9, 8] },
        };

        const built = buildTargetFile(fileOf(2), [ordered], IE_8_POINT_MIRRORED);

        // No padding and no reordering: a target's direction slots mean nothing to cycles that are not
        // directions, so the band keeps the length and order the source gave it.
        expect(built?.sequences.map((sequence) => sequence.frameRefs)).toEqual([[9], [8]]);
    });

    it("carries a no-frame sentinel through a mirror instead of inventing art for it", () => {
        // A ref past the frame table is the "no frame" marker some files carry, and every layer here
        // already ignores it. Adopting it into the file's pool would put arbitrary art in that slot.
        const source = fileOf(1);
        source.sequences[0] = { frameRefs: [0, 99], facing: "none" };

        const built = buildTargetFile(source, [westBand(0)], IE_8_POINT_PAIRED);

        // Slot 0 is south, whose mirror is itself, so the sentinel survives on the slot that reads it.
        expect(built?.sequences[0]?.frameRefs).toEqual([0, 99]);
        expect(built?.frames.some((frame) => frame === undefined)).toBe(false);
    });

    it("keeps the source's palette and metadata", () => {
        const source = fileOf(1);
        const built = buildTargetFile(source, [westBand(0)], IE_8_POINT_MIRRORED);

        expect(built?.palette).toEqual(source.palette);
        expect(built?.meta.transparentIndex).toBe(0);
    });

    it("widens a band into a finer target's blocks", () => {
        const built = buildTargetFile(fileOf(1), [westBand(0)], IE_16_POINT_FULL);

        // Sixteen slots per block, and only the facings the eight-point source names are filled - the
        // half-steps between them are art nobody drew.
        expect(built?.sequences).toHaveLength(16);
        expect(built?.sequences.filter((sequence) => sequence.frameRefs.length > 0)).toHaveLength(8);
    });

    /**
     * The guard for a target profile nothing ships yet: blocks of cycles whose block size names no
     * direction order. Every offered target names one, so this is only reachable from a constructed
     * profile - and refusing beats laying a file out in an order nobody has stated.
     */
    it("refuses a block target whose block size names no direction order", () => {
        const unmodelled: ConversionTarget = { ...IE_8_POINT_MIRRORED, stride: undefined };

        expect(buildTargetFile(fileOf(1), [westBand(0)], unmodelled)).toBeUndefined();
    });

    /**
     * An FRM is not blocks of cycles: the file IS one action, and its six rotations are the whole of it.
     * So the target's stored facings are the slots, and there is no stride to pad them into.
     */
    it("lays a band into a rotation-per-slot target's six rotations", () => {
        const built = buildTargetFile(fileOf(1), [westBand(0)], FALLOUT_FRM);

        expect(built?.sequences).toHaveLength(6);
        // Fallout has no due-north or due-south rotation, so two of the eight-point band's facings have
        // nowhere to go; the six that remain are all drawn rather than padded.
        expect(built?.sequences.filter((sequence) => sequence.frameRefs.length > 0)).toHaveLength(6);
    });
});
