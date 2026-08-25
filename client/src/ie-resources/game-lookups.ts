import type * as vscode from "vscode";
import { engineForFlavour, type IeScriptStyle, type TwoDaTable } from "@bgforge/binary";
import { bcsEngineForScriptStyle, type BcsNaming } from "../bcs-editor/document";
import type { BcsSignatureRow } from "../../../compilers/bcs/src/index";
import { GAME_RESOURCE_SCHEME, parseResourceUri } from "./uri";
import { kitNamesByBit, kitsByUsabilityMask } from "./kit-usability";

/**
 * Resolves a `dialog.tlk` string reference for a document, or undefined when there is nothing to resolve.
 *
 * Handed to consumers that must not reach into the open game themselves (the binary editor lives in its own
 * subsystem and has no business owning a `Game`). The document URI is the parameter rather than a game
 * directory because only the URI says which game - or whether the record came from a game at all.
 */
export type StrrefResolver = (uri: vscode.Uri, strref: number) => string | undefined;

/** One string a search matched: the number to store, and the text that made it a hit. */
export interface StrrefMatch {
    readonly strref: number;
    readonly text: string;
}

/**
 * Finds strings by what they say, for choosing one without knowing its number. `limit` caps the hits, since a
 * common word matches thousands in a real string table.
 */
export type StrrefSearch = (uri: vscode.Uri, query: string, limit?: number) => readonly StrrefMatch[];

/** Resolves the identifier an IDS table gives a slot, for a document opened from a game. */
export type SlotLabelResolver = (uri: vscode.Uri, tables: readonly string[], index: number) => string | undefined;

/** One naming table the install ships, tagged with which candidate it is so the caller can key it correctly. */
export interface NamedTable {
    readonly table: string;
    readonly entries: ReadonlyMap<number, string>;
}

/** Resolves the naming tables (IDS keyed by value, or 2DA keyed by row index) a document's install ships. */
export type NamingTableResolver = (
    uri: vscode.Uri,
    kind: string,
    tables: readonly string[],
) => readonly NamedTable[] | undefined;

/** A resref field's declared target: one type, plus the flavours that store something else. */
export interface ResourceRefDecl {
    readonly type: string;
    readonly byFlavour?: Readonly<Record<string, string>>;
}

/** What a resref field points at in one game, and whether the current value is actually there. */
export interface ResolvedResourceRef {
    /** The declared type, or this game's `byFlavour` override. Known from the record and the game alone. */
    readonly type: string;
    /** Whether the game has that resource. False for an empty field and for a name nothing resolves. */
    readonly present: boolean;
}

/**
 * Resolves what a resref field points at in THIS game, or undefined when the record is not from a game.
 *
 * The two halves are separate because they are known at different times: the TYPE follows from the record and
 * the game, so it holds even for an empty field - which is exactly the field a resource picker is for - while
 * PRESENCE is a property of the value and gates only the open affordance.
 */
export type ResourceTypeResolver = (
    uri: vscode.Uri,
    decl: ResourceRefDecl,
    resref: string,
) => ResolvedResourceRef | undefined;

/** What a bitfield's bits refer to, as the display tree carries it. Only `byte` is read. */
export interface FlagsBitRefDecl {
    kind: string;
    byte: number;
}

export type FlagBitNamesResolver = (
    uri: vscode.Uri,
    ref: FlagsBitRefDecl,
) => Readonly<Record<string, readonly string[]>> | undefined;

/**
 * Every resref of one type the game holds, sorted, or undefined when the record is not from a game.
 *
 * Suggestions, never a domain: a resref field legitimately names a resource a later install step creates, so a
 * consumer offers this list without confining the field to it.
 */
export type ResourceListResolver = (uri: vscode.Uri, ext: string) => readonly string[] | undefined;

/**
 * The bytes of one resource in the game a document resolves against, or undefined when there is no game or the
 * resource is not there.
 *
 * Deliberately the raw bytes and nothing more: what a consumer wants them FOR (a thumbnail, a preview) decides
 * how to decode them, and this module has no business knowing about formats.
 */
