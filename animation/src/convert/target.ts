/**
 * What a conversion target can hold.
 *
 * The planner reads these before anything is written, which is what lets a conversion be refused or its
 * losses named up front rather than discovered in the output. Each profile states the two direction facts
 * separately, because they answer different questions: what the target STORES art for decides whether the
 * source's drawn facings survive, while what it SHOWS decides whether a facing exists there at all.
 */
import { type Facing, FRM_FACINGS, ieFacingsForStride, mirrorFacing } from "@bgforge/image";

export interface ConversionTarget {
    /** What a plan summary and the notes file call it. */
    label: string;
    /** Facings the target stores art for. The rest of `shown` are mirrored at playback. */
    stored: readonly Facing[];
    /** Facings the target's engine shows, stored and mirrored together. */
    shown: readonly Facing[];
    /**
     * How the target's files are shaped, and what serializes them.
     *
     * `ie-blocks` is a BAM whose cycles are blocks of `stride`, several actions to a file. `frm-rotations`
     * is a Fallout FRM: the file IS one action and its stored facings are the whole of its cycle list, so
     * `stride` says nothing about it.
     */
    files: "ie-blocks" | "frm-rotations";
    /**
     * How many cycles one direction block takes in the target's FILES, or undefined where the target's
     * files are not blocks of cycles at all.
     *
     * Distinct from the stored count, and the distinction is what a writer gets wrong: a scheme that stores
     * five facings still lays them out in eight-slot blocks, because the engine reads slot 5 of each block
     * as the first mirrored facing. A file packing five cycles per band would put the next band's art where
     * the east belongs.
     */
    stride: number | undefined;
    /**
     * Whether the target keeps the eastern facings in a companion file rather than in the member itself.
     *
     * A file-layout fact like `stride`, not an engine one: both eight-point profiles show eight facings, and
     * this is what says whether the eastern half lives in `<name>E` or is reflected at playback.
     */
    pairEast: boolean;
    /**
     * Whether the target fixes its own palette and remaps whatever it is given.
     *
     * A property of the format rather than of this source, so it is stated once and does not count as a
     * loss - the same call `LossReport` already makes for `palette-remapped-to-default`.
     */
    fixedPalette: boolean;
    /**
     * Whether the target's art already contains the weapon a figure is holding.
     *
     * The Infinity Engine draws a character weaponless and layers the weapon on from its own files, which
     * belong to the item rather than to any animation set - so a conversion has no weapon member to carry.
     * Fallout has no such layer: its critter art is drawn per weapon group, and a set converted from a
     * layered source is therefore an unarmed figure. Stated because nothing in the written files says it.
     */
    weaponsInArt: boolean;
    /**
     * How the target's engine is told the animation exists.
     *
     * `infinity-ids` is the `ANIMATE.IDS`/`ANISND.IDS` pair. `fallout-art-list` is the critter art list the
     * engine resolves a base name through before appending the two-letter code itself. `unmodelled` says
     * this tool does not know the target's declaration step - marked rather than omitted, because a notes
     * file that simply left the section out would read as "nothing to declare", which is a stronger claim
     * than has been checked.
     */
    declaration: "infinity-ids" | "fallout-art-list" | "unmodelled";
}

/**
 * The target's stored slots that art for `held` cannot fill, directly or by mirroring.
 *
 * ONE definition of "fillable", called with two different inputs: the planner asks per action with that
 * action's own facings, and the editor's menu asks per set with the facings its scheme stores, so that
 * what is offered and what is accepted cannot disagree.
 *
 * Mirroring counts as filling - the west arc reaching every eastern slot is the whole basis of the paired
 * target. A slot with neither its own art nor a mirror partner is skipped by the retarget, which leaves it
 * declared and empty rather than reporting anything, so the caller has to refuse it up front.
 */
export function unfillableSlots(target: ConversionTarget, held: readonly Facing[]): Facing[] {
    const have = new Set<Facing>(held);
    return target.stored.filter((slot) => !have.has(slot) && !have.has(mirrorFacing(slot)));
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
    files: "ie-blocks",
    stride: 8,
    pairEast: false,
    fixedPalette: false,
    weaponsInArt: false,
    declaration: "infinity-ids",
};

