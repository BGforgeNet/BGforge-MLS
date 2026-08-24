import { openGame, type Game } from "@bgforge/binary";

/**
 * Holds the open IE game(s) for the resource viewer. Independent of the workspace mod tree - a game is a real
 * install the user points at via a command. The viewer resolves in engine mode (what the running game sees).
 */
export class GameSession {
    private readonly games = new Map<string, Game>();
    private currentDir: string | undefined;
    private readonly tlkEncoding: (() => string | undefined) | undefined;

    /**
     * `tlkEncoding` supplies the codepage the game's string table is written in, or undefined to let the
     * library decide (UTF-8 for Enhanced Editions, windows-1252 otherwise).
     *
     * A getter rather than a value because it is read on every open, so correcting the setting takes effect on
     * the next open instead of needing the window reloaded. Injected rather than read here, which is what keeps
     * this module free of `vscode` and directly unit-testable.
     */
    constructor(tlkEncoding?: () => string | undefined) {
        this.tlkEncoding = tlkEncoding;
    }

    /**
     * The one place a game is opened. Both entry points route through it so the options cannot drift - a
     * setting honoured by only one of them is a setting that works intermittently.
     */
    private openAt(dir: string): Game {
        const encoding = this.tlkEncoding?.();
        return openGame(dir, { mode: "engine", ...(encoding === undefined ? {} : { encoding }) });
    }

    /** Open (or re-open) a game at `dir` and make it current. Throws if `dir` has no chitin.key. */
    open(dir: string): Game {
        this.close(dir);
        const game = this.openAt(dir);
        this.games.set(dir, game);
        this.currentDir = dir;
        return game;
    }

    get current(): { dir: string; game: Game } | undefined {
        if (this.currentDir === undefined) return undefined;
        const game = this.games.get(this.currentDir);
        return game ? { dir: this.currentDir, game } : undefined;
    }

    /** The game rooted at `dir`, for resolving a resource URI back to its game. */
    game(dir: string): Game | undefined {
        return this.games.get(dir);
    }

    /**
     * The game at `dir`, opening it if not already loaded. Lets the FS provider serve a resource whose editor
     * VS Code restored across a reload before (or without) the game being re-opened through the view. Adopts the
     * game as current only when nothing else is open, so it never steals focus from an already-open game.
     */
    ensureOpen(dir: string): Game {
        const existing = this.games.get(dir);
        if (existing) return existing;
        const game = this.openAt(dir);
        this.games.set(dir, game);
        this.currentDir ??= dir;
        return game;
    }

    close(dir?: string): void {
        const target = dir ?? this.currentDir;
        if (target === undefined) return;
        this.games.get(target)?.close();
        this.games.delete(target);
        if (this.currentDir === target) this.currentDir = undefined;
    }

    dispose(): void {
        for (const game of this.games.values()) game.close();
        this.games.clear();
        this.currentDir = undefined;
    }
}
