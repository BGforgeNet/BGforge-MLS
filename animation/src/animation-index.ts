/**
 * Every animation the open game declares, with what it takes to draw one.
 *
 * Sibling of `creature-index.ts` in construction - the same structural game handle, the same per-game-dir
 * cache, the same tolerance for one unreadable resource - with one deliberate divergence: the resolver is
 * keyed by game DIRECTORY rather than by document URI. The creature index answers per open document; this
 * one answers per panel, whose caller already holds the directory, and keying it by URI would make that
 * caller fabricate one.
 *
 * An id reaches this index from any of the install's own declarations, and they do not agree: `ANIMATE.IDS`
 * names ids `ANISND.IDS` omits, an EE install ships an INI per animation while a classic one ships none,
 * and a creature can carry an id no table names. The union is therefore the id set, and a set says what it
 * could not work out rather than guessing.
 */
import { type AnimationIni, declaredFamily, parseAnimationIni } from "./animation-ini";
import { characterFacetsOf, type CharacterFacets } from "./animation-facets";
import { type AnimationTable, type TableAnimation } from "./animation-tables/table";
import { tableForFlavour } from "./animation-tables";
import { type Layout, layoutOf } from "./animation-schemes/layout";
import { layerPrefixes } from "./animation-schemes/layers";
import { coarseBands, declaredStride } from "./animation-schemes/bands";
import type { GameHandle, GameSource } from "./game-handle";
import { readIdsCodes } from "./ids-tables";

/** How this animation's files are laid out, carrying its own identity so a tile can name what is missing. */
export type AnimationScheme =
    | { kind: "character" }
    /** `scheme` is the install's own family number where it declared one, so the tile can name it. */
    | { kind: "unimplemented"; scheme: number | undefined; reason: string };

export interface AnimationSet {
    id: number;
    /** `ANISND.IDS`'s code, or "" when it names none. */
    code: string;
    /** `ANIMATE.IDS`'s name - what a creature's animation field displays, so a link's two ends agree. */
    name: string;
    /**
     * The BAM prefix PER ARMOUR LEVEL.
     *
     * Not one prefix: a set draws `CHMB1..3` and `CHMC4`, because the INI declares a base armour letter and
     * a different specific one for the top level. Up to three distinct prefixes across four levels. Empty
     * when nothing in the install declares them.
     */
    prefixByArmour: ReadonlyMap<number, string>;
    /**
     * The prefix a character level's files fall back to when the level's own names no such file.
     *
     * A character set declares two prefixes and which of them holds a given action varies BY FILE: a classic
     * archive puts a thief's leather body under the class prefix and its other levels under the base one.
     * Absent where the declaration names one prefix, and for every non-character family.
     */
    basePrefix?: string;
    /** `resref_paperdoll`. Separate from the body: an aliasing set keeps its own inventory image. */
    paperdollPrefix: string | undefined;
    scheme: AnimationScheme;
    /**
     * The section the install (or the table) declared, verbatim - `character`, `monster_icewind`,
     * `multi_new`, and so on. Absent where nothing declared one.
     *
     * Kept alongside the two fields derived from it because neither can be inverted: `scheme` collapses
     * `character` and `character_old` onto one kind, and `layout` collapses `monster_icewind`,
     * `monster_large16` and `multi_new` onto one family. Writing a set back out means naming a section in
     * the target's own declaration, which only the section itself can answer.
     */
    section?: string;
    /**
     * Which file-naming family this animation draws under, where one is known. Separate from `scheme`: the
     * section names the scheme, the layout decides what to open, and several sections share a layout.
     */
    layout?: Layout;
    /**
     * Cycles per direction band, where the section settles it; absent leaves the reading to structural
     * inference. Resolved here rather than per consumer so the section itself stays private to the index.
     */
    bandStride?: number;
    /**
     * Prefixes this animation draws a SECOND set of files under - a weapon overlay, or the burrowing
     * family's supporting stills. Absent for the families that draw from one set. See `layers.ts` for why
     * they are members of their own rather than parts of the base ones.
     */
    layerPrefixes?: readonly string[];
    // TODO: two more overlay kinds are declared and not modelled here, both measured against BG2:ToB.
    // A character animation declares a HELMET flag and a WEAPON body-size letter, which pick the equipment
    // BAMs drawn over the body - 78 of the classic table's rows carry one. And three effect rows name a
    // SHADOW resref drawn under the sprite (`SKLH` + `SPSHADOW`). Neither is a naming variant of the base
    // files, so neither can be inferred: both are separate art the declaration points at.
    /**
     * Whether a wide band's sixteen slots hold eight pictures rather than sixteen. Only the tiled families
     * declare it, and only when they store the finer set - so absent means the sixteen slots are distinct.
     */
    coarseBands?: true;
    /**
     * The replacement colour table this animation declares (`new_palette`), where it declares one.
     *
     * What separates the colour variants of a shared body: the six colour dragons all draw `MDR1`'s art
     * and differ only here. Carried verbatim, since it is not always the resref of a file - a tiled family
     * stores one table per stance group and this is their common stem. `set-palette.ts` composes the name.
     */
    newPalette?: string;
    /** Present only where the id declares them - a monster or a named individual has none. */
    facets?: CharacterFacets;
}

