/**
 * What an action DEPICTS, as a term neither game owns, plus the per-scheme tables that name it.
 *
 * A conversion has to answer "which file of the target holds this action", and the schemes name the same
 * few things differently: `A4` is a two-handed backslash in the character scheme and a ranged attack in the
 * two-letter one. So a code is decoded into a neutral term on the way in and re-encoded on the way out;
 * a code is never carried across schemes uninterpreted.
 *
 * The tables are DATA, taken from the published naming documentation (IESDP avatarnaming.htm) rather than
 * read out of the codes themselves. Where that documentation marks a meaning uncertain, the entry is absent
 * and the code decodes as `unpinned`: it still round-trips within its own scheme, and it refuses to travel
 * to another one, which is the honest answer for a name nobody has pinned down.
 */

/**
 * How a scheme names its actions.
 *
 * `cycle-numbers` covers the layouts whose members are bare `G<n>` files. The documentation lists meanings
 * for those with a question mark against nearly every row, so the family has no table at all rather than a
 * table of guesses.
 *
 * Infinity Engine families only, because those are the ones a set can be READ from today - Fallout's critter
 * naming joins this union when the reader can produce a member from an FRM.
 */
export type ActionScheme = "character" | "action-codes" | "cycle-numbers";

/**
 * The neutral vocabulary.
 *
 * Deliberately coarse. `spell` covers both spell codes because the published naming and the engine's own
 * playback order invert build-up against release, and shipping one reading of that as fact would file a
 * cast under a code that plays it at the wrong moment. `unpinned` is a term in its own right: it says the
 * source named something this vocabulary refuses to guess at.
 */
export type NeutralActionId =
    | "walk"
    | "stand"
    | "ready"
    | "attack"
    | "shoot"
    | "spell"
    | "get-hit"
    | "die"
    | "twitch"
    | "get-up"
    | "sleep"
    | "paperdoll"
    | "unpinned";

/** One action, as read from a scheme: what it depicts, and the code that named it there. */
export interface NeutralActionRef {
    scheme: ActionScheme;
    id: NeutralActionId;
    /** The scheme's own code, kept verbatim - what a same-scheme write puts back. */
    code: string;
    /** The grip or weapon the code's own name pins, where it pins one. */
    detail?: string;
}

interface ActionEntry {
    code: string;
    id: NeutralActionId;
    detail?: string;
}

/**
 * `<race><gender><class><armour><action>`: attacks carry a grip, shots a weapon, and everything under `G`
 * is documented only as "misc", so those stay unpinned. `INV` is the inventory paperdoll.
 */
const CHARACTER: readonly ActionEntry[] = [
    { code: "A1", id: "attack", detail: "1-handed overhead" },
    { code: "A2", id: "attack", detail: "2-handed overhead" },
    { code: "A3", id: "attack", detail: "1-handed backslash" },
    { code: "A4", id: "attack", detail: "2-handed backslash" },
    { code: "A5", id: "attack", detail: "1-handed thrust" },
    { code: "A6", id: "attack", detail: "2-handed thrust" },
    { code: "CA", id: "spell" },
    { code: "SA", id: "shoot", detail: "bow" },
    { code: "SS", id: "shoot", detail: "sling" },
    { code: "SX", id: "shoot", detail: "crossbow" },
    { code: "INV", id: "paperdoll" },
];

/**
 * The two-letter scheme, one file per action.
 *
 * The three melee attacks are documented as plain "attack" with nothing separating them, so none carries a
 * grip - which is what makes a character-scheme attack lose its grip on the way here rather than acquire a
 * wrong one. `A4` is the ranged attack.
 */
const ACTION_CODES: readonly ActionEntry[] = [
    { code: "WK", id: "walk" },
    { code: "SD", id: "stand" },
    { code: "SC", id: "ready" },
    { code: "A1", id: "attack" },
    { code: "A2", id: "attack" },
    { code: "A3", id: "attack" },
    { code: "A4", id: "shoot" },
    { code: "CA", id: "spell" },
    { code: "SP", id: "spell" },
    { code: "GH", id: "get-hit" },
    { code: "DE", id: "die" },
    { code: "TW", id: "twitch" },
    { code: "GU", id: "get-up" },
    { code: "SL", id: "sleep" },
];

