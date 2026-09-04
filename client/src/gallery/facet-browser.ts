/**
 * Browsing the animation space by facet.
 *
 * The shape that decides this UI: for a character animation, race / gender / class select a DIFFERENT
 * animation id, while armour and action select a file WITHIN one id. So this is not a set view with
 * controls on it - it is a browser over the whole space, where some controls re-resolve the id and others
 * re-resolve the file.
 *
 * Availability is decided against resolved member FILES rather than against a table's rows: a table can
 * name a combination the install has no files for, and another table can name one the first omits.
 */
import { type AnimationSet } from "../ie-resources/animation-index";
import { type CharClass, type CharacterFacets, type Gender, type Race } from "../ie-resources/animation-facets";
import { type Action, characterActions, characterMember } from "../ie-resources/animation-schemes/character";

export const RACES: readonly Race[] = ["human", "elf", "dwarf", "halfling", "gnome", "halforc"];
export const GENDERS: readonly Gender[] = ["male", "female"];
export const CLASSES: readonly CharClass[] = ["cleric", "fighter", "mage", "thief", "monk"];

/** One option of a facet control. An unavailable option is shown disabled WITH its reason, never hidden. */
export interface FacetChoice<T> {
    value: T;
    label: string;
    available: boolean;
    /** Why this option cannot be picked. Present only when unavailable. */
    reason?: string;
}

const TITLES: Record<string, string> = {
    human: "Human",
    elf: "Elf",
    dwarf: "Dwarf",
    halfling: "Halfling",
    gnome: "Gnome",
    halforc: "Half-orc",
    male: "Male",
    female: "Female",
    cleric: "Cleric",
    fighter: "Fighter",
    mage: "Mage",
    thief: "Thief",
    monk: "Monk",
};

export function facetLabel(value: string): string {
    return TITLES[value] ?? value;
}

/** The character sets of an index, by the facets they carry. */
export function facetIndex(sets: readonly AnimationSet[]): Map<string, AnimationSet> {
    const byFacets = new Map<string, AnimationSet>();
    for (const set of sets) {
        if (set.facets === undefined || set.scheme.kind !== "character") continue;
        // First wins: the two generations carry the same facets, and the later one is the fuller set.
        const key = facetKey(set.facets);
        if (!byFacets.has(key)) byFacets.set(key, set);
    }
    return byFacets;
}

export function facetKey(facets: CharacterFacets): string {
    return `${facets.race}/${facets.gender}/${facets.charClass}`;
}

/** The set carrying these facets, or undefined when the open game has none. */
export function setForFacets(
    index: ReadonlyMap<string, AnimationSet>,
    facets: CharacterFacets,
): AnimationSet | undefined {
    return index.get(facetKey(facets));
}

/**
 * The options of one facet family, given what the other families are set to.
 *
 * Each option is checked by swapping it into the current selection and asking whether that whole
 * combination resolves - which is why changing race can disable a class, and why the reason names the
 * combination rather than the option alone.
 */
export function facetChoices<T extends string>(
    family: "race" | "gender" | "charClass",
    values: readonly T[],
    index: ReadonlyMap<string, AnimationSet>,
    selection: CharacterFacets,
): FacetChoice<T>[] {
    return values.map((value) => {
        const candidate = { ...selection, [family]: value } as CharacterFacets;
        const available = index.has(facetKey(candidate));
        return {
            value,
            label: facetLabel(value),
            available,
            ...(available ? {} : { reason: `This game has no ${describe(candidate)} animation` }),
        };
    });
}

function describe(facets: CharacterFacets): string {
    return `${facetLabel(facets.race)} ${facetLabel(facets.gender)} ${facetLabel(facets.charClass)}`.toLowerCase();
}

/** The armour levels a set draws, lowest first. */
export function armourLevels(set: AnimationSet | undefined): number[] {
    return set === undefined ? [] : [...set.prefixByArmour.keys()].sort((a, b) => a - b);
}

export const ARMOUR_LABELS: Record<number, string> = {
    1: "None",
    2: "Leather",
    3: "Robe",
    4: "Plate",
};

export function armourLabel(level: number): string {
    return ARMOUR_LABELS[level] ?? `Level ${level}`;
}

export function actionLabel(action: Action): string {
    switch (action.kind) {
        case "attack":
            return `Attack ${action.detail}`;
        case "cast":
            return "Cast";
        case "misc":
            return action.detail === 1 ? "Stand" : `Misc ${action.detail}`;
        case "shoot":
            return `Shoot (${action.weapon})`;
        case "paperdoll":
            return "Inventory";
    }
}

/** What the browser currently resolves to: the set, the file, and why there is no file when there is none. */
export interface FacetResolution {
    set: AnimationSet | undefined;
    resref: string | undefined;
    actions: Action[];
    unavailable: string | undefined;
}

export function resolveFacets(
    index: ReadonlyMap<string, AnimationSet>,
    facets: CharacterFacets,
    armour: number,
    action: Action,
    exists: (resref: string) => boolean,
): FacetResolution {
    const set = setForFacets(index, facets);
    if (set === undefined) {
        return { set, resref: undefined, actions: [], unavailable: `This game has no ${describe(facets)} animation` };
    }
    const actions = characterActions(set, armour, exists);
    const resref = characterMember(set, armour, action);
    if (resref === undefined || !exists(resref)) {
        return {
            set,
            resref: undefined,
            actions,
            unavailable: `${set.name || set.code} has no ${actionLabel(action).toLowerCase()} at ${armourLabel(
                armour,
            ).toLowerCase()}`,
        };
    }
    return { set, resref, actions, unavailable: undefined };
}
