import * as vscode from "vscode";
import { resourceTypeCode, type Game } from "@bgforge/binary";
import { type GameSession } from "./session";
import { parseResourceUri } from "./uri";

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
    // reflects immediately. Populated by stat/readFile, updated by writeFile, dropped by delete.
    private readonly cache = new Map<string, Uint8Array>();
    private readonly session: GameSession;

    constructor(session: GameSession) {
        this.session = session;
    }

    /** Drop cached bytes; call when the open game set changes so a reopened game re-reads from disk. */
    clearCache(): void {
        this.cache.clear();
    }

    // A resource extension resolves to a resType number (routed through game.read/write); any other extension
    // (e.g. the ".json" snapshot sidecar) has `type: undefined` and is stored as a raw aux file in override.
    private resolve(uri: vscode.Uri): { game: Game; resref: string; ext: string; type: number | undefined } {
        const { gameDir, resref, ext } = parseResourceUri(uri);
        // Open the game on demand from the URI's own gameDir: a reload restores the editor (and this provider)
        // before the view re-opens the game, so `game(gameDir)` would be empty and readback would fail.
        let game: Game;
        try {
            game = this.session.ensureOpen(gameDir);
        } catch {
            throw vscode.FileSystemError.FileNotFound(uri);
        }
        return { game, resref, ext, type: resourceTypeCode(ext) };
    }

    readFile(uri: vscode.Uri): Uint8Array {
        const cached = this.cache.get(uri.toString());
        if (cached) return cached;
        const { game, resref, ext, type } = this.resolve(uri);
        try {
            const bytes = type === undefined ? game.readAuxFile(`${resref}.${ext}`) : game.read(resref, type);
            if (!bytes) throw vscode.FileSystemError.FileNotFound(uri);
            this.cache.set(uri.toString(), bytes);
            return bytes;
        } catch {
            throw vscode.FileSystemError.FileNotFound(uri);
        }
    }

    writeFile(uri: vscode.Uri, content: Uint8Array): void {
        const { game, resref, ext, type } = this.resolve(uri);
        // Both land in override/, atomically; game.write also updates the resolution tree in place. A sidecar
        // (type undefined, e.g. .json) is a raw aux file - not a game resource - so it bypasses the tree.
        if (type === undefined) game.writeAuxFile(`${resref}.${ext}`, content);
        else game.write(resref, type, content);
        this.cache.set(uri.toString(), content);
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