const TABLES: Readonly<Record<ActionScheme, readonly ActionEntry[]>> = {
    character: CHARACTER,
    "action-codes": ACTION_CODES,
    "cycle-numbers": [],
};

/**
 * Every code each scheme names, for a guard that walks the tables rather than a hand-kept list of them.
 *
 * The unpinned codes an install ships are not here: they are not table entries, and a scheme's unpinned
 * space is open - `G13` is as good a misc code as `G19`, and a closed list would go stale against the next
 * animation that uses one this install does not.
 */
export const ACTION_SCHEME_CODES: Readonly<Record<ActionScheme, readonly string[]>> = {
    character: CHARACTER.map((entry) => entry.code),
    "action-codes": ACTION_CODES.map((entry) => entry.code),
    "cycle-numbers": [],
};

export function decodeActionCode(scheme: ActionScheme, code: string): NeutralActionRef {
    const entry = TABLES[scheme].find((candidate) => candidate.code === code);
    if (entry === undefined) return { scheme, id: "unpinned", code };
    return entry.detail === undefined
        ? { scheme, id: entry.id, code }
        : { scheme, id: entry.id, code, detail: entry.detail };
}

/**
 * Whether a scheme's filenames carry the armour level.
 *
 * Only the character family varies by armour at all, and it puts the level in the name; the others name a
 * file per action and nothing else. A set with several levels therefore cannot be written into those
 * without the levels overwriting each other, which is the caller's decision to make rather than this one's.
 */
export function namesArmour(scheme: ActionScheme): boolean {
    return scheme === "character";
}

/** The file a scheme names for one action of one armour level. */
export function nameMember(scheme: ActionScheme, prefix: string, armour: number | undefined, code: string): string {
    return namesArmour(scheme) && armour !== undefined ? `${prefix}${armour}${code}` : `${prefix}${code}`;
}

/**
 * What a candidate code does to the source's detail.
 *
 * `assumed` is the one worth reporting: the target's names distinguish something the source never stated,
 * so writing the file at all commits to a weapon or grip nobody chose.
 */
export type DetailFate = "kept" | "dropped" | "assumed";

export interface ActionEncoding {
    code: string;
    detail: DetailFate;
}

function fateOf(source: string | undefined, target: string | undefined): DetailFate | undefined {
    if (source === target) return "kept";
    if (target === undefined) return "dropped";
    if (source === undefined) return "assumed";
    // Both name a detail and they differ. Not a candidate at all: filing a thrust under a backslash's code
    // would have the converter state something the source contradicts.
    return undefined;
}

/**
 * Every code `target` names for this action, best first - empty where it names none.
 *
 * A list rather than one code because a scheme can name the same meaning several times (three melee
 * attacks, three shooting weapons), and which of them a given action should take depends on what the rest
 * of the set has already claimed - a decision for the caller writing the set, not for this table.
 *
 * An unpinned action travels only within its own scheme, under its own code. Anywhere else it has no name:
 * the code is a label whose meaning nothing has established, and matching it against another scheme's
 * identical letters is exactly the inference the vocabulary exists to avoid.
 */
export function encodeActionCodes(target: ActionScheme, action: NeutralActionRef): ActionEncoding[] {
    if (action.id === "unpinned") {
        return action.scheme === target ? [{ code: action.code, detail: "kept" }] : [];
    }
    const candidates: ActionEncoding[] = [];
    for (const entry of TABLES[target]) {
        if (entry.id !== action.id) continue;
        const detail = fateOf(action.detail, entry.detail);
        if (detail !== undefined) candidates.push({ code: entry.code, detail });
    }
    // The source's own code first where the target names it too: a set written back to the scheme it came
    // from must land on the file it was read from, whatever else that scheme calls the same meaning.
    return candidates.sort((a, b) => Number(b.code === action.code) - Number(a.code === action.code));
}
