/**
 * Narrowing the animation list by what a set IS.
 *
 * Filters, not a resolver: each control says "only these", never "this exact one", so every combination
 * has an answer and the list is what carries the choice. A family the corpus declares nothing for - class
 * in a Fallout install, where a critter has no class at all - is not a control the reader can act on, so
 * it is offered fixed at ANY rather than as an empty dropdown.
 */
// The label table's own entry, not the barrel: the barrel reaches Node-only codecs, which a webview bundle
// cannot build against.
import { facetLabel } from "@bgforge/animation/facet-labels";
import type { SetTile } from "./messages";

/** Not a real facet value, and cannot collide with one: every value the tables decode is a plain word. */
export const ANY = "any";

export type FilterFamily = "race" | "gender" | "charClass";

export const FILTER_FAMILIES: readonly { family: FilterFamily; label: string }[] = [
    { family: "race", label: "Race" },
    { family: "gender", label: "Gender" },
    { family: "charClass", label: "Class" },
];

export type FilterSelection = Record<FilterFamily, string>;

export const ANY_SELECTION: FilterSelection = { race: ANY, gender: ANY, charClass: ANY };

export interface FilterControl {
    family: FilterFamily;
    label: string;
    /** ANY first, then every value the corpus offers under the OTHER filters, sorted. */
    options: { value: string; label: string }[];
    /** The value in force - the reader's, or ANY where theirs is not on offer any more. */
    value: string;
    /** False where nothing in this corpus declares the family: the control is shown fixed at ANY. */
    applicable: boolean;
}

function matches(tile: SetTile, selection: FilterSelection, except?: FilterFamily): boolean {
    return FILTER_FAMILIES.every(({ family }) => {
        const wanted = selection[family];
        if (family === except || wanted === ANY) return true;
        return tile.facets?.[family] === wanted;
    });
}

/**
 * The controls to draw, resolved against the corpus.
 *
 * A family's options come from the sets the OTHER filters leave, so narrowing never offers a choice that
 * would empty the list - and a value that stops being on offer falls back to ANY rather than silently
 * filtering everything away.
 */
export function filterControls(sets: readonly SetTile[], selection: FilterSelection): FilterControl[] {
    return FILTER_FAMILIES.map(({ family, label }) => {
        const values: string[] = [
            ...new Set(
                sets
                    .filter((tile) => matches(tile, selection, family))
                    .flatMap((tile): string[] => (tile.facets === undefined ? [] : [tile.facets[family]])),
            ),
        ];
        const applicable = sets.some((tile) => tile.facets !== undefined);
        return {
            family,
            label,
            // Labelled by the animation package's own table, the one home for how a facet value is spelled
            // for a reader - the tables' `halforc` is "Half-orc" there and nowhere else.
            options: [
                { value: ANY, label: "Any" },
                ...values.sort().map((value) => ({ value, label: facetLabel(value) })),
            ],
            value: applicable && values.includes(selection[family]) ? selection[family] : ANY,
            applicable,
        };
    });
}

/** The sets these filters leave. Every set with all filters at ANY, which is where a panel opens. */
export function filterSets(sets: readonly SetTile[], selection: FilterSelection): SetTile[] {
    return sets.filter((tile) => matches(tile, selection));
}
