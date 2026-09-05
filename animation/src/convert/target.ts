/**
 * What a conversion target can hold.
 *
 * The planner reads these before anything is written, which is what lets a conversion be refused or its
 * losses named up front rather than discovered in the output. Each profile states the two direction facts
 * separately, because they answer different questions: what the target STORES art for decides whether the
 * source's drawn facings survive, while what it SHOWS decides whether a facing exists there at all.
 */
import { type Facing, FRM_FACINGS, ieFacingsForStride } from "@bgforge/image";

export interface ConversionTarget {
    /** What a plan summary and the notes file call it. */
    label: string;
    /** Facings the target stores art for. The rest of `shown` are mirrored at playback. */
    stored: readonly Facing[];
    /** Facings the target's engine shows, stored and mirrored together. */
    shown: readonly Facing[];
    /**
     * Whether the target fixes its own palette and remaps whatever it is given.
     *
     * A property of the format rather than of this source, so it is stated once and does not count as a
     * loss - the same call `LossReport` already makes for `palette-remapped-to-default`.
     */
    fixedPalette: boolean;
}

const IE_8 = ieFacingsForStride(8);
const IE_16 = ieFacingsForStride(16);
/** The stored half of the finer scheme: nine cycles from due south round to due north. */
const IE_9 = ieFacingsForStride(9);

/** Eight-point, five stored: one BAM whose eastern facings the engine reflects. */
export const IE_8_POINT_MIRRORED: ConversionTarget = {
    label: "Infinity Engine, 8 directions (mirrored east)",
    stored: IE_8.slice(0, 5),
    shown: IE_8,
    fixedPalette: false,
};

/** Eight-point, all eight stored: a base BAM plus the `*E` companion holding the eastern art. */
export const IE_8_POINT_PAIRED: ConversionTarget = {
    label: "Infinity Engine, 8 directions (east stored)",
    stored: IE_8,
    shown: IE_8,
    fixedPalette: false,
};

/** Sixteen-point, nine stored: the west arc, with the eastern seven mirrored and no companion file. */
export const IE_16_POINT_MIRRORED: ConversionTarget = {
    label: "Infinity Engine, 16 directions (mirrored east)",
    stored: IE_9,
    shown: IE_16,
    fixedPalette: false,
};

/** Sixteen-point, all sixteen stored - what the wide-band sections declare. */
export const IE_16_POINT_FULL: ConversionTarget = {
    label: "Infinity Engine, 16 directions (all stored)",
    stored: IE_16,
    shown: IE_16,
    fixedPalette: false,
};

/** Fallout's six rotations, every one stored, against the game's own palette. */
export const FALLOUT_FRM: ConversionTarget = {
    label: "Fallout, 6 rotations",
    stored: FRM_FACINGS,
    shown: FRM_FACINGS,
    fixedPalette: true,
};