export type ResourceBytesResolver = (uri: vscode.Uri, resref: string, ext: string) => Uint8Array | undefined;

/**
 * The IE engine key of the game a record was opened from, or undefined outside one.
 *
 * Needed because an effect opcode number has no engine-neutral meaning - 238 is Disintegrate on BG2/EE and a
 * saving-throw modifier on Icewind Dale - and the record's own bytes cannot say which game they belong to.
 */
export type EngineResolver = (uri: vscode.Uri) => string | undefined;

/** The format-wide "no string" sentinel; every strref field uses it, so a lookup is never attempted for it. */
const NO_STRING = -1;

/**
 * The game a plain `file:` document resolves against, when any. Supplied by the caller that owns the policy
 * (the configured game path, the open game) - this module only knows URIs, not settings or installs.
 */
export type GameDirFallback = () => string | undefined;

/**
 * The game directory a document resolves against, or undefined when there is none. One definition for every
 * resolver below, so they cannot drift on what counts as game-backed.
 *
 * A game-resource URI names its own game. A plain `file:` document (a mod's own record on disk) carries no
 * game, so the caller-supplied fallback decides; its `g=`-style query, if any, is deliberately never read -
 * only the dedicated scheme makes a URI self-describing. Other schemes never resolve.
 */
export function gameDirOf(uri: vscode.Uri, fallback?: GameDirFallback): string | undefined {
    if (uri.scheme === GAME_RESOURCE_SCHEME) {
        const { gameDir } = parseResourceUri(uri);
        return gameDir === "" ? undefined : gameDir;
    }
    if (uri.scheme === "file") return fallback?.();
    return undefined;
}

/**
 * Whether anything can be resolved for this document at all.
 *
 * Exported so a caller can skip work that could only ever come back empty: the binary editor walks every
 * host-to-webview message hunting for rows to fill in, and for a record with no game to resolve against that
 * traversal is guaranteed to find nothing. Asking here keeps the scheme's meaning in this module rather than
 * spreading a URI check into consumers.
 */
export function isGameDocument(uri: vscode.Uri, fallback?: GameDirFallback): boolean {
    return gameDirOf(uri, fallback) !== undefined;
}

/** The slice of CurrentGame these need. Narrow on purpose: a resolver only ever reads from an open game, and
 *  depending on the whole holder would drag its open/close lifecycle into every caller (and every test). */
interface GameSource {
    /**
     * Undefined when `dir` names an install other than the open one, which every resolver here treats as
     * "no game" - see `CurrentGame.gameAt`.
     */
    gameAt(dir: string):
        | {
              tlk():
                  | {
                        get(strref: number): string | undefined;
                        search(query: string, options?: { limit?: number }): readonly StrrefMatch[];
                    }
                  | undefined;
              ids(resref: string): ReadonlyMap<number, string> | undefined;
              idsAll(resref: string): ReadonlyMap<number, readonly string[]> | undefined;
              twoDa(resref: string): ReadonlyMap<number, string> | undefined;
              twoDaTable(resref: string): TwoDaTable | undefined;
              canRead(resref: string, type: string): boolean;
              read(resref: string, type: string): Uint8Array;
              list(): readonly { readonly resref: string; readonly ext: string | undefined }[];
              /**
               * WeiDU's GAME_IS flavour, which is what selects a `byFlavour` override, and the coarser script
               * style the same detection reports - the axis a compiled script's field naming turns on.
               */
              readonly identity: { readonly flavour: string; readonly scriptStyle: IeScriptStyle };
          }
        | undefined;
}

/** How many hits a search returns when the caller names no limit; a picker shows a page, not a whole table. */
const DEFAULT_SEARCH_LIMIT = 100;

export function createStrrefSearch(currentGame: GameSource, fallback?: GameDirFallback): StrrefSearch {
    return (uri, query, limit = DEFAULT_SEARCH_LIMIT) => {
        const gameDir = gameDirOf(uri, fallback);
        if (gameDir === undefined) return [];
        try {
            // gameAt and the male/default table, for the reasons given on the strref resolver below.
            return currentGame.gameAt(gameDir)?.tlk()?.search(query, { limit }) ?? [];
        } catch {
            // An unreadable game reads as "no matches" - the picker simply offers nothing to choose.
            return [];
        }
    };
}

