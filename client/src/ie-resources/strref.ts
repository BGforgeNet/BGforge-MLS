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

/** The format-wide "no string" sentinel; every strref field uses it, so a lookup is never attempted for it. */
const NO_STRING = -1;

/** The slice of GameSession this needs. Narrow on purpose: the resolver only ever reads a line, and depending
 *  on the whole session would drag its open/close lifecycle into every caller (and every test). */
interface TlkSource {
    ensureOpen(dir: string): { tlk(): { get(strref: number): string | undefined } | undefined };
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