const ANIMATION_CODES = "ANISND";
const ANIMATION_NAMES = "ANIMATE";

/** `0x6004` - how an animation id is written wherever a reader sees one. */
export function animationIdHex(id: number): string {
    return `0x${id.toString(16).padStart(4, "0")}`;
}

/**
 * What a set is called: the name its install declares, else its four-letter code, else its id.
 *
 * One definition because four surfaces show it - the gallery tile, the viewer page, the editor tab and
 * the conversion notes - and a set that appears under two different names across them reads as two sets.
 */
export function setTitle(set: Pick<AnimationSet, "id" | "code" | "name">): string {
    return set.name || set.code || animationIdHex(set.id);
}

/** The INI an animation declares itself in is named after its id in hex, four digits, uppercase. */
function iniResref(id: number): string {
    return id.toString(16).toUpperCase().padStart(4, "0");
}

/**
 * One prefix per armour level, from the INI's base and specific armour letters.
 *
 * The letters replace the prefix's fourth character: the base letter carries the lower levels and the
 * specific one the top level. Where the INI declares no letters, the one prefix covers every level.
 */
function prefixesFrom(ini: AnimationIni): Map<number, string> {
    const prefixes = new Map<number, string>();
    if (ini.resref === undefined) return prefixes;
    const levels = ini.armorMax ?? 1;
    for (let level = 1; level <= levels; level++) {
        const letter = level === levels ? ini.armorSpecific : ini.armorBase;
        prefixes.set(level, letter === undefined ? ini.resref : ini.resref.slice(0, 3) + letter);
    }
    return prefixes;
}

/**
 * The prefix a level's files fall back to, where the declaration names one distinct from the level's own.
 *
 * The base letter replaces the prefix's fourth character exactly as the specific one does; `prefixesFrom`
 * already spends it on the lower levels, and this is the same letter offered as the alternative at every
 * level - which is how both reference implementations resolve these files.
 */
function basePrefixFrom(ini: AnimationIni): string | undefined {
    if (ini.resref === undefined || ini.armorBase === undefined) return undefined;
    return ini.resref.slice(0, 3) + ini.armorBase;
}

/** One prefix per armour level, from a table row - the array's index is the level, counting from one. */
function prefixesOfTable(tabled: TableAnimation | undefined): Map<number, string> {
    return new Map(tabled === undefined ? undefined : tabled.prefixes.map((prefix, at) => [at + 1, prefix]));
}

/**
 * The declared section: the install's own, else the table's, else none.
 *
 * One definition rather than the precedence re-stated per reader - the scheme, the band stride and the set's
 * own `section` field all need it, and a copy that missed the "install wins" half would silently answer with
 * a vendored row's section for an animation the install declares itself.
 */
function sectionOf(ini: AnimationIni | undefined, tabled: TableAnimation | undefined): string | undefined {
    return ini === undefined ? tabled?.section : declaredFamily(ini);
}

function schemeFrom(ini: AnimationIni | undefined, tabled: TableAnimation | undefined): AnimationScheme {
    const section = sectionOf(ini, tabled);
    if (ini === undefined && tabled === undefined) {
        return {
            kind: "unimplemented",
            scheme: undefined,
            reason: "no INI declares this animation and no table covers it",
        };
    }
    // `character_old` names its files exactly as `character` does; what it adds is a mirrored twin per
    // file, which is a part of each member rather than a scheme of its own.
    if (section === "character" || section === "character_old") return { kind: "character" };
    return {
        kind: "unimplemented",
        // A table row carries the layout's name but not the install's own type number; only an INI has that.
        scheme: ini?.animationType,
        reason: `the ${section ?? "unnamed"} scheme is not implemented yet`,
    };
}

/**
 * The layout an animation draws under, from the install's own declaration where it ships one and from the
 * vendored table otherwise.
 *
 * The table carries the split too, for the same reason it carries the section: a classic install declares
 * neither, and without it every split animation of the `monster` section falls to the unsplit layout - which
 * opens two files of the eleven such a creature draws from.
 */
function layoutFor(ini: AnimationIni | undefined, tabled: TableAnimation | undefined): Layout | undefined {
    return ini === undefined ? layoutOf(tabled?.section, tabled?.splitBams) : layoutOf(ini.section, ini.splitBams);
}

/**
 * Every armour level a set declares, lowest first.
 *
 * Lives here rather than beside the facet picker that used to own it: the reader, the stance loader and
 * two pickers all ask this, and four copies of one sort is four chances to order them differently.
 */
export function armourLevels(set: AnimationSet | undefined): number[] {
    return set === undefined ? [] : [...set.prefixByArmour.keys()].sort((a, b) => a - b);
}

/**
 * The lowest armour level a set declares - what a viewer opens on when the caller names none, what its
 * tile stands for, and where a facet picker starts.
 */
export function firstArmour(set: AnimationSet): number | undefined {
    return armourLevels(set)[0];
}

