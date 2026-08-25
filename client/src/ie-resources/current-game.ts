import { openGame, type Game } from "@bgforge/binary";

/**
 * The install-opening seam, as `server/src/ie-resources/game-strings.ts` has one. Injected in tests, where
 * closing is otherwise unobservable: `Game.close()` releases BIF file descriptors and leaves the in-memory
 * KEY index intact, so nothing on the public surface distinguishes a closed game from an open one.
 */
export type GameOpener = (dir: string, encoding: string | undefined) => Game;

const defaultOpener: GameOpener = (dir, encoding) =>
    // Engine mode: resolve what the running game sees, so a mod's override files win as they do in play.
    openGame(dir, { mode: "engine", ...(encoding === undefined ? {} : { encoding }) });

/**
 * The one open IE game, for the resource viewer and every lookup that resolves against an install.
 *
 * Independent of the workspace mod tree - a game is a real install the user points at via a command. The
 * viewer resolves in engine mode (what the running game sees).
 *
 * Exactly one game is open at a time. A mod targets one install, `bgforge.weidu.gamePath` names one, and
 * opening a game writes that setting - so holding several would let a lookup answer from an install the
 * workspace no longer targets, silently and with nothing on screen saying which one replied. Opening a
 * second game therefore closes the first. Other engine families (Fallout) would be a separate holder
 * beside this one, not another entry in it.
 */
export class CurrentGame {
    private open_: { dir: string; game: Game } | undefined;
    private readonly tlkEncoding: (() => string | undefined) | undefined;
    private readonly opener: GameOpener;

    /**
     * `tlkEncoding` supplies the codepage the game's string table is written in, or undefined to let the
     * library decide (UTF-8 for Enhanced Editions, windows-1252 otherwise).
     *
     * A getter rather than a value because it is read on every open, so correcting the setting takes effect on
     * the next open instead of needing the window reloaded. Injected rather than read here, which is what keeps
     * this module free of `vscode` and directly unit-testable.
     */
    constructor(tlkEncoding?: () => string | undefined, opener: GameOpener = defaultOpener) {
        this.tlkEncoding = tlkEncoding;
        this.opener = opener;
    }

    /**
     * The one place a game is opened. Both entry points route through it so the options cannot drift - a
     * setting honoured by only one of them is a setting that works intermittently.
     */
    private openAt(dir: string): Game {
        return this.opener(dir, this.tlkEncoding?.());
    }

    /**
     * Open (or re-open) the game at `dir`, closing whatever was open. Throws if `dir` has no chitin.key.
     *
     * The new game is opened before the old one is closed: a mistyped path throws, and the game already open
     * should survive that rather than be closed for a replacement that never arrived.
     */
    open(dir: string): Game {
        const game = this.openAt(dir);
        this.close();
        this.open_ = { dir, game };
        return game;
    }

    get current(): { dir: string; game: Game } | undefined {
        return this.open_;
    }

    /**
     * The game at `dir`, or undefined when a different install is open.
     *
     * Undefined is the answer a resource left over from a previous game gets: its bytes are no longer
     * reachable, and re-opening its install to serve it would undo the switch the user just made. The caller
     * decides how to say so - the FS provider reports the resource as gone.
     *
     * With nothing open it opens `dir` and adopts it, which is what lets an editor VS Code restored across a
     * reload resolve before the view has re-opened anything. That still throws when `dir` has no chitin.key,
     * a failure distinct from the refusal above: one is a broken install, the other a stale tab.
     */
    gameAt(dir: string): Game | undefined {
        if (this.open_ === undefined) {
            const game = this.openAt(dir);
            this.open_ = { dir, game };
            return game;
        }
        return this.open_.dir === dir ? this.open_.game : undefined;
    }

    /** Close the open game, if any. */
    close(): void {
        this.open_?.game.close();
        this.open_ = undefined;
    }

    dispose(): void {
        this.close();
    }
}
