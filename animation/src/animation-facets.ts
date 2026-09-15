/**
 * What a character animation's id says about the creature it draws.
 *
 * The id is a bitfield, and it is the ONLY place these facets are declared. The animation's four-letter
 * code cannot stand in: its fourth letter is an armour-family letter rather than a class code (one cleric
 * set draws `CHMB` at the low levels and `CHMC` at the top), and a table's comment column is prose that
 * differs between installs.
 *
 * Nothing in the editor reads this yet. It is kept deliberately, as the decode the set picker's race,
 * gender and class filters are to be built on, and its corpus test is what pins the bitfield against the
 * install's own comment column. `AnimationSet` used to carry the decoded facets on every set, which read
 * as a consumer and was not one - so the field went and this stayed.
 */

export type Race = "human" | "elf" | "dwarf" | "halfling" | "gnome" | "halforc";
export type Gender = "male" | "female";
export type CharClass = "cleric" | "fighter" | "mage" | "thief" | "monk";

export interface CharacterFacets {
    race: Race;
    gender: Gender;
    charClass: CharClass;
}

/** Low nibble. Gnome and half-orc appear only in the second generation, but decode the same way in both. */
const RACES: Record<number, Race> = {
    0: "human",
    1: "elf",
    2: "dwarf",
    3: "halfling",
    4: "gnome",
    5: "halforc",
};

const GENDERS: Record<number, Gender> = { 0: "male", 1: "female" };

/**
 * Third nibble - and it is NOT dense.
 *
 * 4 is missing on purpose: that block is named individuals and single monsters (one of them called MONK
 * without being the monk class), so an id there carries no facets at all. Monk is 5.
 */
const CLASSES: Record<number, CharClass> = {
    0: "cleric",
    1: "fighter",
    2: "mage",
    3: "thief",
    5: "monk",
};

/** The two generations of character animation ids. */
const GENERATIONS = new Set([0x5000, 0x6000]);

/**
 * The facets this id declares, or undefined when it declares none.
 *
 * Partial by design: it answers for the character blocks and nothing else, so a caller distinguishes "a
 * set with no facets" - a monster, a named individual - from a failure to decode.
 */
export function characterFacetsOf(animationId: number): CharacterFacets | undefined {
    if (!GENERATIONS.has(animationId & 0xf000)) return undefined;
    const race = RACES[animationId & 0xf];
    const gender = GENDERS[(animationId >> 4) & 0xf];
    const charClass = CLASSES[(animationId >> 8) & 0xf];
    if (race === undefined || gender === undefined || charClass === undefined) return undefined;
    return { race, gender, charClass };
}

/** The id carrying these facets in `generation` (`0x5000` or `0x6000`). Inverse of `characterFacetsOf`. */
export function characterIdFor(facets: CharacterFacets, generation: number): number {
    const race = Number(Object.keys(RACES).find((key) => RACES[Number(key)] === facets.race));
    const gender = Number(Object.keys(GENDERS).find((key) => GENDERS[Number(key)] === facets.gender));
    const charClass = Number(Object.keys(CLASSES).find((key) => CLASSES[Number(key)] === facets.charClass));
    return generation | (charClass << 8) | (gender << 4) | race;
}
