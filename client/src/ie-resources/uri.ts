import * as path from "path";
import * as vscode from "vscode";

/**
 * A game resource is addressed by a `bgforge-ie-resource:` URI whose path is `<resref>.<ext>` (so the binary custom
 * editor matches by extension) and whose query carries the game directory (so the FileSystemProvider can route
 * back to the right open Game). The FS provider bridges read -> game.read and write -> game.write (override).
 */
export const GAME_RESOURCE_SCHEME = "bgforge-ie-resource";

export function resourceUri(gameDir: string, resref: string, ext: string): vscode.Uri {
    const query = new URLSearchParams({ g: gameDir }).toString();
    return vscode.Uri.from({
        scheme: GAME_RESOURCE_SCHEME,
        path: `/${resref.toLowerCase()}.${ext.toLowerCase()}`,
        query,
    });
}

export interface ParsedResourceUri {
    gameDir: string;
    resref: string;
    ext: string;
}

export function parseResourceUri(uri: vscode.Uri): ParsedResourceUri {
    const gameDir = new URLSearchParams(uri.query).get("g") ?? "";
    const base = path.posix.basename(uri.path);
    const dot = base.lastIndexOf(".");
    return {
        gameDir,
        resref: dot === -1 ? base : base.slice(0, dot),
        ext: dot === -1 ? "" : base.slice(dot + 1),
    };
}
