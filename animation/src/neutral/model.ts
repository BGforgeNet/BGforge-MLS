/**
 * A game-neutral reading of one animation set.
 *
 * The shape is chosen so that reading a set and writing it back to the same game LOSES NOTHING - every
 * frame, cycle reference, palette entry and placement survives, over every animation a real install ships.
 * That is what makes any later claim about conversion quality checkable: a converter's losses are the ones
 * it reports, because the model itself has none. The bytes are not always identical (a re-emitted file is
 * laid out canonically where the shipped one shared data blocks between frames), which is why the gate in
 * `animation/test/neutral-round-trip.test.ts` requires content equality and only reports byte equality.
 *
 * Two decisions carry that:
 *
 * - **A member never owns pixels.** It names its files, and each file keeps the `Animation` it parsed to -
 *   frame pool, palette, metadata and the verbatim on-disk payloads (`rawEncoding`, `sourceBytes`,
 *   `sourcePages`) the image library already carries for exactly this purpose. A model that copied frames
 *   into directions would drop the pool, and cycles share frames heavily in shipped files, so a re-emitted
 *   file would carry several times the frames it was read with.
 * - **The interpretation is a separate layer.** Which stored cycle is which facing is what the games
 *   disagree about; the pixels are what they agree about. So `NeutralCycles` indexes into the parsed
 *   animation rather than restructuring it.
 *
 * Conversion reads this model and BUILDS a new animation for the target; it never mutates what was read.
 */
import { type Animation, type Facing } from "@bgforge/image";
import { type NeutralActionRef } from "../animation-schemes/actions";

/** What an install said this animation is, kept as read. */
export interface NeutralIdentity {
    /** The source game's animation id. A converted set's target id is chosen at write time, not here. */
    sourceId: number;
    /** `ANISND.IDS`'s code, or "" where it names none. */
    code: string;
    /** `ANIMATE.IDS`'s name, or "" where it names none. */
    name: string;
    /** The flavour the set was read from - "tob", "bgee", ... */
    sourceFlavour: string;
    /**
     * The section the install declared, verbatim. Absent where nothing declared one.
     *
     * Load-bearing rather than descriptive: it is the only field that separates `character` from
     * `character_old`, and a writer has to name a section in the target's own declaration.
     */
    sourceSection: string | undefined;
}

/**
 * One armour level's worth of the set, or the whole set for a scheme that has no armour levels.
 *
 * `files` is parsed once per resref and shared by every action that draws it: a `G1` file packs several
 * actions as consecutive bands, so parsing per action would parse the same file many times over.
 */
export interface NeutralVariant {
    /** The armour level, or undefined for a scheme that does not vary by one. */
    armour: number | undefined;
    files: ReadonlyMap<string, Animation>;
    actions: readonly NeutralAction[];
}

/**
 * One action, as one direction band.
 *
 * A band is the unit a target game has to be given: one action stored as consecutive cycles, one per
 * facing. Where that band lives varies - an action-code scheme gives each its own file, a `G` file packs
 * several - and both arrive here the same way.
 */
export interface NeutralAction {
    /** What the source called it, for display and for the notes file. */
    label: string;
    /**
     * What it depicts, in the vocabulary neither game owns, plus the code its own scheme named it by.
     *
     * The whole reason the model holds this rather than the code alone: a target scheme has to be asked
     * for its own name for the same meaning, and the codes collide across schemes - `A4` is a ranged
     * attack in one family and a two-handed backslash in another.
     */
    action: NeutralActionRef;
    /** Every file this action draws, the one it is named by first. */
    resrefs: readonly string[];
    /** Which band of those files, counting from zero. */
    band: number;
    /**
     * Set where the source draws this action by running its band BACKWARDS.
     *
     * Part of what the action DEPICTS, not a playback preference: a get-up sharing the dying band is the
     * death reversed, and every target that can name a get-up gives it a file of its own played forwards.
     * A target therefore has to be handed the frames in reverse, or it stores a second death under the
     * get-up's name - wrong in the target game, with every count and label in the report reading correct.
     */
    reversed?: true;
    cycles: NeutralCycles;
}

/**
 * Directional and non-directional members are different shapes, not one shape with a null facing.
 *
 * The majority of what an install ships is non-directional - every `bare` and `cycles` section - and its
 * cycles are an ordered list rather than a direction map. Folding both into one shape would either collide
 * every cycle on a single "none" facing or invent a facing the file does not have.
 */
export type NeutralCycles =
    | { kind: "directional"; directions: readonly NeutralDirection[] }
    | { kind: "ordered"; sequenceIndices: readonly number[] };

/**
 * One facing this action STORES art for.
 *
 * Facings the source scheme mirrors at runtime are absent, not padded: a file storing the western arc has
 * five directions here, not eight with three blanks. That absence is the fact a conversion needs - a
 * target that stores all eight can generate the mirrors losslessly, while a source that stores all eight
 * going to a target that mirrors is discarding drawn art.
 */
export interface NeutralDirection {
    facing: Facing;
    /** Index into each drawing file's `sequences`. The files share a cycle table, so one index addresses
     *  the same moment in every one of them. */
    sequenceIndex: number;
}

export interface NeutralSet {
    identity: NeutralIdentity;
    variants: readonly NeutralVariant[];
}
