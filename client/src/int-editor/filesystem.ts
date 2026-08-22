/**
 * Serves a compiled script as an editable text file: reading decompiles it, writing compiles it back.
 *
 * A filesystem provider rather than a content provider because a content provider is read-only, and a
 * compiled script is worth editing - the whole point of showing it as source. VS Code drives its own
 * dirty state, undo and save gestures against this, so the editor behaves as an editor rather than as a
 * viewer with a command attached.
 *
 * The write target is the `.int` itself. Nothing is written beside it and no intermediate `.ssl` is
 * created: the decompiled text is a rendering of the file, not a second copy of it that could drift.
 */

import * as fs from "fs";
import * as vscode from "vscode";
import { problemsOf } from "../../../compilers/ssl/src/problems";
import { compileForSave } from "./compiler";
import { LISTING_MARKER, render, sourcePath } from "./document";

/** Diagnostics for a save that would not compile, so the errors land where every other one does. */
const problems = vscode.languages.createDiagnosticCollection("bgforge-int");

/**
 * Records why a save was refused, and returns the sentence to put on the failure itself. Both come from
 * the same reading of the error the language server uses, so a refusal shape it understands is one this
 * understands too - the alternative is an editor that degrades to a raw stack message on whichever
 * refusal it was not written against.
 */
function reportRefusal(uri: vscode.Uri, file: string, error: unknown): string {
    const found = problemsOf(error);
    problems.set(
        uri,
        found.map((problem) => {
            // Problems are 1-based on both axes and 0 where unlocated; VS Code's are 0-based.
            const at = new vscode.Position(Math.max(0, problem.line - 1), Math.max(0, problem.column - 1));
            return new vscode.Diagnostic(new vscode.Range(at, at), problem.message, vscode.DiagnosticSeverity.Error);
        }),
    );
    // The first problem rather than a count: this becomes the text on the save failure, and the rest are
    // in the Problems panel a moment later.
    const first = found[0];
    const rest = found.length > 1 ? ` (and ${found.length - 1} more)` : "";
    return first
        ? `${file} was not saved - it does not compile. ${first.line}:${first.column}: ${first.message}${rest}`
        : `${file} was not saved - it does not compile.`;
}

export class IntFileSystemProvider implements vscode.FileSystemProvider {
    private readonly changed = new vscode.EventEmitter<vscode.FileChangeEvent[]>();
    readonly onDidChangeFile = this.changed.event;
    private readonly extensionPath: string;

    constructor(extensionPath: string) {
        this.extensionPath = extensionPath;
    }

    /** The `.int` is watched by the workspace already; nothing here needs a second watcher. */
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
        // The size is the DECOMPILED length rather than the file's: it is what the editor is about to
        // read, and reporting the compiled size makes VS Code's large-file guard measure the wrong text.
        return {
            type: vscode.FileType.File,
            ctime: stats.ctimeMs,
            mtime: stats.mtimeMs,
            size: Buffer.byteLength(render(file), "utf8"),
        };
    }

    readFile(uri: vscode.Uri): Uint8Array {
        // Reading is also the REVERT path, and what it produces is the file on disk - which compiles by
        // construction, since it came out of a compiled script. Whatever a refused save left in the
        // Problems panel describes text that no longer exists.
        problems.delete(uri);
        try {
            return Buffer.from(render(sourcePath(uri)), "utf8");
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code === "ENOENT") throw vscode.FileSystemError.FileNotFound(uri);
            throw error;
        }
    }

    async writeFile(uri: vscode.Uri, content: Uint8Array): Promise<void> {
        const file = sourcePath(uri);
        const text = Buffer.from(content).toString("utf8");
        if (text.includes(LISTING_MARKER)) {
            throw new Error(
                `${file} opened as a disassembly listing because it could not be decompiled, so there is ` +
                    `no source to compile back. Edit the original .ssl and compile it instead.`,
            );
        }
        const previous = new Uint8Array(fs.readFileSync(file));
        let compiled: Uint8Array;
        try {
            compiled = await compileForSave(this.extensionPath, text, previous);
        } catch (error) {
            // Every refusal is reported the same way rather than only the ones this knows by class: the
            // front end throws a different error type per stage, and a save must not write the file on
            // any of them.
            throw new Error(reportRefusal(uri, file, error), { cause: error });
        }
        problems.delete(uri);
        fs.writeFileSync(file, compiled);
        this.changed.fire([{ type: vscode.FileChangeType.Changed, uri }]);
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
        problems.dispose();
        this.changed.dispose();
    }
}
