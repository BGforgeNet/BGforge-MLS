/**
 * The character scheme: which file a set draws for a given armour level and action.
 *
 * A name is `<prefix><armour><action>`, and the prefix is the one the set declares FOR THAT LEVEL - the
 * fourth letter is an armour-family letter, so one set draws `CDMB1..3` and `CDMC4`. The inventory image is
 * the exception twice over: it takes the set's paperdoll prefix rather than its body one, so an aliasing set
 * keeps its own.
 *
 * Deliberately no cycle here. Which stored cycle is which facing is a property of the frames, not of the
 * name - `image/src/model/ie-direction.ts` detects it from the parsed animation, and a table here would be a
 * second derivation of a fact that module already owns.
 */
import { type AnimationSet } from "../animation-index";
import { type IeGroup, ieBlocks } from "../group-labels";

/** The character family bands at nine cycles - the sixteen-point scheme's stored western arc. */
const CHARACTER_SCHEME = "ie9";

export type Action =
    /** `A1`..`A9` - grip and weapon vary by number. */
    | { kind: "attack"; detail: number }
    /** `CA`. */
    | { kind: "cast" }
    /** `G1`, then `G11`..`G19`. */
    | { kind: "misc"; detail: number }
    /** `SA` bow, `SS` sling, `SX` crossbow. */
    | { kind: "shoot"; weapon: "bow" | "sling" | "crossbow" }
    /** `INV` - the inventory paperdoll, drawn from its own prefix. */
    | { kind: "paperdoll" };

const SHOT: Record<"bow" | "sling" | "crossbow", string> = { bow: "A", sling: "S", crossbow: "X" };

/**
 * The trailing characters that name an action within one armour level.
 *
 * Exported because the same characters are what says WHAT the action depicts: the naming tables decode
 * `A5` into a thrust, and a caller that re-derived the code from a label would be reading prose.
 */
export function characterActionCode(action: Action): string {
    switch (action.kind) {
        case "attack":
            return `A${action.detail}`;
        case "cast":
            return "CA";
        case "misc":
            return `G${action.detail}`;
        case "shoot":
            return `S${SHOT[action.weapon]}`;
        case "paperdoll":
            return "INV";
    }
}

/**
 * The prefixes one level's files may be named under, the level's own first and the set's base one after.
 *
 * A character set declares two, and which of them holds a given action's file varies BY FILE rather than by
 * level: a classic archive puts the thief body's leather level under the class prefix and its other levels
 * under the base one, so a resolver that took one prefix per level draws nothing at three levels in four.
 * Both reference implementations resolve per file, and so does this.
 *
 * The order is theirs rather than load-bearing: measured on an Enhanced install, across 160 armour levels
 * of sets declaring two distinct prefixes, none has a file under both - so no shipped level can tell the
 * two orders apart.
 */
function prefixesAt(set: AnimationSet, armour: number): string[] {
    const own = set.prefixByArmour.get(armour);
    if (own === undefined) return [];
    const base = set.basePrefix;
    return base === undefined || base === own ? [own] : [own, base];
}

/**
 * The resref this set draws for one armour level and action, or undefined when it has no such member.
 *
 * `exists` picks between the level's two candidate prefixes. Where neither answers, the level's own name is
 * returned rather than nothing: a caller naming a file to CREATE wants the set's own answer, and a caller
 * asking what to OPEN filters on existence anyway.
 */
export function characterMember(
    set: AnimationSet,
    armour: number,
    action: Action,
    exists: (resref: string) => boolean,
): string | undefined {
    const code = characterActionCode(action);
    if (action.kind === "paperdoll") {
        // The paperdoll is keyed by its own prefix AND still by armour level, so a set with no paperdoll
        // declaration has no inventory image rather than borrowing the body's. One prefix, not two: the
        // base/specific split is a property of the body art.
        if (set.paperdollPrefix === undefined || !set.prefixByArmour.has(armour)) return undefined;
        return `${set.paperdollPrefix}${armour}${code}`;
    }
    const names = prefixesAt(set, armour).map((prefix) => `${prefix}${armour}${code}`);
    return names.find((name) => exists(name)) ?? names[0];
}

