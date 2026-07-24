import type { SourceFormat } from "@bgforge/image";
import type { SequenceView } from "../messages";

/**
 * Best-effort decode of what an animation's FILENAME means under the games' naming conventions,
 * for the banner above the stage. Returns undefined when no scheme matches - a wrong decode is
 * worse than none, so every matcher is deliberately strict.
 *
 * Sources:
 * - FRM: rotators/fallout2-docs (frm.md "Where FRMs Live" + "Critter Filename Construction",
 *   anim_names.md), cross-checked against the engine's suffix builder (fallout2-ce art.cc
 *   _art_get_code) and the Animation enum (sfall FalloutEngine/Enums.h).
 * - BAM: IESDP "Avatar Naming Schemes" appendix (appendices/avatarnaming.htm).
 */
export function describeAnimationName(view: {
    basename: string;
    dirName?: string;
    sourceFormat: SourceFormat;
    sequences: ReadonlyArray<Pick<SequenceView, "frameRefs">>;
}): string | undefined {
    const stem = view.basename.replace(/\.[^.]+$/, "").toLowerCase();
    if (view.sourceFormat === "frm") return describeFrm(stem, view.dirName, view.sequences);
    return describeBam(stem);
}

// ---- FRM (Fallout) ----

// Art directories from frm.md "Where FRMs Live" (art type 0-10). The directory a critter FRM sits
// in is the only context the format itself carries - FRM stores no type or name.
const FRM_ART_DIRS: Record<string, string> = {
    items: "item art",
    critters: "critter animation",
    scenery: "scenery art",
    walls: "wall art",
    tiles: "floor/roof tile art",
    misc: "misc art (projectiles, effects)",
    intrface: "interface art",
    inven: "inventory art",
    heads: "talking head",
    backgrnd: "dialogue background",
    skilldex: "skilldex image",
};

// Weapon-animation letters d..m (frm.md); "a" is the unarmed path. sfall extends the weapon codes
// to 11-15 - mod-defined slots with no fixed weapon type - lettered around the taken 'n' (called
// shot) and 'r' (death poses): 11 -> s, 12 -> o, 13 -> p, 14 -> q, 15 -> t (ddraw.ini
// AdditionalWeaponAnims + MiscPatches.cpp WeaponAnimHook). The RP hints are what the Restoration
// Project assigns them to (its weapon protos + rifle/wakizashi animation components); other mods
// may assign anything.
const FRM_WEAPONS: Record<string, string> = {
    d: "knife",
    e: "club",
    f: "sledgehammer",
    g: "spear",
    h: "pistol",
    i: "SMG",
    j: "rifle",
    k: "big gun",
    l: "minigun",
    m: "rocket launcher",
    s: "sfall weapon code 11 (RP: lightsaber)",
    o: "sfall weapon code 12 (RP: lightsaber)",
    p: "sfall weapon code 13 (RP: alternative rifle)",
    q: "sfall weapon code 14 (RP: wakizashi)",
    t: "sfall weapon code 15",
};

// Unarmed basic animations: second letter is 'a' + Animation enum value (0..19).
const FRM_BASIC = [
    "stand",
    "walk",
    "jump begin",
    "jump end",
    "climb ladder",
    "falling",
    "up stairs (right)",
    "up stairs (left)",
    "down stairs (right)",
    "down stairs (left)",
    "magic hands (ground)",
    "magic hands (middle)",
    "magic hands (up)",
    "dodge",
    "hit from front",
    "hit from back",
    "punch",
    "kick",
    "throw",
    "run",
];

// Knockdown/death animations: 'b' (animated) or 'r' (single-frame last pose) + 'a'..'p'.
const FRM_DEATH = [
    "fall back",
    "fall front",
    "bad landing",
    "big hole",
    "charred body",
    "chunks of flesh",
    "dancing autofire",
    "electrify",
    "sliced in half",
    "burned to nothing",
    "electrified to nothing",
    "exploded to nothing",
    "melted to nothing",
    "fire dance",
    "fall back (blood)",
    "fall front (blood)",
];

