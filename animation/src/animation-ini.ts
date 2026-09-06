/**
 * An animation's own INI declaration, as an EE install ships it.
 *
 * Where these exist, nothing about how an animation draws has to be inferred: the file states its scheme
 * family, the prefix it draws under, and how its armour levels are coded. Each is named after the animation
 * id in hex (`6004.INI` for `0x6004`), not after the animation's code.
 *
 * Every field is optional and stays `undefined` when the file does not declare it, so a caller can say "not
 * declared" instead of taking a plausible default for something the install never said.
 */

export interface AnimationIni {
    /**
     * `[general] animation_type` - the install's own family number, written in HEX and not always digits:
     * a large minority of an EE install's animations declare `a000` through `e000`, which decimal parsing
     * reads as NaN.
     */
    animationType: number | undefined;
    /**
     * The section carrying the drawing declaration - `character`, `monster_quadrant`, `monster_large16`.
     *
     * Taken as the first section that is neither `general` nor `sounds`: across an EE install's animation
     * INIs every file has those two plus exactly one other, so the rule is total rather than a heuristic.
     */
    section: string | undefined;
    /** `resref` - the prefix the BODY draws under, which is not always the animation's own code. */
    resref: string | undefined;
    /**
     * `resref_paperdoll` - the prefix the INVENTORY image draws under, and a separate declaration.
     *
     * It is what differs when a set aliases onto another body: the half-orc cleric draws `CHMB` but its
     * paperdoll is `COMC`, and `COMC1INV` exists where `CHMB1INV` does not. Resolving the inventory image
     * off `resref` names a file no install ships.
     */
    resrefPaperdoll: string | undefined;
    /** `resref_armor_base` - the fourth letter of the prefix at the lower armour levels. */
    armorBase: string | undefined;
    /** `resref_armor_specific` - the fourth letter at the highest level, where it differs from the base. */
    armorSpecific: string | undefined;
    /** `armor_max_code` - how many armour levels this animation has. */
    armorMax: number | undefined;
    splitBams: boolean | undefined;
    falseColor: boolean | undefined;
    quadrants: number | undefined;
    /**
     * `resref_weapon1` and `resref_weapon2` - the one-handed and two-handed weapon overlays of the
     * spell-layered family, each declared as a short code whose FIRST character is appended to `resref` to
     * name the overlay's files. Empty where the animation declares no overlay of that grip.
     */
    weaponOverlays: readonly string[];
}

/** Sections that describe the animation but not how it draws. */
const NON_DRAWING = new Set(["general", "sounds"]);

/**
 * The declared type whose family the section header cannot name on its own.
 *
 * `[monster_layered]` heads two families: the plain one and the spell-layered one, which ships a second
 * overlay layer under `resref_weapon1`. Only the type separates them, and both reference implementations
 * classify off the type for exactly this reason.
 */
const LAYERED_SPELL_TYPE = 0x2000;

/**
 * Which layout family a declaration names, in the vocabulary both reference implementations use.
 *
 * The header is the finer signal almost everywhere - type 1000 covers `monster_quadrant` and `multi_new`,
 * and nothing but the header separates those - so it is what the family is read from, with the one
 * ambiguity above resolved by the type. Separate from `section`, which stays the header verbatim: writing a
 * set back out means naming a header an install would recognise, and `monster_layered_spell` is not one.
 */
export function declaredFamily(ini: AnimationIni): string | undefined {
    if (ini.section === "monster_layered" && ini.animationType === LAYERED_SPELL_TYPE) {
        return "monster_layered_spell";
    }
    return ini.section;
}

function hex(value: string | undefined): number | undefined {
    if (value === undefined) return undefined;
    const parsed = Number.parseInt(value, 16);
    return Number.isFinite(parsed) ? parsed : undefined;
}

function decimal(value: string | undefined): number | undefined {
    if (value === undefined) return undefined;
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) ? parsed : undefined;
}

function flag(value: string | undefined): boolean | undefined {
    return value === undefined ? undefined : value !== "0";
}

export function parseAnimationIni(bytes: Uint8Array): AnimationIni {
    const values = new Map<string, string>();
    let section: string | undefined;
    let current = "";
    for (const raw of new TextDecoder("latin1").decode(bytes).split(/\r?\n/)) {
        const line = raw.trim();
        if (line === "" || line.startsWith("//")) continue;
        const header = /^\[(.+)\]$/.exec(line);
        if (header) {
            current = header[1]!.toLowerCase();
            if (section === undefined && !NON_DRAWING.has(current)) section = current;
            continue;
        }
        const split = line.indexOf("=");
        if (split === -1) continue;
        // Keys are namespaced by section: `false_color` appears under several, and an unqualified map would
        // let whichever section came last answer for all of them.
        values.set(`${current}.${line.slice(0, split).trim().toLowerCase()}`, line.slice(split + 1).trim());
    }

    const drawing = (key: string): string | undefined =>
        section === undefined ? undefined : (values.get(`${section}.${key}`) ?? undefined);
    const upper = (key: string): string | undefined => drawing(key)?.toUpperCase() || undefined;

    return {
        animationType: hex(values.get("general.animation_type")),
        section,
        resref: upper("resref"),
        resrefPaperdoll: upper("resref_paperdoll"),
        armorBase: upper("resref_armor_base"),
        armorSpecific: upper("resref_armor_specific"),
        armorMax: decimal(drawing("armor_max_code")),
        splitBams: flag(drawing("split_bams")),
        falseColor: flag(drawing("false_color")),
        quadrants: decimal(drawing("quadrants")),
        // Only the first character names the files; the rest of the code says which weapons the overlay
        // covers, which is a property of the creature's inventory rather than of the animation.
        weaponOverlays: ["resref_weapon1", "resref_weapon2"].flatMap((key) => {
            const letter = upper(key)?.slice(0, 1);
            return letter === undefined ? [] : [letter];
        }),
    };
}
