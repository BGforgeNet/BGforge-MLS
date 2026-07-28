import type * as vscode from "vscode";
import { GAME_RESOURCE_SCHEME, parseResourceUri } from "./uri";

/**
 * Resolves a `dialog.tlk` string reference for a document, or undefined when there is nothing to resolve.
 *
 * Handed to consumers that must not reach into the game session themselves (the binary editor lives in its own
 * subsystem and has no business owning a `Game`). The document URI is the parameter rather than a game
 * directory because only the URI says which game - or whether the record came from a game at all.
 */
export type StrrefResolver = (uri: vscode.Uri, strref: number) => string | undefined;

/** Resolves the identifier an IDS table gives a slot, for a document opened from a game. */
export type SlotLabelResolver = (uri: vscode.Uri, tables: readonly string[], index: number) => string | undefined;

/** Resolves a whole naming table (an IDS keyed by value, or a 2DA keyed by row index) for a document. */
export type NamingTableResolver = (
    uri: vscode.Uri,
    kind: string,
    tables: readonly string[],
) => ReadonlyMap<number, string> | undefined;

/** A resref field's declared target: one type, plus the flavours that store something else. */
export interface ResourceRefDecl {
    readonly type: string;
    readonly byFlavour?: Readonly<Record<string, string>>;
}

/**
 * Resolves the type a resref points at in THIS game, or undefined when the game does not have it. The
 * declared type answers what it points at; the game is consulted only for whether it is there.
 */
export type ResourceTypeResolver = (uri: vscode.Uri, decl: ResourceRefDecl, resref: string) => string | undefined;

/** The format-wide "no string" sentinel; every strref field uses it, so a lookup is never attempted for it. */
const NO_STRING = -1;

/** The slice of GameSession this needs. Narrow on purpose: the resolver only ever reads a line, and depending
 *  on the whole session would drag its open/close lifecycle into every caller (and every test). */
interface TlkSource {
    ensureOpen(dir: string): {
        tlk(): { get(strref: number): string | undefined } | undefined;
        ids(resref: string): ReadonlyMap<number, string> | undefined;
        twoDa(resref: string): ReadonlyMap<number, string> | undefined;
        canRead(resref: string, type: string): boolean;
        /** WeiDU's GAME_IS flavour, which is what selects a `byFlavour` override. */
        readonly identity: { readonly flavour: string };
    };
}

export function createStrrefResolver(session: TlkSource): StrrefResolver {
    return (uri, strref) => {
        if (uri.scheme !== GAME_RESOURCE_SCHEME || strref === NO_STRING || strref < 0) return;
        const { gameDir } = parseResourceUri(uri);
        if (!gameDir) return;
        let line: string | undefined;
        try {
            // ensureOpen, not game(): an editor VS Code restored across a reload can outlive the session's
            // knowledge of its game, exactly as the FS provider's read path handles.
            line = session.ensureOpen(gameDir).tlk()?.get(strref);
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
export function createSlotLabelResolver(session: TlkSource): SlotLabelResolver {
    return (uri, tables, index) => {
        if (uri.scheme !== GAME_RESOURCE_SCHEME) return;
        const { gameDir } = parseResourceUri(uri);
        if (!gameDir) return;
        let identifier: string | undefined;
        try {
            const game = session.ensureOpen(gameDir);
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
 * Resolves the whole naming table for a value space the game owns, from the first of `tables` the install
 * actually ships.
 *
 * First table PRESENT wins outright, rather than the per-key search `createSlotLabelResolver` does: a slot
 * array wants the best name available for each index, but an option LIST has to come from one table, since two
 * installs' tables mean different things at the same key and blending them would offer entries that exist in
 * neither.
 */
export function createNamingTableResolver(session: TlkSource): NamingTableResolver {
    return (uri, kind, tables) => {
        if (uri.scheme !== GAME_RESOURCE_SCHEME) return;
        const { gameDir } = parseResourceUri(uri);
        if (!gameDir) return;
        // Accumulate rather than returning from inside the loop, matching the resolvers above: a bare `return`
        // plus a single value return is the shape that satisfies both the linter and `noImplicitReturns`.
        let resolved: ReadonlyMap<number, string> | undefined;
        try {
            const game = session.ensureOpen(gameDir);
            for (const table of tables) {
                resolved = kind === "2da" ? game.twoDa(table) : game.ids(table);
                if (resolved !== undefined) break;
            }
        } catch {
            // Unreadable game - the field falls back to its vendored table, as it does outside a game.
        }
        return resolved;
    };
}

/**
 * Resolves a resref against the open game: the declared type, overridden where this game's flavour stores
 * another, and only then checked for existence.
 *
 * Not a search over candidates. What a field points at follows from the record and the game, so probing by
 * presence would pick whichever happened to exist - wrong for a field whose two types can both be installed.
 * The game is asked one question: is this resource here? Never judges - an unresolvable resref gets no answer,
 * because a mod record legitimately references what a later install step creates.
 */
export function createResourceTypeResolver(session: TlkSource): ResourceTypeResolver {
    return (uri, decl, resref) => {
        if (uri.scheme !== GAME_RESOURCE_SCHEME || resref === "") return;
        const { gameDir } = parseResourceUri(uri);
        if (!gameDir) return;
        let found: string | undefined;
        try {
            const game = session.ensureOpen(gameDir);
            const type = decl.byFlavour?.[game.identity.flavour] ?? decl.type;
            if (game.canRead(resref, type)) found = type;
        } catch {
            // Unreadable game - no affordance, exactly as outside a game.
        }
        return found;
    };
}
