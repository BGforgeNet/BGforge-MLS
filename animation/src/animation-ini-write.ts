/**
 * Writing an animation's own INI declaration - the inverse of `animation-ini.ts`.
 *
 * A converted set is art plus a declaration, and until now this project wrote only the art: the notes
 * named the two IDS rows to add and said nothing about the family, so the files landed with nothing
 * telling the engine how to read them. This writes that file, which the install reads as `<id>.ini` in
 * hex from its override folder.
 *
 * Only the keys a caller names are written. An install's own INIs declare a handful each and leave the
 * rest out, and every reader of them - this project's parser included - treats an absent key as "not
 * declared" rather than as a default, so emitting a full set of keys would be stating things about the
 * animation that nothing has established.
 */

/** What a caller can declare. Each is optional and absent from the output when it is not given. */
export interface AnimationIniDeclaration {
    /** The drawing section, which names the family: `character`, `monster`, `monster_icewind`. */
    section: string;
    /** `[general] animation_type` - the install's own family number, written and read in HEX. */
    animationType?: number;
    /** `resref` - the prefix the body's files draw under. */
    resref: string;
    /** `resref_paperdoll` - the prefix the inventory image draws under, where it differs. */
    resrefPaperdoll?: string;
    /** `armor_max_code` - how many armour levels this animation has. */
    armorMax?: number;
    /** `resref_armor_base` - the fourth letter of the prefix at the lower armour levels. */
    armorBase?: string;
    /** `resref_armor_specific` - the fourth letter at the highest level, where it differs. */
    armorSpecific?: string;
    /**
     * `split_bams` - which FILE SCHEME the animation uses, and nothing about facings.
     *
     * The documentation gives it one meaning for every type that carries it: 0 packs the animation into
     * `G1` and `G2`, 1 spreads it over subfiles. It says nothing about the east, which is fixed by the
     * type - except in the one family below, which declares it.
     */
    splitBams?: boolean;
    /**
     * `mirror` - whether the engine computes the eastern facings, for the one family that declares it.
     *
     * Every other type fixes this, so a declaration of it there would be read by nothing. The burrowing
     * family states two geometries and this is what chooses between them: clear, and the east is read from
     * `*E` companions; set, and the engine flips a western cycle for it.
     */
    mirror?: boolean;
    /** `false_color` - whether the engine applies replacement colours to this animation. */
    falseColor?: boolean;
    /** `quadrants` - how many files each frame is split across, for the families that split. */
    quadrants?: number;
    /** `[general] new_palette` - a replacement colour table this animation draws under. */
    newPalette?: string;
}

function line(key: string, value: string | number | boolean | undefined): string[] {
    if (value === undefined) return [];
    // Booleans as the 0/1 the engine and this project's own parser read; anything else verbatim.
    return [`${key}=${typeof value === "boolean" ? (value ? "1" : "0") : value}`];
}

export function writeAnimationIni(declaration: AnimationIniDeclaration): string {
    return [
        "[general]",
        // Hex, and not always digits: a large minority of an install's animations declare `a000` through
        // `e000`, so a decimal reading of the type is NaN. Written the way it is read.
        ...line("animation_type", declaration.animationType?.toString(16)),
        ...line("new_palette", declaration.newPalette),
        "",
        `[${declaration.section}]`,
        ...line("resref", declaration.resref),
        ...line("resref_paperdoll", declaration.resrefPaperdoll),
        ...line("armor_max_code", declaration.armorMax),
        ...line("resref_armor_base", declaration.armorBase),
        ...line("resref_armor_specific", declaration.armorSpecific),
        ...line("split_bams", declaration.splitBams),
        ...line("mirror", declaration.mirror),
        ...line("false_color", declaration.falseColor),
        ...line("quadrants", declaration.quadrants),
        "",
    ].join("\n");
}
