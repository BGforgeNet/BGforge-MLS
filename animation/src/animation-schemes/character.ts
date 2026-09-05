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

/** The trailing characters that name an action within one armour level. */
function suffixOf(action: Action): string {
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

/** The resref this set draws for one armour level and action, or undefined when it has no such member. */
export function characterMember(set: AnimationSet, armour: number, action: Action): string | undefined {
    if (action.kind === "paperdoll") {
        // The paperdoll is keyed by its own prefix AND still by armour level, so a set with no paperdoll
        // declaration has no inventory image rather than borrowing the body's.
        if (set.paperdollPrefix === undefined || !set.prefixByArmour.has(armour)) return undefined;
        return `${set.paperdollPrefix}${armour}INV`;
    }
    const prefix = set.prefixByArmour.get(armour);
    return prefix === undefined ? undefined : `${prefix}${armour}${suffixOf(action)}`;
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
        const resref = characterMember(set, armour, action);
        return resref !== undefined && exists(resref);
    });
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