// Armed actions: second letter is 'c' + (animation - ANIM_take_out); 'a'/'b' are armed
// stand/walk and 'm' the knife/spear throw (_art_get_code's special cases).
const FRM_ARMED: Record<string, string> = {
    a: "stand",
    b: "walk",
    c: "take out",
    d: "put away",
    e: "parry (dodge)",
    f: "thrust",
    g: "swing",
    h: "point (aim)",
    i: "unpoint",
    // Engine enum names are fire_single/fire_burst/fire_continuous; shown as the in-game fire modes.
    j: "single shot",
    k: "burst fire",
    l: "continuous fire",
    m: "throw",
};

function decodeFrmSuffix(stem: string): string | undefined {
    if (stem.length < 4) return undefined; // needs a base name in front of the two-letter code
    const pair = stem.slice(-2);
    if (pair === "na") return "na: targeting picture (called shot)";
    const first = pair[0] ?? "";
    const second = pair[1] ?? "";
    const code = (second.codePointAt(0) ?? 0) - 97; // second letter as an offset from 'a'
    if (first === "a") {
        const basic = FRM_BASIC[code];
        return basic === undefined ? undefined : `${pair}: ${basic}, unarmed`;
    }
    if (first === "b" || first === "r") {
        const death = FRM_DEATH[code];
        if (death === undefined) return undefined;
        return `${pair}: ${death} (${first === "b" ? "death" : "death pose"})`;
    }
    if (first === "c") {
        if (second === "h") return "ch: prone to standing";
        if (second === "j") return "cj: back to standing";
        return undefined;
    }
    const weapon = FRM_WEAPONS[first];
    const action = FRM_ARMED[second];
    if (weapon === undefined || action === undefined) return undefined;
    return `${pair}: ${action}, ${weapon}`;
}

function describeFrm(
    stem: string,
    dirName: string | undefined,
    sequences: ReadonlyArray<Pick<SequenceView, "frameRefs">>,
): string | undefined {
    const category = dirName === undefined ? undefined : FRM_ART_DIRS[dirName.toLowerCase()];
    // The critter suffix tables are only meaningful for critter art; outside a critters directory the
    // gate is the animation itself carrying distinct per-direction sequences (scenery and interface
    // art store one orientation shared across all six slots, so a name like "windmill" ending in a
    // valid-looking letter pair stays undecoded).
    const distinct = new Set(sequences.map((s) => s.frameRefs.join(","))).size;
    const isCritter = category === FRM_ART_DIRS["critters"] || distinct > 1;
    const suffix = isCritter ? decodeFrmSuffix(stem) : undefined;
    // A decoded suffix already says "critter"; repeating the directory category would be noise.
    if (suffix !== undefined) {
        return category === undefined || category === FRM_ART_DIRS["critters"] ? suffix : `${category} - ${suffix}`;
    }
    return category;
}

// ---- BAM (Infinity Engine) ----

// IESDP character-animation scheme: [x][race][gender][class][armor][action][detail]. The appendix
// calls char 1 irrelevant, but both of its examples (and the stock character BAMs) use 'c'; requiring
// it keeps monster/GUI names from false-matching.
const BAM_RACES: Record<string, string> = {
    d: "dwarf/gnome",
    h: "human",
    e: "elf",
    i: "halfling",
    o: "half-orc",
};
const BAM_CLASSES: Record<string, string> = {
    c: "cleric",
    f: "fighter",
    m: "monk",
    t: "thief/bard",
    w: "mage",
};
const BAM_ARMOR: Record<string, string> = { 1: "no armor", 2: "leather", 3: "robe", 4: "plate mail" };
const BAM_CHAR_ACTIONS: Record<string, string> = {
    a: "attack",
    c: "cast",
    g: "misc",
    s: "shoot",
    w: "walk",
};
const BAM_ATTACK_DETAIL: Record<string, string> = {
    1: "1-handed overhead",
    2: "2-handed overhead",
    3: "1-handed backslash",
    4: "2-handed backslash",
    5: "1-handed thrust",
    6: "2-handed thrust",
};

