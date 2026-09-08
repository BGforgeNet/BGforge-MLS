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
 * `fallout-critter` is a WRITE target only: a set is not yet read from FRMs, so no code decodes into it, and
 * its table exists to name the files a converted set lands in.
 */
export type ActionScheme = "character" | "action-codes" | "cycle-numbers" | "fallout-critter";

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
 * `<race><gender><class><armour><action>`: attacks carry a grip, shots a weapon, `INV` is the inventory
 * paperdoll.
 *
 * The `G` family is documented only as "misc", which reads as unpinnable - but every one of those files
 * carries the same eleven-band skeleton and draws the band its digit names, and what THAT band depicts the
 * block table pins. So each misc file is named for its own band: measured per file across a classic and an
 * Enhanced install, and the two independent readings agree. `A7`-`A9` ship without their grips documented
 * and stay unpinned, which is what the family's genuinely unnamed space looks like.
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
    { code: "G11", id: "walk" },
    { code: "G1", id: "ready", detail: "1-handed" },
    { code: "G12", id: "stand", detail: "1-handed" },
    { code: "G13", id: "ready", detail: "2-handed" },
    { code: "G14", id: "get-hit" },
    { code: "G15", id: "die" },
    { code: "G16", id: "twitch" },
    { code: "G17", id: "stand" },
    { code: "G18", id: "stand" },
    { code: "G19", id: "sleep" },
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

/**
 * Fallout's critter codes, decoded from the engine's own file-code builder rather than from filenames.
 *
 * That builder writes two letters: the first names the weapon group, the second the animation. Unarmed it
 * emits `a` plus the animation's own index, so `AA` is standing and `AB` walking; a knockdown or death is
 * `b` plus the offset into that range, making `BA` the first of them; standing back up has its own fixed
 * pairs. Only the unarmed group is named here - every other first letter spells out a weapon, which a source
 * that never stated one cannot be filed under.
 *
 * The gaps are the point. A combat stance, a sleep and a post-death twitch have no counterpart in that
 * vocabulary at all, so they get no entry and the conversion reports them as actions that did not travel -
 * which is what the reader needs to know, where a nearest-looking code would hide it. Where such an action
 * is drawn from frames another one already wrote, the writer says so rather than calling it lost.
 */
const FALLOUT_CRITTER: readonly ActionEntry[] = [
    { code: "AA", id: "stand" },
    { code: "AB", id: "walk" },
    // The hands-worked-in-front gesture this engine plays for USING something - a container, an item in
    // combat. Not a spell, which it has no notion of; the same SHAPE, and the nearest thing a converted
    // creature has to put in a slot it must fill. Its two neighbours are deliberately absent: the ground
    // one is a crouch over a prone body, and the raised one is declared in the animation list and played
    // from nowhere, so art written there would never be seen.
    { code: "AL", id: "spell" },
    // Hit from the front, then from behind: a family whose chain draws the hit twice fills both.
    { code: "AO", id: "get-hit" },
    { code: "AP", id: "get-hit" },
    // Punch first, kick second: a set with two melee attacks fills both, and the caller takes them in order.
    { code: "AQ", id: "attack" },
    { code: "AR", id: "attack" },
    { code: "AS", id: "shoot" },
    // Falling backwards, then forwards - the first two of the knockdown range.
    { code: "BA", id: "die" },
    { code: "BB", id: "die" },
    // No entry for sleep, deliberately. This engine stores knockdown and death as ONE animation - which it
    // was is decided by whether the critter gets back up - so a source that draws sleeping and dying from
    // one band has already handed that animation over, and the writer shares the file it wrote. Naming the
    // two fall codes here instead would let a source whose sleep is its OWN clip take the other one, and
    // the target would then play a creature lying down asleep as half of its deaths.
    { code: "CH", id: "get-up" },
    { code: "CJ", id: "get-up" },
];

const TABLES: Readonly<Record<ActionScheme, readonly ActionEntry[]>> = {
    character: CHARACTER,
    "action-codes": ACTION_CODES,
    "cycle-numbers": [],
    "fallout-critter": FALLOUT_CRITTER,
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
    "fallout-critter": FALLOUT_CRITTER.map((entry) => entry.code),
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
 * The character family varies by armour and puts the level in the name. Fallout has no armour level on an
 * animation at all - it ships each armoured look as its own critter under its own base name - so the level
 * goes in the base there, which is the same string and a different thing to declare. The remaining families
 * name a file per action and nothing else, so a set with several levels would write each over the one
 * before it; that is a refusal rather than a silent overwrite.
 */
export function namesArmour(scheme: ActionScheme): boolean {
    return scheme === "character" || scheme === "fallout-critter";
}

/**
 * Whether the scheme's filenames address ONE action each.
 *
 * Both named families do, so a source file packing several direction bands becomes several files in either.
 * A character file carries the whole family's band skeleton and still draws one action in it - measured per
 * file on two installs - which is a layout fact rather than a naming one. Only the cycle-numbered family
 * packs: its names say which file rather than what is inside it, so its files are written as they stand.
 */
export function namesOneFilePerAction(scheme: ActionScheme): boolean {
    return scheme !== "cycle-numbers";
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
    const candidates: ActionEncoding[] = [];
    if (action.id !== "unpinned") {
        for (const entry of TABLES[target]) {
            if (entry.id !== action.id) continue;
            const detail = fateOf(action.detail, entry.detail);
            if (detail !== undefined) candidates.push({ code: entry.code, detail });
        }
    }
    // Its own scheme always names it, whatever its table holds: the code came from there, so a set written
    // back lands on the file it was read from. This is the only name a band of a packed file has - the
    // block table pinned what it depicts, and its own family names files rather than actions.
    if (action.scheme === target && !candidates.some((entry) => entry.code === action.code)) {
        candidates.push({ code: action.code, detail: "kept" });
    }
    // The source's own code first where the target names it too: a set written back to the scheme it came
    // from must land on the file it was read from, whatever else that scheme calls the same meaning.
    return candidates.sort((a, b) => Number(b.code === action.code) - Number(a.code === action.code));
}
