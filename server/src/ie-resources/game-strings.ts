/**
 * Resolves TLK string references ("strrefs") against the configured Infinity Engine install, so features that
 * show what a strref means - inlay hints and hover on a BAF `DisplayString`, the dialog editor's line text -
 * all read one string table.
 *
 * The server opens its own game rather than asking the client for the text: `weidu.gamePath` arrives through
 * standard `workspace/configuration`, so strref resolution works in any LSP client, where a custom
 * server-to-client request would confine it to the VS Code extension.
 */

import { openGame, type Game } from "@bgforge/binary/archive";
import { errorMessage } from "../diagnostics";
import { conlog } from "../logger";
import type { WeiDUsettings } from "../settings";

/** The install-opening seam. Injected in tests so they need no game on disk. */
export type GameOpener = (dir: string, encoding: string | undefined) => Game;

const defaultOpener: GameOpener = (dir, encoding) =>
    // Engine mode: resolve what the running game sees, so a mod's override files win as they do in play.
    openGame(dir, { mode: "engine", ...(encoding === undefined ? {} : { encoding }) });

/** The settings that decide which string table is read; a change to either re-opens the game. */
type GameConfig = Pick<WeiDUsettings, "gamePath" | "tlkEncoding">;

export class GameStrings {
    private readonly opener: GameOpener;
    private open: { key: string; game: Game } | undefined;
    private failedKey: string | undefined;

    constructor(opener: GameOpener = defaultOpener) {
        this.opener = opener;
    }

    /**
     * The text for `strref` in the configured game, or undefined when there is no game, no string table, or no
     * such strref. Never throws: a strref that cannot be resolved drops the hint rather than failing the
     * request that asked for it.
     */
    resolve(strref: number, weidu: GameConfig): string | undefined {
        return this.game(weidu)?.tlk()?.get(strref);
    }

    private game(weidu: GameConfig): Game | undefined {
        const { gamePath } = weidu;
        if (gamePath === "") return undefined;
        // The encoding is part of the key because it is fixed when the TLK is opened - re-opening is what makes
        // a corrected setting take effect without a server restart.
        const key = `${gamePath} ${weidu.tlkEncoding}`;
        if (this.open?.key === key) return this.open.game;
        // A bad game path would otherwise be re-opened once per hint in a document. Cached by key, so pointing
        // the setting somewhere else retries immediately.
        if (this.failedKey === key) return undefined;

        this.dispose();
        try {
            const game = this.opener(gamePath, weidu.tlkEncoding === "" ? undefined : weidu.tlkEncoding);
            this.open = { key, game };
            return game;
        } catch (error) {
            this.failedKey = key;
            conlog(`Cannot read game strings from ${gamePath}: ${errorMessage(error)}`, "warn");
            return undefined;
        }
    }

    /** Close the open install. The next lookup re-opens it. */
    dispose(): void {
        this.open?.game.close();
        this.open = undefined;
        this.failedKey = undefined;
    }
}