// IWD/BG2-style two-letter sequence codes (plus BG2's SA/SS/SX shot variants).
const BAM_SEQUENCES: Record<string, string> = {
    gu: "get up",
    sd: "stand",
    sc: "combat stance",
    gh: "get hit",
    de: "die",
    tw: "twitch (dead)",
    sp: "cast (spell loop)",
    ca: "cast (spell release)",
    sl: "sleep",
    wk: "walk",
    a1: "attack",
    a2: "attack",
    a3: "attack",
    a4: "attack (ranged)",
    a5: "attack",
    a6: "attack",
    a7: "attack",
    a8: "attack",
    a9: "attack",
    sa: "attack (bow)",
    ss: "attack (sling)",
    sx: "attack (crossbow)",
};

// BG1 monster-style G-codes.
const BAM_G_CODES: Record<string, string> = {
    "1": "stand (combat)",
    "11": "walk",
    "12": "stand (peaceful)",
    "13": "get hit",
    "14": "get hit",
    "15": "twitch (dead)",
    "2": "attack",
    "21": "attack",
    "22": "attack",
    "23": "attack (ranged)",
    "24": "attack (ranged)",
    "25": "cast (spell build-up)",
    "26": "cast (spell release)",
};

const EAST_NOTE = ", east-facing half";

// The detail slot is defined only for attack (1-6) and shoot (x = crossbow, absent = bow); any other
// combination is not this scheme. null = valid with nothing to add; undefined = reject the match.
function charSchemeDetail(action: string, detail: string): string | null | undefined {
    if (action === "a") return detail === "" ? undefined : BAM_ATTACK_DETAIL[detail];
    if (action === "s") return detail === "" ? "bow" : detail === "x" ? "crossbow" : undefined;
    return detail === "" ? null : undefined;
}

function describeBam(stem: string): string | undefined {
    const charMatch = /^c([dheio])([fm])([cfmtw])([1-4])([acgsw])([1-6x]?)(e?)$/.exec(stem);
    if (charMatch) {
        const [, race = "", gender = "", cls = "", armor = "", action = "", detail = "", east = ""] = charMatch;
        const detailText = charSchemeDetail(action, detail);
        if (detailText !== undefined) {
            const who = `${BAM_RACES[race]} ${gender === "f" ? "female" : "male"} ${BAM_CLASSES[cls]}`;
            const act = `${BAM_CHAR_ACTIONS[action]}${detailText === null ? "" : ` (${detailText})`}`;
            return `${who}, ${BAM_ARMOR[armor]} - ${act}${east === "e" ? EAST_NOTE : ""}`;
        }
    }

    const gMatch = /^.{3,}g(2[1-6]?|1[1-5]?)(e?)$/.exec(stem);
    if (gMatch) {
        const [, code = "", east = ""] = gMatch;
        const label = BAM_G_CODES[code];
        // "BG1 monster" is part of the reading: a G-code means this only under that scheme (the
        // same "G1" in a BG1 character-style file is just its first orientation file).
        if (label !== undefined) return `G${code}: BG1 monster ${label}${east === "e" ? EAST_NOTE : ""}`;
    }

    return describeBamSequenceCode(stem);
}

// Trailing two-letter sequence code, with or without the east-half 'e' behind it. Checked as two
// slices rather than one regex: a greedy pattern would bind "...cae" as code "ae" and never retry
// as "ca" + east. The direct (no-'e') reading wins when both fit. Prefix stays >= 3 chars so short
// resource names cannot false-match.
function describeBamSequenceCode(stem: string): string | undefined {
    const direct = stem.slice(-2);
    const directLabel = BAM_SEQUENCES[direct];
    if (stem.length >= 5 && directLabel !== undefined) return `${direct.toUpperCase()}: ${directLabel}`;
    if (stem.endsWith("e") && stem.length >= 6) {
        const code = stem.slice(-3, -1);
        const label = BAM_SEQUENCES[code];
        if (label !== undefined) return `${code.toUpperCase()}: ${label}${EAST_NOTE}`;
    }
    return undefined;
}