export function createStrrefResolver(currentGame: GameSource, fallback?: GameDirFallback): StrrefResolver {
    return (uri, strref) => {
        if (strref === NO_STRING || strref < 0) return;
        const gameDir = gameDirOf(uri, fallback);
        if (gameDir === undefined) return;
        let line: string | undefined;
        try {
            // gameAt, which opens the configured game when nothing is open yet: an editor VS Code restored
            // across a reload asks before the view has re-opened anything, as the FS provider's read path does.
            //
            // Always the male/default `dialog.tlk`, though `Game.tlk` can open `dialogF.tlk` too: a record has
            // no player gender, so there is nothing to select on, and the two tables differ for only a handful
            // of strings. Making it selectable needs a user-facing control, not a default guess here.
            line = currentGame.gameAt(gameDir)?.tlk()?.get(strref);
        } catch {
            // A missing game directory or an unreadable TLK is not worth failing an open over - the field
            // simply shows its number, which is what a record outside a game does anyway.
        }
        // A TLK entry can exist but be empty - common for the unused sound slots a CRE leaves pointing at one.
        // An empty line is nothing to show, so it reads as unresolved rather than rendering a trailing space
        // in the field and a blank tooltip.
        return line === "" ? undefined : line;
    };
}

/**
 * Resolves a slot's name from the first of `tables` the game actually ships - BG2 carries SNDSLOT.IDS, BG1
 * SOUNDOFF.IDS, and an install can have both with different meanings at the same index, so preference order
 * decides rather than a merge.
 */
export function createSlotLabelResolver(currentGame: GameSource, fallback?: GameDirFallback): SlotLabelResolver {
    return (uri, tables, index) => {
        const gameDir = gameDirOf(uri, fallback);
        if (gameDir === undefined) return;
        let identifier: string | undefined;
        try {
            const game = currentGame.gameAt(gameDir);
            if (game !== undefined)
                for (const table of tables) {
                    identifier = game.ids(table)?.get(index);
                    if (identifier !== undefined) break;
                }
        } catch {
            // Unreadable game - the slot keeps its generic label, as it does outside a game.
        }
        return identifier === "" ? undefined : identifier;
    };
}

/**
 * Resolves the naming tables for a value space the game owns: every candidate in `tables` the install actually
 * ships, in declaration order.
 *
 * Every present candidate rather than only the first, because two tables naming one value space are as often
 * complementary as rival - on BG2:ToB, MISSILE.IDS names 108 stored projectile values PROJECTL.IDS has no key
 * for, so stopping at the first would leave those unnamed. Each is tagged with its own name so the caller
 * can apply the key encoding the ref declares for it and decide who wins a key both name; nothing is blended
 * here, so an entry always comes from a table this install holds.
 */
export function createNamingTableResolver(currentGame: GameSource, fallback?: GameDirFallback): NamingTableResolver {
    return (uri, kind, tables) => {
        const gameDir = gameDirOf(uri, fallback);
        if (gameDir === undefined) return;
        const found: NamedTable[] = [];
        try {
            const game = currentGame.gameAt(gameDir);
            if (game !== undefined)
                for (const table of tables) {
                    const entries = kind === "2da" ? game.twoDa(table) : game.ids(table);
                    if (entries !== undefined) found.push({ table, entries });
                }
        } catch {
            // Unreadable game - the field falls back to its vendored table, as it does outside a game.
        }
        // Undefined rather than an empty list when the install ships none: the caller reads a table's presence
        // as "the game names this field", and an empty list would turn a plain number into an empty dropdown.
        return found.length === 0 ? undefined : found;
    };
}

/** How a compiled script reads under its install, or undefined when the document has no game. */
export type BcsSymbolResolver = (uri: vscode.Uri) => BcsNaming | undefined;

/**
 * A signature table indexed by the call it declares, which is the key compiling looks a name up by.
 *
 * Every row is kept rather than one per name, for the same reason `idsAll` exists: one name can appear more
 * than once, and only the call site says which row was meant.
 */
