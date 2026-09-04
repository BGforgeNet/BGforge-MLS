/**
 * Every creature in the open game, with what it takes to recolour an animation: the seven colour indices,
 * the animation the record uses, and a name to find it by.
 *
 * Built in one pass because the header carries all of it at fixed offsets - a second pass per field would be
 * a second archive read of the same thousands of records. Whether an install's creatures can be listed at all
 * is a property of the install, not of the document, so the whole index is cached per game directory.
 */
import type * as vscode from "vscode";
import { type CreatureColors, CREATURE_RANGES, creatureColorsAt } from "@bgforge/image";
import { gameDirOf, type GameDirFallback } from "./game-lookups";
import { readIdsCodes } from "./ids-tables";

export interface CreatureEntry {
    readonly resref: string;
    /** The creature's name from `dialog.tlk`, or "" when the record names none the table can resolve. */
    readonly name: string;
    readonly animationId: number;
    /** The animation code the install's own table gives this id, or "" when it names none. */
    readonly animationCode: string;
    readonly colors: CreatureColors;
}

export type CreatureIndexResolver = (uri: vscode.Uri) => readonly CreatureEntry[] | undefined;

/** CRE v1 header offsets the index reads, and the length a record needs to carry them all. */
const NAME_STRREF = 0x08;
const ANIMATION_ID = 0x28;
const FIRST_COLOR = 0x2c;
const HEADER_BYTES = FIRST_COLOR + CREATURE_RANGES.length;

/** The resource an install publishes its animation-id to animation-code mapping in. */
const ANIMATION_TABLE = "ANISND";

/** A `Game` handle, named structurally so this module does not depend on the archive library's own type. */
export interface GameHandle {
    tlk: () => { get: (strref: number) => string | undefined } | undefined;
    canRead: (resref: string, type: string) => boolean;
    read: (resref: string, type: string) => Uint8Array;
    list: () => readonly { resref: string; ext: string | undefined }[];
}

export interface GameSource {
    gameAt: (dir: string) => GameHandle | undefined;
}

function buildIndex(game: GameHandle): CreatureEntry[] {
    const codes = game.canRead(ANIMATION_TABLE, "ids")
        ? readIdsCodes(game.read(ANIMATION_TABLE, "ids"))
        : new Map<number, string>();
    const tlk = game.tlk();
    const entries: CreatureEntry[] = [];
    for (const ref of game.list()) {
        if (ref.ext?.toLowerCase() !== "cre" || !game.canRead(ref.resref, "cre")) continue;
        let bytes;
        try {
            bytes = game.read(ref.resref, "cre");
        } catch {
            // One unreadable record is not worth losing the index over - the others are still pickable.
            continue;
        }
        // A record too short to hold the header is skipped rather than read past: the colours of a truncated
        // file would be whatever follows it in memory, and a wrong palette looks like a real one.
        if (bytes.length < HEADER_BYTES) continue;
        const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
        const strref = view.getInt32(NAME_STRREF, true);
        const animationId = view.getUint32(ANIMATION_ID, true);
        entries.push({
            resref: ref.resref.toUpperCase(),
            name: (strref >= 0 ? tlk?.get(strref) : undefined) ?? "",
            animationId,
            animationCode: codes.get(animationId) ?? "",
            colors: creatureColorsAt((i) => view.getUint8(FIRST_COLOR + i)),
        });
    }
    return entries;
}

export function createCreatureIndexResolver(
    currentGame: GameSource,
    fallback?: GameDirFallback,
): CreatureIndexResolver {
    const cache = new Map<string, readonly CreatureEntry[] | null>();
    return (uri) => {
        const gameDir = gameDirOf(uri, fallback);
        if (gameDir === undefined) return;
        const cached = cache.get(gameDir);
        if (cached !== undefined) return cached ?? undefined;
        let index: readonly CreatureEntry[] | null = null;
        try {
            const game = currentGame.gameAt(gameDir);
            if (game !== undefined) index = buildIndex(game);
        } catch {
            // An unreadable game is "no creatures", the posture every other resolver here takes.
        }
        cache.set(gameDir, index);
        return index ?? undefined;
    };
}
