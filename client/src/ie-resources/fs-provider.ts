import * as path from "path";
import * as vscode from "vscode";
import { resourceTypeCode, type Game } from "@bgforge/binary";
import { conlog } from "../logging";
import { type CurrentGame } from "./current-game";
import { parseResourceUri } from "./uri";

/**
 * How many resources' bytes stay cached. `stat` reads a resource whole just to report its size, so browsing a
 * game would otherwise pin every resource it touched for the session - and a TIS tileset runs to tens of MB.
 * Evicts least-recently-used; a miss costs one extraction, which is what an uncached read costs anyway.
 */
const CACHE_LIMIT = 32;

/**
 * Record why a resource operation failed. The FileSystemProvider contract can only answer FileNotFound, so
 * without this a corrupt archive is indistinguishable from an absent file and leaves nothing to diagnose from.
 */
function logResourceFailure(uri: vscode.Uri, error: unknown): void {
    // A FileSystemError is our own FileNotFound rethrown from an inner layer - already the honest answer, and
    // logging it would just add noise for every miss.
    if (error instanceof vscode.FileSystemError) return;
    conlog(`ieResources: ${uri.toString()} failed: ${error instanceof Error ? error.message : String(error)}`);
}

/**
 * Bridges `bgforge-ie-resource:` URIs to the open Game so the existing binary editor can view and edit game resources
 * unchanged: `readFile` extracts via `game.read` (override wins over BIF), and `writeFile` routes to
 * `game.write`, which lands the edit in the game's `override/` folder atomically. A flat, file-only bridge -
 * directory operations are not applicable.
 */
export class GameResourceFileSystemProvider implements vscode.FileSystemProvider {
    private readonly _onDidChangeFile = new vscode.EventEmitter<vscode.FileChangeEvent[]>();
    readonly onDidChangeFile = this._onDidChangeFile.event;

    // Bytes are cached per URI so `stat` (called before open) and `readFile` don't each hit disk, and a save
    // reflects immediately. Populated by stat/readFile, updated by writeFile, dropped by delete. Bounded to
    // CACHE_LIMIT entries, least-recently-used first - a Map iterates in insertion order, so re-inserting on
    // every hit keeps the oldest key at the front.
    private readonly cache = new Map<string, Uint8Array>();
    /**
     * Resources this session has already written, so the overwrite confirmation asks once per file rather
     * than on every save. What the prompt is protecting is a file some OTHER tool put in `override` - a mod's
     * installer, another editor, an earlier session - and once the user has agreed to replace that, the file
     * being replaced from then on is our own.
     */
    private readonly written = new Set<string>();
    private readonly currentGame: CurrentGame;

    constructor(currentGame: CurrentGame) {
        this.currentGame = currentGame;
    }

    /** Drop cached bytes; call when the open game changes so a reopened game re-reads from disk. */
    clearCache(): void {
        this.cache.clear();
        // Consent goes with the cached bytes: this runs when the game is closed, replaced, or its override
        // folder re-read, and in each case a file we wrote may no longer be the file now on disk.
        this.written.clear();
    }

    private cacheGet(key: string): Uint8Array | undefined {
        const bytes = this.cache.get(key);
        if (bytes === undefined) return undefined;
        // Re-insert so this key counts as most recently used.
        this.cache.delete(key);
        this.cache.set(key, bytes);
        return bytes;
    }

    private cacheSet(key: string, bytes: Uint8Array): void {
        this.cache.delete(key);
        this.cache.set(key, bytes);
        while (this.cache.size > CACHE_LIMIT) {
            const oldest = this.cache.keys().next();
            if (oldest.done === true) break;
            this.cache.delete(oldest.value);
        }
    }

    // A resource extension resolves to a resType number (routed through game.read/write); any other extension
    // (e.g. the ".json" snapshot sidecar) has `type: undefined` and is stored as a raw aux file in override.
    private resolve(uri: vscode.Uri): { game: Game; resref: string; ext: string; type: number | undefined } {
        const { gameDir, resref, ext } = parseResourceUri(uri);
        // Open the game on demand from the URI's own gameDir: a reload restores the editor (and this provider)
        // before the view re-opens the game, so asking for the current game alone would fail the readback.
        let game: Game | undefined;
        try {
            game = this.currentGame.gameAt(gameDir);
        } catch (error) {
            // VS Code only understands FileNotFound here, which collapses "no such game", "corrupt chitin.key"
            // and "resource absent" into one indistinguishable failure. Log the real cause first so the output
            // channel can tell them apart; the thrown error stays the one the API expects.
            logResourceFailure(uri, error);
            throw vscode.FileSystemError.FileNotFound(uri);
        }
        if (game === undefined) {
            // A tab left over from a game that has since been replaced. Only one install is open at a time, so
            // its bytes are genuinely unreachable - and re-opening that install to serve them would undo the
            // switch. Logged by name because FileNotFound alone would read as a corrupt archive.
            conlog(`ieResources: ${uri.toString()} belongs to ${gameDir}, which is no longer the open game`);
            throw vscode.FileSystemError.FileNotFound(uri);
        }
        return { game, resref, ext, type: resourceTypeCode(ext) };
    }