function signaturesByName(rows: ReadonlyMap<number, readonly string[]> | undefined): Map<string, BcsSignatureRow[]> {
    const index = new Map<string, BcsSignatureRow[]>();
    for (const [id, signatures] of rows ?? []) {
        for (const signature of signatures) {
            const open = signature.indexOf("(");
            const name = (open === -1 ? signature : signature.slice(0, open)).trim().toLowerCase();
            index.set(name, [...(index.get(name) ?? []), { id, signature }]);
        }
    }
    return index;
}

/**
 * Resolves the tables a compiled script decompiles against.
 *
 * Signatures come through `idsAll` rather than `ids`: ACTION.IDS names one id twice 32 times over, and id 160's
 * two rows take different argument types, so the decompiler picks from the record it holds. Everything else -
 * object fields, enumerated arguments - wants one name per value and reads `ids`.
 */
export function createBcsSymbolResolver(currentGame: GameSource, fallback?: GameDirFallback): BcsSymbolResolver {
    return (uri) => {
        const gameDir = gameDirOf(uri, fallback);
        if (gameDir === undefined) return;
        // Accumulated rather than returned from inside the try, so the catch can simply swallow - the same
        // shape the resolvers above use.
        let naming: BcsNaming | undefined;
        try {
            const game = currentGame.gameAt(gameDir);
            if (game !== undefined) {
                // Built once per resolve and captured, because compiling looks a name up per call and rebuilding
                // the index for each would re-walk the whole table thousands of times in one save.
                const triggersByName = signaturesByName(game.idsAll("TRIGGER"));
                const actionsByName = signaturesByName(game.idsAll("ACTION"));
                naming = {
                    symbols: {
                        trigger: (id) => game.idsAll("TRIGGER")?.get(id) ?? [],
                        action: (id) => game.idsAll("ACTION")?.get(id) ?? [],
                        ids: (table) => game.ids(table),
                    },
                    // The same tables read the other way, from the same open game: a save must not resolve names
                    // against one install while the view that produced them resolved against another.
                    compileSymbols: {
                        triggerByName: (name) => triggersByName.get(name.toLowerCase()) ?? [],
                        actionByName: (name) => actionsByName.get(name.toLowerCase()) ?? [],
                        ids: (table) => game.ids(table),
                    },
                    // The engine the install was detected as: it decides which table names each object field, and
                    // no part of a script says which game wrote it.
                    engine: bcsEngineForScriptStyle(game.identity.scriptStyle),
                };
            }
        } catch {
            // Unreadable game - the script reads as "no game behind this document", as it does outside one.
        }
        return naming;
    };
}

/**
 * Which install kits each bit of an ITM kit-usability byte covers, from KITLIST.2DA.
 *
 * Kept per-bit rather than reduced to one name per bit, because the relation genuinely is many-to-one: eight
 * Enhanced Edition kits share `0x00004000`. The presentation decides what to do with a multi-kit bit; this only
 * reports what the install says. A bit the table says nothing about is absent, so the vendored flag label stands.
 */
export function createFlagBitNamesResolver(currentGame: GameSource, fallback?: GameDirFallback): FlagBitNamesResolver {
    return (uri, ref) => {
        if (ref.kind !== "itmKitUsability") return;
        const byte = ref.byte;
        if (byte !== 1 && byte !== 2 && byte !== 3 && byte !== 4) return;
        const gameDir = gameDirOf(uri, fallback);
        if (gameDir === undefined) return;
        // Accumulated rather than returned from inside the try, so the catch can simply swallow - same shape as
        // the naming-table resolver above.
        let byBit: Readonly<Record<string, readonly string[]>> = {};
        try {
            const game = currentGame.gameAt(gameDir);
            const table = game?.twoDaTable("KITLIST");
            const tlk = table === undefined ? undefined : game?.tlk();
            if (table !== undefined)
                byBit = kitNamesByBit(
                    kitsByUsabilityMask(table, (id) => tlk?.get(id)),
                    byte,
                );
        } catch {
            // Unreadable game - the bits fall back to their vendored labels, as they do outside a game.
        }
        // Undefined rather than an empty object when the table names none of this byte's bits: the caller reads
        // presence as "the install has something to say here", and an empty map would claim it does.
        return Object.keys(byBit).length === 0 ? undefined : byBit;
    };
}