/** Every action the scheme can name, in the order a picker should offer them. */
const CANDIDATES: Action[] = [
    { kind: "misc", detail: 1 },
    ...Array.from({ length: 9 }, (_, index) => ({ kind: "attack", detail: index + 1 }) as const),
    { kind: "cast" },
    ...(["bow", "sling", "crossbow"] as const).map((weapon) => ({ kind: "shoot", weapon }) as const),
    ...Array.from({ length: 9 }, (_, index) => ({ kind: "misc", detail: 11 + index }) as const),
    { kind: "paperdoll" },
];

/**
 * The actions this set actually ships at one armour level.
 *
 * Decided against the files rather than against a table: which actions a set has varies per set, and a
 * picker offering one the install lacks would resolve to a name nothing can open.
 */
export function characterActions(set: AnimationSet, armour: number, exists: (resref: string) => boolean): Action[] {
    return CANDIDATES.filter((action) => {
        const resref = characterMember(set, armour, action, exists);
        return resref !== undefined && exists(resref);
    });
}

/**
 * The band skeleton one character file carries, and where its own action's art sits in it.
 *
 * The engine reads a band by its POSITION, so this is a writer's fact, not a reader's: a file holding only
 * the band it draws would play the walk where the stance belongs.
 */
export interface CharacterFileLayout {
    /** Direction bands the file holds, drawn or empty. */
    bands: number;
    /** Which of them this file's own action draws. */
    at: number;
}

/**
 * Where each misc file's art sits in the eleven-band skeleton they all carry.
 *
 * Measured per file across a classic and an Enhanced install: every `G` file holds the same eleven bands and
 * draws the one its digit names, so the digit is a position in that list rather than a sequence code. The
 * hit-and-death files draw a second band as well - the engine continues one into the next - and a converted
 * source has only the one action, so each is written at its own band alone.
 */
const MISC_BAND: Readonly<Record<string, number>> = {
    G11: 0,
    G1: 1,
    G12: 2,
    G13: 3,
    G14: 4,
    G15: 5,
    G16: 6,
    G17: 7,
    G18: 8,
    G19: 9,
};

/** Bands in a misc file, and in a cast file - the four conjure and release pairs. */
const MISC_BANDS = 11;
const CAST_BANDS = 8;
/** The release half of the first spell: what a source that names one spell action is written as. */
const CAST_BAND = 1;

/**
 * Which band of the shared skeleton the file naming `code` is FOR, where it shares one.
 *
 * Only the misc files do: ten of them carry the same eleven bands and the digit picks one. Undefined for
 * every other code, the cast file included - its eight bands are eight different clips that no sibling
 * carries, so all of them are its own.
 */
export function characterOwnBand(code: string): number | undefined {
    return MISC_BAND[code];
}

/** How the file naming `code` is laid out. Anything the skeletons do not cover is a single band. */
export function characterFileLayout(code: string): CharacterFileLayout {
    const misc = MISC_BAND[code];
    if (misc !== undefined) return { bands: MISC_BANDS, at: misc };
    return code === "CA" ? { bands: CAST_BANDS, at: CAST_BAND } : { bands: 1, at: 0 };
}

/**
 * What a misc file depicts, from the block its art sits in.
 *
 * Read from the block table rather than restated here: the same eleven blocks are what a picker lists for a
 * packed file, so a second set of words for them would be two names for one thing. Undefined for a code the
 * family's open space carries and the table does not name.
 */
export function characterMiscBlock(detail: number): IeGroup | undefined {
    const at = MISC_BAND[`G${detail}`];
    return at === undefined ? undefined : ieBlocks("g1", CHARACTER_SCHEME, MISC_BANDS)?.[at];
}

/**
 * Whether the archive holds this set's BODY at any of its armour levels.
 *
 * The paperdoll is excluded deliberately: it is keyed by its own prefix, so a set whose body the archive
 * lacks still answers on its inventory image alone. That is what makes this the question to ask of a vendored
 * table - does the install actually have what the row names - rather than "has it anything at all".
 */
export function characterDrawsBody(set: AnimationSet, exists: (resref: string) => boolean): boolean {
    return [...set.prefixByArmour.keys()].some((armour) =>
        characterActions(set, armour, exists).some((action) => action.kind !== "paperdoll"),
    );
}
