/**
 * Serves a compiled Infinity Engine script as editable text: reading decompiles it, writing compiles it back.
 *
 * A filesystem provider rather than a content provider, to match the `.int` view beside it: one mechanism for
 * "a binary file shown as its source" rather than two that behave differently. VS Code drives its own dirty
 * state, undo and save gestures against this, so the editor behaves as an editor rather than as a viewer.
 *
 * The write target is the `.bcs` itself. Nothing is written beside it and no intermediate `.baf` is created:
 * the decompiled text is a rendering of the file, not a second copy of it that could drift.
 */

import * as fs from "fs";
import * as vscode from "vscode";
import { BcsCompileError } from "../../../compilers/bcs/src/index";
import { compileForSave } from "./compiler";
import { render, sourcePath, type BcsNaming } from "./document";

/** Diagnostics for a save that would not compile, so the errors land where every other one does. */
const problems = vscode.languages.createDiagnosticCollection("bgforge-bcs");

/**
 * Resolves the install's naming tables and engine for a document, or undefined when it has no game behind it.
 *
 * Asked about the SOURCE file, never this view's own URI: which game a document belongs to is decided by its
 * scheme, and a resolver that has never heard of `bgforge-bcs` answers "no game" for every script.
 */
export type SymbolsFor = (sourceFile: string) => BcsNaming | undefined;

/**
 * Records why a save was refused, and returns the sentence to put on the failure itself.
 *
 * Both come from the same list of problems, so the tab's message and the Problems panel cannot disagree about
 * what went wrong.
 */
function reportRefusal(uri: vscode.Uri, file: string, error: unknown): string {
    const found = error instanceof BcsCompileError ? error.diagnostics : [];
    problems.set(
        uri,
        found.map((problem) => {
            // Problems are 1-based on both axes; VS Code's positions are 0-based.
            const at = new vscode.Position(Math.max(0, problem.line - 1), Math.max(0, problem.column - 1));
            return new vscode.Diagnostic(new vscode.Range(at, at), problem.message, vscode.DiagnosticSeverity.Error);
        }),
    );
    // The first problem rather than a count: this becomes the text on the save failure, and the rest are in
    // the Problems panel a moment later.
    const first = found[0];
    const rest = found.length > 1 ? ` (and ${found.length - 1} more)` : "";
    return first
        ? `${file} was not saved - it does not compile. ${first.line}:${first.column}: ${first.message}${rest}`
        : `${file} was not saved - it does not compile. ${error instanceof Error ? error.message : String(error)}`;
}

export class BcsFileSystemProvider implements vscode.FileSystemProvider {
    private readonly changed = new vscode.EventEmitter<vscode.FileChangeEvent[]>();
    readonly onDidChangeFile = this.changed.event;
    private readonly symbolsFor: SymbolsFor;
    private readonly extensionPath: string;

    constructor(symbolsFor: SymbolsFor, extensionPath: string) {
        this.symbolsFor = symbolsFor;
        this.extensionPath = extensionPath;
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
            // wrong text.
            size: Buffer.byteLength(render(file, this.symbolsFor(file)), "utf8"),
            // What the tab shows with no game, or for a file holding no script, is a notice rather than
            // source - so the tab offers no save to refuse rather than refusing one at the end.
            ...(this.refusal(file) === undefined ? {} : { permissions: vscode.FilePermission.Readonly }),
        };
    }

    /**
     * Why a save could not write this document back, or undefined when it can.
     *
     * ONE definition, read by `stat` to mark the tab readonly and by `writeFile` to refuse: what the tab
     * shows in these cases is a notice rather than source, and compiling a notice would write a script with
     * no blocks over the file. Two predicates that drifted apart would leave exactly that gap.
     */
    private refusal(file: string): string | undefined {
        if (this.symbolsFor(file) === undefined) {
            return (
                `${file} cannot be saved without the game it belongs to: every name in it is a number that ` +
                `install's own tables give a meaning to. Open a game, then reopen this file.`
            );
        }
        // A zero-byte file is a real thing an install ships, and is not a script with no blocks.
        if (fs.statSync(file).size === 0) return `${file} holds no script, so there is nothing to compile into it.`;
        return undefined;
    }

    readFile(uri: vscode.Uri): Uint8Array {
        // Reading is also the REVERT path, and what it produces is the file on disk - which compiles by
        // construction, since it came out of a compiled script. Whatever a refused save left in the Problems
        // panel describes text that no longer exists.
        problems.delete(uri);
        try {
            const file = sourcePath(uri);
            return Buffer.from(render(file, this.symbolsFor(file)), "utf8");
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code === "ENOENT") throw vscode.FileSystemError.FileNotFound(uri);
            throw error;
        }
    }

    async writeFile(uri: vscode.Uri, content: Uint8Array): Promise<void> {
        const file = sourcePath(uri);
        const refused = this.refusal(file);
        if (refused !== undefined) throw new Error(refused);
        // Established by the refusal above, which is the only thing that reports a document with no game.
        const naming = this.symbolsFor(file)!;
        let compiled: Buffer;
        try {
            compiled = await compileForSave(this.extensionPath, Buffer.from(content).toString("utf8"), naming);
        } catch (error) {
            // Every refusal is reported the same way rather than only the ones this knows by class: a save
            // must not write the file on any of them.
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
        this.changed.dispose();
        problems.dispose();
    }
}