/**
 * Resolves a resref against the open game: the declared type, overridden where this game's flavour stores
 * another, and only then checked for existence.
 *
 * Not a search over candidates. What a field points at follows from the record and the game, so probing by
 * presence would pick whichever happened to exist - wrong for a field whose two types can both be installed.
 * The game is asked one question: is this resource here? Never judges - an unresolvable resref comes back
 * `present: false`, which withholds the open affordance and nothing more, because a mod record legitimately
 * references what a later install step creates.
 */
export function createResourceTypeResolver(currentGame: GameSource, fallback?: GameDirFallback): ResourceTypeResolver {
    return (uri, decl, resref) => {
        const gameDir = gameDirOf(uri, fallback);
        if (gameDir === undefined) return;
        let found: ResolvedResourceRef | undefined;
        try {
            const game = currentGame.gameAt(gameDir);
            if (game !== undefined) {
                const type = decl.byFlavour?.[game.identity.flavour] ?? decl.type;
                found = { type, present: resref !== "" && game.canRead(resref, type) };
            }
        } catch {
            // Unreadable game - no affordance, exactly as outside a game.
        }
        return found;
    };
}

/**
 * Lists a type's resrefs from the whole install - biffed and override alike, since both are what the engine
 * resolves. Not filtered by `canRead`: a KEY can name a BIF an install does not ship, and a resref pointing at
 * one is still a legitimate value for the field to hold.
 *
 * Uncached, because the caller asks once per type and holds the answer; caching here would need invalidation
 * on every write into `override/`.
 */
export function createResourceListResolver(currentGame: GameSource, fallback?: GameDirFallback): ResourceListResolver {
    return (uri, ext) => {
        const gameDir = gameDirOf(uri, fallback);
        if (gameDir === undefined) return;
        const want = ext.toLowerCase();
        let resrefs: string[] | undefined;
        try {
            resrefs = currentGame
                .gameAt(gameDir)
                ?.list()
                .filter((r) => r.ext?.toLowerCase() === want)
                .map((r) => r.resref)
                .sort((a, b) => a.localeCompare(b));
        } catch {
            // Unreadable game - the field stays a plain text box, exactly as outside a game.
        }
        return resrefs;
    };
}

/**
 * Reads one resource out of the game a document resolves against.
 *
 * Uncached, like the resource list: the caller asks once per distinct resource and holds what it makes of the
 * bytes, and caching here would need invalidating on every write into `override/`.
 */
export function createResourceBytesResolver(
    currentGame: GameSource,
    fallback?: GameDirFallback,
): ResourceBytesResolver {
    return (uri, resref, ext) => {
        const gameDir = gameDirOf(uri, fallback);
        if (gameDir === undefined) return;
        let bytes: Uint8Array | undefined;
        try {
            bytes = currentGame.gameAt(gameDir)?.read(resref, ext);
        } catch {
            // Every miss lands here, including the ordinary one: `read` throws for an absent resource, and a
            // resref naming what a later install step creates is normal rather than an error. Deliberately not
            // gated on a `canRead` first - it would resolve the resref twice on every HIT to avoid a throw on a
            // rare miss, and the answer is the same either way.
        }
        return bytes;
    };
}

/**
 * Maps the open game's detected flavour to the engine whose opcode readings apply. Returns undefined for a
 * record not from a game, which leaves the editor on its preferred reading.
 */
export function createEngineResolver(currentGame: GameSource, fallback?: GameDirFallback): EngineResolver {
    return (uri) => {
        const gameDir = gameDirOf(uri, fallback);
        if (gameDir === undefined) return;
        let engine: string | undefined;
        try {
            const game = currentGame.gameAt(gameDir);
            if (game !== undefined) engine = engineForFlavour(game.identity.flavour);
        } catch {
            // Unreadable game - no engine, exactly as outside a game.
        }
        return engine;
    };
}
