/**
 * Serves a compiled Infinity Engine script as read-only text.
 *
 * A filesystem provider rather than a content provider, to match the `.int` view beside it: one mechanism for
 * "a binary file shown as its source" rather than two that behave differently. Every write path refuses,
 * because BAF cannot be compiled back here - see `document.ts`.
 */

import * as fs from "fs";
import * as vscode from "vscode";
import type { BcsSymbols } from "../../../compilers/bcs/src/index";
import { render, sourcePath } from "./document";

/**
 * Resolves the install's naming tables for a document, or undefined when it has no game behind it.
 *
 * Asked about the SOURCE file, never this view's own URI: which game a document belongs to is decided by its
 * scheme, and a resolver that has never heard of `bgforge-bcs` answers "no game" for every script.
 */
export type SymbolsFor = (sourceFile: string) => BcsSymbols | undefined;

export class BcsFileSystemProvider implements vscode.FileSystemProvider {
    private readonly changed = new vscode.EventEmitter<vscode.FileChangeEvent[]>();
    readonly onDidChangeFile = this.changed.event;
    private readonly symbolsFor: SymbolsFor;

    constructor(symbolsFor: SymbolsFor) {
        this.symbolsFor = symbolsFor;
    }

    /** The `.bcs` is watched by the workspace already; nothing here needs a second watcher. */
    watch(): vscode.Disposable {
        return new vscode.Disposable(() => {
            /* nothing is watched, so nothing needs releasing */
        });
    }

    stat(uri: vscode.Uri): vscode.FileStat {
        const file = sourcePath(uri);
        let stats: fs.Stats;
        try {
            stats = fs.statSync(file);
        } catch {
            throw vscode.FileSystemError.FileNotFound(uri);
        }
        return {
            type: vscode.FileType.File,
            ctime: stats.ctimeMs,
            mtime: stats.mtimeMs,
            // The DECOMPILED length, not the file's: it is what the editor is about to read, and a script
            // expands severalfold, so reporting the stored size makes the large-file guard measure the
            // wrong text. Readonly rather than a permission bit, so the tab offers no save to refuse.
            size: Buffer.byteLength(render(file, this.symbolsFor(file)), "utf8"),
            permissions: vscode.FilePermission.Readonly,
        };
    }

    readFile(uri: vscode.Uri): Uint8Array {
        try {
            const file = sourcePath(uri);
            return Buffer.from(render(file, this.symbolsFor(file)), "utf8");
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code === "ENOENT") throw vscode.FileSystemError.FileNotFound(uri);
            throw error;
        }
    }

    writeFile(uri: vscode.Uri): void {
        throw vscode.FileSystemError.NoPermissions(
            `${sourcePath(uri)} is shown as decompiled source, which cannot be compiled back - edit the ` +
                `mod's own .baf and reinstall it instead.`,
        );
    }

    readDirectory(): [string, vscode.FileType][] {
        throw vscode.FileSystemError.NoPermissions("a compiled script is a file, not a directory");
    }

    createDirectory(): void {
        throw vscode.FileSystemError.NoPermissions("a compiled script is a file, not a directory");
    }

    delete(uri: vscode.Uri): void {
        throw vscode.FileSystemError.NoPermissions(
            `delete ${sourcePath(uri)} in the explorer; this view is a rendering of it`,
        );
    }

    rename(oldUri: vscode.Uri): void {
        throw vscode.FileSystemError.NoPermissions(
            `rename ${sourcePath(oldUri)} in the explorer; this view is a rendering of it`,
        );
    }

    dispose(): void {
        this.changed.dispose();
    }
}
