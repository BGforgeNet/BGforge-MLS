/**
 * The facet browser's state, built host-side and sent whole to the webview.
 *
 * One function rather than a message per control: every control's options depend on what the others are
 * set to, so answering them one at a time would let the view hold a combination that never existed. This
 * also keeps the "which files exist" question on the side that can see the archive.
 */
import { type AnimationSet } from "../ie-resources/animation-index";
import { type CharClass, type CharacterFacets, type Gender, type Race } from "../ie-resources/animation-facets";
import { type Action } from "../ie-resources/animation-schemes/character";
import {
    CLASSES,
    GENDERS,
    RACES,
    actionLabel,
    armourLabel,
    armourLevels,
    facetChoices,
    facetIndex,
    resolveFacets,
    setForFacets,
} from "./facet-browser";
import { type FacetFamily, type FacetOption, type FacetState } from "./webview/messages";

/** What the browser is currently pointed at. Actions are keyed by their label, which is what the view sends. */
export interface FacetSelection extends CharacterFacets {
    armour: number;
    action: Action;
}

export const DEFAULT_SELECTION: FacetSelection = {
    race: "human",
    gender: "male",
    charClass: "fighter",
    armour: 1,
    action: { kind: "misc", detail: 1 },
};

function option(value: string, label: string, available: boolean, reason?: string): FacetOption {
    return { value, label, available, ...(reason === undefined ? {} : { reason }) };
}

/**
 * Move one control, keeping the rest of the selection valid.
 *
 * A race change can land on a set with fewer armour levels or a different action list, so the armour and
 * action are re-seated rather than carried over blindly - otherwise the view would show a selection whose
 * file does not exist and blame the game for it.
 */
export function selectFacet(
    index: ReadonlyMap<string, AnimationSet>,
    current: FacetSelection,
    family: FacetFamily,
    value: string,
    exists: (resref: string) => boolean,
): FacetSelection {
    const next: FacetSelection = { ...current };
    if (family === "armour") next.armour = Number(value);
    else if (family === "action") next.action = actionFromLabel(index, current, exists, value) ?? current.action;
    else if (family === "race") next.race = value as Race;
    else if (family === "gender") next.gender = value as Gender;
    else next.charClass = value as CharClass;

    const set = setForFacets(index, next);
    const levels = armourLevels(set);
    if (levels.length > 0 && !levels.includes(next.armour)) next.armour = levels[0]!;
    const actions = set === undefined ? [] : resolveFacets(index, next, next.armour, next.action, exists).actions;
    if (actions.length > 0 && !actions.some((action) => actionLabel(action) === actionLabel(next.action))) {
        next.action = actions[0]!;
    }
    return next;
}

function actionFromLabel(
    index: ReadonlyMap<string, AnimationSet>,
    selection: FacetSelection,
    exists: (resref: string) => boolean,
    label: string,
): Action | undefined {
    const { actions } = resolveFacets(index, selection, selection.armour, selection.action, exists);
    return actions.find((action) => actionLabel(action) === label);
}

/** The whole browser state for one selection. */
export function facetState(
    index: ReadonlyMap<string, AnimationSet>,
    selection: FacetSelection,
    exists: (resref: string) => boolean,
): FacetState {
    const resolved = resolveFacets(index, selection, selection.armour, selection.action, exists);
    const levels = armourLevels(resolved.set);
    return {
        selection: {
            race: selection.race,
            gender: selection.gender,
            charClass: selection.charClass,
            armour: selection.armour,
            action: actionLabel(selection.action),
        },
        races: facetChoices("race", RACES, index, selection).map((choice) =>
            option(choice.value, choice.label, choice.available, choice.reason),
        ),
        genders: facetChoices("gender", GENDERS, index, selection).map((choice) =>
            option(choice.value, choice.label, choice.available, choice.reason),
        ),
        classes: facetChoices("charClass", CLASSES, index, selection).map((choice) =>
            option(choice.value, choice.label, choice.available, choice.reason),
        ),
        // Armour levels come from the resolved set, so they are always available - a level the set lacks is
        // not offered at all, because it is not a property of the game the reader could act on.
        armours: levels.map((level) => option(String(level), armourLabel(level), true)),
        actions: resolved.actions.map((action) => option(actionLabel(action), actionLabel(action), true)),
        resref: resolved.resref,
        unavailable: resolved.unavailable,
    };
}

/**
 * A browser bound to one open game.
 *
 * The panel holds the selection and nothing else: the index and the "does this file exist" check are bound
 * once here, so answering a control change costs a lookup rather than a rebuild, and the panel never has to
 * know how a facet becomes a file.
 */
export interface FacetBrowser {
    state(selection: FacetSelection): FacetState;
    select(selection: FacetSelection, family: FacetFamily, value: string): FacetSelection;
    /**
     * The selection pointing at one animation id - what a link from a creature's animation field lands on.
     *
     * Undefined for an id carrying no facets: a monster or a named individual is a real animation the list
     * still shows, but there is no race/gender/class combination that reaches it, so the browser leaves its
     * controls where they were rather than moving them somewhere unrelated.
     */
    seat(id: number): FacetSelection | undefined;
}

export function createFacetBrowser(sets: readonly AnimationSet[], exists: (resref: string) => boolean): FacetBrowser {
    const index = facetIndex(sets);
    const byId = new Map(sets.map((set) => [set.id, set]));
    return {
        state: (selection) => facetState(index, selection, exists),
        select: (selection, family, value) => selectFacet(index, selection, family, value, exists),
        seat: (id) => {
            const set = byId.get(id);
            if (set?.facets === undefined) return;
            // Through `select` rather than assembled here, so a seated selection is re-seated by the same
            // rules a user's own click would apply - the armour level the set has, an action it ships.
            const level = armourLevels(set)[0] ?? DEFAULT_SELECTION.armour;
            const from: FacetSelection = { ...DEFAULT_SELECTION, ...set.facets };
            return selectFacet(index, from, "armour", String(level), exists);
        },
    };
}