/**
 * Every animation the game declares, in id order.
 *
 * `table` is the fallback for an install that declares none - a classic one ships no animation INIs, so
 * without it every id lists as undrawable. A shipped declaration always wins: the table is consulted only
 * where the install is silent, never to correct it.
 */
export function buildAnimationIndex(game: GameHandle, table?: AnimationTable): AnimationSet[] {
    const read = (resref: string, type: string): Uint8Array | undefined => {
        if (!game.canRead(resref, type)) return undefined;
        try {
            return game.read(resref, type);
        } catch {
            // One unreadable resource is not worth losing the index over, the posture the creature index
            // takes for the same reason.
            return undefined;
        }
    };

    const codesBytes = read(ANIMATION_CODES, "ids");
    const namesBytes = read(ANIMATION_NAMES, "ids");
    const codes = codesBytes === undefined ? new Map<number, string>() : readIdsCodes(codesBytes);
    const names = namesBytes === undefined ? new Map<number, string>() : readIdsCodes(namesBytes);

    const ids = new Set<number>([...codes.keys(), ...names.keys()]);
    for (const ref of game.list()) {
        if (ref.ext?.toLowerCase() !== "ini") continue;
        const id = Number.parseInt(ref.resref, 16);
        // An install may ship other .ini resources; only a hex-named one is an animation's declaration.
        if (Number.isFinite(id) && /^[0-9a-f]{1,4}$/i.test(ref.resref)) ids.add(id);
    }

    const sets: AnimationSet[] = [];
    for (const id of [...ids].sort((a, b) => a - b)) {
        const iniBytes = read(iniResref(id), "ini");
        const ini = iniBytes === undefined ? undefined : parseAnimationIni(iniBytes);
        const tabled = ini === undefined ? table?.get(id) : undefined;
        const section = sectionOf(ini, tabled);
        const stride = declaredStride(section);
        const base = ini === undefined ? tabled?.base : basePrefixFrom(ini);
        const layers = layerPrefixes(
            section,
            ini === undefined ? tabled?.prefixes[0] : ini.resref,
            ini === undefined ? (tabled?.overlays ?? []) : ini.weaponOverlays,
        );
        sets.push({
            id,
            code: codes.get(id) ?? "",
            name: names.get(id) ?? "",
            prefixByArmour: ini === undefined ? prefixesOfTable(tabled) : prefixesFrom(ini),
            ...(base === undefined ? {} : { basePrefix: base }),
            paperdollPrefix: ini === undefined ? tabled?.paperdoll : ini.resrefPaperdoll,
            scheme: schemeFrom(ini, tabled),
            ...(section === undefined ? {} : { section }),
            ...(layers.length === 0 ? {} : { layerPrefixes: layers }),
            ...(coarseBands(section, ini?.pathSmooth) ? { coarseBands: true as const } : {}),
            ...(layoutFor(ini, tabled) === undefined ? {} : { layout: layoutFor(ini, tabled) }),
            ...(stride === undefined ? {} : { bandStride: stride }),
            // Only an install that ships INIs declares one; a classic archive's table carries no such column.
            ...(ini?.newPalette === undefined ? {} : { newPalette: ini.newPalette }),
            ...(characterFacetsOf(id) === undefined ? {} : { facets: characterFacetsOf(id) }),
        });
    }
    return sets;
}

export type AnimationIndexResolver = (gameDir: string) => readonly AnimationSet[] | undefined;

/**
 * Told that an install could not be read at all. The caller decides where that goes; this package has no
 * channel of its own.
 */
type AnimationIndexFailureReporter = (gameDir: string, error: unknown) => void;

/**
 * How many installs' indices stay resident. The resolver lives as long as the editor host and each entry
 * holds a whole install's animation index, so an unbounded map keeps every install a session ever opened.
 * Well past what a session realistically opens - the cap bounds the tail rather than being reached.
 */
const MAX_CACHED_INSTALLS = 4;

/** Cached per game directory: whether an install's animations can be listed is a property of the install. */
export function createAnimationIndexResolver(
    currentGame: GameSource,
    reportFailure?: AnimationIndexFailureReporter,
): AnimationIndexResolver {
    const cache = new Map<string, readonly AnimationSet[] | null>();
    return (gameDir) => {
        const cached = cache.get(gameDir);
        if (cached !== undefined) return cached ?? undefined;
        let index: readonly AnimationSet[] | null = null;
        try {
            const game = currentGame.gameAt(gameDir);
            if (game !== undefined) index = buildAnimationIndex(game, tableForFlavour(game.identity.flavour));
        } catch (error) {
            // A throw here is the whole install failing to open, not the per-resource case buildAnimationIndex
            // swallows. Report it and return WITHOUT caching, so a transient read failure retries instead of
            // pinning an empty gallery for the rest of the session.
            reportFailure?.(gameDir, error);
            return;
        }
        cache.set(gameDir, index);
        // Evict least-recently-inserted on overflow (Map insertion order, the shape the server's
        // text cache and symbol index already use).
        if (cache.size > MAX_CACHED_INSTALLS) {
            const oldest = cache.keys().next().value;
            if (oldest !== undefined) cache.delete(oldest);
        }
        return index ?? undefined;
    };
}