    readFile(uri: vscode.Uri): Uint8Array {
        const cached = this.cacheGet(uri.toString());
        if (cached) return cached;
        const { game, resref, ext, type } = this.resolve(uri);
        try {
            const bytes = type === undefined ? game.readAuxFile(`${resref}.${ext}`) : game.read(resref, type);
            if (!bytes) throw vscode.FileSystemError.FileNotFound(uri);
            this.cacheSet(uri.toString(), bytes);
            return bytes;
        } catch (error) {
            // Same reasoning as `resolve`: a corrupt BIF, a failed inflate and a genuinely absent resource all
            // have to surface as FileNotFound, so the distinction only survives in the log.
            logResourceFailure(uri, error);
            throw vscode.FileSystemError.FileNotFound(uri);
        }
    }

    /**
     * The override file this write would replace, or undefined when it would create one.
     *
     * Answered by the game rather than by probing a path built here: `write` picks its own target, reusing an
     * existing file's on-disk case, and a second derivation of that rule would eventually disagree with it.
     */
    private replacedFile(game: Game, resref: string, ext: string, type: number | undefined): string | undefined {
        return type === undefined ? game.auxFile(`${resref}.${ext}`) : game.looseFile(resref, type);
    }

    /**
     * Confirm a write that would destroy an existing override file, or throw to cancel the save.
     *
     * Writing into `override` is how an edit reaches the game, and it is not in itself dangerous - a resource
     * whose only copy is inside a BIF is merely shadowed, and the archive keeps the original. Replacing a file
     * already in `override` is different: those bytes are the only copy, they usually belong to an installed
     * mod, and nothing in the editor can bring them back.
     */
    private async confirmReplacement(replaced: string): Promise<void> {
        const name = path.basename(replaced);
        const overwrite = "Overwrite";
        const choice = await vscode.window.showWarningMessage(
            `Overwrite ${name} in the game's override folder?`,
            {
                modal: true,
                detail:
                    `${replaced}\n\nThis file was not written by this editing session - an installed mod, ` +
                    `another tool or an earlier session put it there. Saving replaces it, and its current ` +
                    `contents cannot be recovered from here.`,
            },
            overwrite,
        );
        if (choice !== overwrite) {
            // Thrown, never swallowed: returning without writing would leave the tab clean over an unchanged
            // file and lose the edit. VS Code presents the rejection as "Failed to save", which overstates a
            // deliberate cancel - accepted, since the alternative is silent data loss.
            throw new Error(`Save cancelled: ${name} in the override folder was left as it was.`);
        }
    }

    async writeFile(uri: vscode.Uri, content: Uint8Array): Promise<void> {
        const { game, resref, ext, type } = this.resolve(uri);
        const key = uri.toString();
        const replaced = this.written.has(key) ? undefined : this.replacedFile(game, resref, ext, type);
        if (replaced !== undefined) await this.confirmReplacement(replaced);

        // Both land in override/, atomically; game.write also updates the resolution tree in place. A sidecar
        // (type undefined, e.g. .json) is a raw aux file - not a game resource - so it bypasses the tree.
        if (type === undefined) game.writeAuxFile(`${resref}.${ext}`, content);
        else game.write(resref, type, content);
        this.written.add(key);
        this.cacheSet(key, content);
        this._onDidChangeFile.fire([{ type: vscode.FileChangeType.Changed, uri }]);
    }

    stat(uri: vscode.Uri): vscode.FileStat {
        const bytes = this.readFile(uri);
        // Constant timestamps: the viewer is the writer, so VS Code never needs to detect an external change.
        return { type: vscode.FileType.File, ctime: 0, mtime: 0, size: bytes.byteLength };
    }

    delete(uri: vscode.Uri): void {
        const { game, resref, type } = this.resolve(uri);
        if (type === undefined) throw vscode.FileSystemError.NoPermissions(uri); // aux sidecars aren't deletable here
        game.remove(resref, type); // uninstall the override copy; winner falls back to the BIF
        this.cache.delete(uri.toString());
        this._onDidChangeFile.fire([{ type: vscode.FileChangeType.Deleted, uri }]);
    }

    // A single-file bridge: no directory tree, and renaming a resref is out of scope.
    watch(): vscode.Disposable {
        return new vscode.Disposable(() => {});
    }
    readDirectory(): [string, vscode.FileType][] {
        return [];
    }
    createDirectory(): void {}
    rename(): void {
        throw vscode.FileSystemError.NoPermissions("Renaming game resources is not supported.");
    }
}
