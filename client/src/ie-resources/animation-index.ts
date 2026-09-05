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
import { type AnimationIni, parseAnimationIni } from "./animation-ini";
import { characterFacetsOf, type CharacterFacets } from "./animation-facets";
import { type AnimationTable, type TableAnimation } from "./animation-tables/table";
import { tableForFlavour } from "./animation-tables";
import { type Layout, layoutOf } from "./animation-schemes/layout";
import { declaredStride } from "./animation-schemes/bands";
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
    /** `resref_paperdoll`. Separate from the body: an aliasing set keeps its own inventory image. */
    paperdollPrefix: string | undefined;
    scheme: AnimationScheme;
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
    /** Present only where the id declares them - a monster or a named individual has none. */
    facets?: CharacterFacets;
}

const ANIMATION_CODES = "ANISND";
const ANIMATION_NAMES = "ANIMATE";

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

/** One prefix per armour level, from a table row - the array's index is the level, counting from one. */
function prefixesOfTable(tabled: TableAnimation | undefined): Map<number, string> {
    return new Map(tabled === undefined ? undefined : tabled.prefixes.map((prefix, at) => [at + 1, prefix]));
}

function schemeFrom(ini: AnimationIni | undefined, tabled: TableAnimation | undefined): AnimationScheme {
    const section = ini === undefined ? tabled?.section : ini.section;
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
 * The layout an animation draws under. A table row carries no `split_bams`, so a tabled `monster` resolves to
 * the unsplit layout - which is what `layoutOf` returns for an undeclared split.
 */
function layoutFor(ini: AnimationIni | undefined, tabled: TableAnimation | undefined): Layout | undefined {
    return ini === undefined ? layoutOf(tabled?.section) : layoutOf(ini.section, ini.splitBams);
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
        const stride = declaredStride(ini === undefined ? tabled?.section : ini.section);
        sets.push({
            id,
            code: codes.get(id) ?? "",
            name: names.get(id) ?? "",
            prefixByArmour: ini === undefined ? prefixesOfTable(tabled) : prefixesFrom(ini),
            paperdollPrefix: ini === undefined ? tabled?.paperdoll : ini.resrefPaperdoll,
            scheme: schemeFrom(ini, tabled),
            ...(layoutFor(ini, tabled) === undefined ? {} : { layout: layoutFor(ini, tabled) }),
            ...(stride === undefined ? {} : { bandStride: stride }),
            ...(characterFacetsOf(id) === undefined ? {} : { facets: characterFacetsOf(id) }),
        });
    }
    return sets;
}

export type AnimationIndexResolver = (gameDir: string) => readonly AnimationSet[] | undefined;

/** Cached per game directory: whether an install's animations can be listed is a property of the install. */
export function createAnimationIndexResolver(currentGame: GameSource): AnimationIndexResolver {
    const cache = new Map<string, readonly AnimationSet[] | null>();
    return (gameDir) => {
        const cached = cache.get(gameDir);
        if (cached !== undefined) return cached ?? undefined;
        let index: readonly AnimationSet[] | null = null;
        try {
            const game = currentGame.gameAt(gameDir);
            if (game !== undefined) index = buildAnimationIndex(game, tableForFlavour(game.identity.flavour));
        } catch {
            // An unreadable game is "no animations", the posture every other resolver here takes.
        }
        cache.set(gameDir, index);
        return index ?? undefined;
    };
}