/** Eight-point, all eight stored: a base BAM plus the `*E` companion holding the eastern art. */
export const IE_8_POINT_PAIRED: ConversionTarget = {
    label: "Infinity Engine, 8 directions (east stored)",
    stored: IE_8,
    shown: IE_8,
    files: "ie-blocks",
    stride: 8,
    pairEast: true,
    fixedPalette: false,
    weaponsInArt: false,
    declaration: "infinity-ids",
};

/** Sixteen-point, nine stored: the west arc, with the eastern seven mirrored and no companion file. */
export const IE_16_POINT_MIRRORED: ConversionTarget = {
    label: "Infinity Engine, 16 directions (mirrored east)",
    stored: IE_9,
    shown: IE_16,
    files: "ie-blocks",
    stride: 9,
    pairEast: false,
    fixedPalette: false,
    weaponsInArt: false,
    declaration: "infinity-ids",
};

/** Sixteen-point, all sixteen stored - what the wide-band sections declare. */
export const IE_16_POINT_FULL: ConversionTarget = {
    label: "Infinity Engine, 16 directions (all stored)",
    stored: IE_16,
    shown: IE_16,
    files: "ie-blocks",
    stride: 16,
    pairEast: false,
    fixedPalette: false,
    weaponsInArt: false,
    declaration: "infinity-ids",
};

/**
 * The direction geometry each declared section's TYPE uses.
 *
 * The geometry is not a choice a writer gets to make: the engine reads a declared animation through its
 * type, and the type fixes how many facings are stored and whether the eastern ones sit in a companion
 * file. Offering the two as separate controls let a reader ask for a shape the declared section's engine
 * would never look for.
 *
 * Taken from the published documentation's own per-type orientation lists and confirmed against a shipped
 * install section by section: every section here stores what the documentation says, and holds an eastern
 * companion exactly where it says the east is not computed.
 *
 * Four sections are deliberately absent, and a caller refuses rather than guessing for them. The quadrant
 * family stores sixteen slots holding eight pictures; the wide sixteen-direction family spreads its sixteen
 * across a base and a companion - neither shape is one of the profiles above, which either store every
 * facing in the base or keep an eight-point west arc with a companion. The burrowing family states TWO
 * geometries chosen by a `mirror` field this project neither reads nor writes, so a conversion into it
 * could not declare which one it wrote. `effect` is not a directional family at all.
 */
const SECTION_GEOMETRY: Readonly<Record<string, ConversionTarget>> = {
    ambient: IE_8_POINT_PAIRED,
    ambient_static: IE_8_POINT_PAIRED,
    character: IE_16_POINT_MIRRORED,
    character_old: IE_8_POINT_PAIRED,
    flying: IE_16_POINT_MIRRORED,
    monster: IE_16_POINT_MIRRORED,
    monster_icewind: IE_8_POINT_PAIRED,
    monster_large: IE_8_POINT_PAIRED,
    monster_layered: IE_8_POINT_PAIRED,
    monster_layered_spell: IE_8_POINT_PAIRED,
    monster_old: IE_8_POINT_PAIRED,
    multi_new: IE_16_POINT_MIRRORED,
    town_static: IE_16_POINT_FULL,
};

/**
 * The geometry a set declared under `section` is written in, or undefined where this cannot say.
 *
 * Undefined is the answer for a section outside the table AND for an install's own header this project has
 * no spelling for - both are "nothing here states the shape", which a caller answers by keeping the set's
 * own rather than by picking one.
 */
export function targetForSection(section: string): ConversionTarget | undefined {
    return SECTION_GEOMETRY[section];
}

/** Fallout's six rotations, every one stored, against the game's own palette. */
export const FALLOUT_FRM: ConversionTarget = {
    label: "Fallout, 6 rotations",
    stored: FRM_FACINGS,
    shown: FRM_FACINGS,
    files: "frm-rotations",
    // An FRM holds one action per file, its rotations in place of blocks, so no block stride describes it.
    stride: undefined,
    pairEast: false,
    fixedPalette: true,
    weaponsInArt: true,
    declaration: "fallout-art-list",
};
