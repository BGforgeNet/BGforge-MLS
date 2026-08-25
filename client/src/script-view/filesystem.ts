/**
 * Serves a compiled file as editable text: reading renders it as source, writing compiles it back.
 *
 * One provider for every such view. A `.int` shown as SSL and a `.bcs` shown as BAF differ only in what
 * "render" and "compile" mean - the rest (dirty state, revert, the refusal path, the Problems entries, the
 * directory operations a single file has no answer for) is one mechanism, and was two copies of it.
 *
 * A filesystem provider rather than a content provider, because a content provider is read-only and a compiled
 * script is worth editing - the whole point of showing it as source. VS Code drives its own dirty state, undo
 * and save gestures against this, so the editor behaves as an editor rather than as a viewer with a command.
 *
 * The write target is the compiled file itself. Nothing is written beside it and no intermediate source file is
 * created: the rendered text is a rendering of the file, not a second copy of it that could drift.
 */

import * as fs from "fs";
import * as vscode from "vscode";

/** One located complaint from a failed compile, in the shape the Problems panel needs. */
export interface ScriptViewProblem {
    /** 1-based, as a compiler counts them. */
    readonly line: number;
    readonly column: number;
    readonly message: string;
}

/** What makes one script view differ from another. Everything else is shared. */
export interface ScriptView {
    /** The custom URI scheme this view is served on. */
    readonly scheme: string;
    /** Names the diagnostic collection a refused save reports through. */
    readonly diagnostics: string;
    /**
     * Appended to the compiled file's path to name the view document, so the tab reads as source and every
     * language feature keyed on the extension applies. Both directions come from this one value.
     */
    readonly viewSuffix: string;
    /** The document body: the file rendered as source, or why there is none to show. */
    render(file: string): string;
    /** Compiles edited text into the bytes that replace the file. */
    compile(file: string, text: string): Promise<Uint8Array>;
    /** The located problems inside a failed compile; empty when it carries none. */
    problemsOf(error: unknown): readonly ScriptViewProblem[];
    /**
     * Why this file cannot be saved back AT ALL, or undefined when it can - a property of the file, so it is
     * also what marks the tab read-only before an edit is attempted. Views whose every document is writable
     * omit it.
     */
    refuseFile?(file: string): string | undefined;
    /**
     * Why this TEXT cannot be compiled back, or undefined - a property of what the buffer now holds, which
     * only a save can know. Views whose rendering is always source omit it.
     */
    refuseText?(file: string, text: string): string | undefined;
    /** Extra detail for the failure sentence when a compile error carries no located problems. */
    detailOf?(error: unknown): string;
}

export class ScriptViewFileSystemProvider implements vscode.FileSystemProvider {
    private readonly changed = new vscode.EventEmitter<vscode.FileChangeEvent[]>();
    readonly onDidChangeFile = this.changed.event;
    private readonly view: ScriptView;
    /**
     * Owned by the provider, not the module: a collection created at import time and disposed from an instance
     * method leaves a second provider - a reactivation, or a test constructing two - writing into a disposed
     * collection.
     */
    private readonly problems: vscode.DiagnosticCollection;
    /**
     * The last render of a file, keyed by path and mtime. `stat` has to report the RENDERED length (it is the
     * text VS Code is about to read, and the stored size would make its large-file guard measure the wrong
     * thing), and `readFile` then produces the identical string moments later - so without this, opening or
     * saving a document renders it twice, and VS Code calls `stat` more often than that.
     */
    private rendered: { file: string; mtimeMs: number; text: string } | undefined;

    constructor(view: ScriptView) {
        this.view = view;
        this.problems = vscode.languages.createDiagnosticCollection(view.diagnostics);
    }

    /** The compiled file a view URI stands for. */
    private sourcePath(uri: vscode.Uri): string {
        return uri.path.endsWith(this.view.viewSuffix) ? uri.path.slice(0, -this.view.viewSuffix.length) : uri.path;
    }

    private renderCached(file: string, mtimeMs: number): string {
        const hit = this.rendered;
        if (hit && hit.file === file && hit.mtimeMs === mtimeMs) return hit.text;
        const text = this.view.render(file);
        this.rendered = { file, mtimeMs, text };
        return text;
    }

    /** The `.int` / `.bcs` is watched by the workspace already; nothing here needs a second watcher. */
    watch(): vscode.Disposable {
        return new vscode.Disposable(() => {
            /* nothing is watched, so nothing needs releasing */
        });
    }

    stat(uri: vscode.Uri): vscode.FileStat {
        const file = this.sourcePath(uri);
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
            size: Buffer.byteLength(this.renderCached(file, stats.mtimeMs), "utf8"),
            // A document that cannot be written back offers no save to refuse, rather than refusing one at
            // the end of the gesture.
            ...(this.view.refuseFile?.(file) === undefined ? {} : { permissions: vscode.FilePermission.Readonly }),
        };
    }

    readFile(uri: vscode.Uri): Uint8Array {
        // Reading is also the REVERT path, and what it produces is the file on disk - which compiles by
        // construction, since it came out of a compiled file. Whatever a refused save left in the Problems
        // panel describes text that no longer exists.
        this.problems.delete(uri);
        try {
            const file = this.sourcePath(uri);
            return Buffer.from(this.renderCached(file, fs.statSync(file).mtimeMs), "utf8");
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code === "ENOENT") throw vscode.FileSystemError.FileNotFound(uri);
            throw error;
        }
    }

    async writeFile(uri: vscode.Uri, content: Uint8Array): Promise<void> {
        const file = this.sourcePath(uri);
        const text = Buffer.from(content).toString("utf8");
        const refused = this.view.refuseFile?.(file) ?? this.view.refuseText?.(file, text);
        if (refused !== undefined) throw new Error(refused);

        let compiled: Uint8Array;
        try {
            compiled = await this.view.compile(file, text);
        } catch (error) {
            // Every refusal is reported the same way rather than only the ones this knows by class: a compiler
            // throws a different error type per stage, and a save must not write the file on any of them.
            throw new Error(this.reportRefusal(uri, file, error), { cause: error });
        }
        this.problems.delete(uri);
        fs.writeFileSync(file, compiled);
        // The rendering this cached describes the bytes that were just replaced.
        this.rendered = undefined;
        this.changed.fire([{ type: vscode.FileChangeType.Changed, uri }]);
    }

    /**
     * Records why a save was refused, and returns the sentence to put on the failure itself. Both come from
     * the same list of problems, so the tab's message and the Problems panel cannot disagree about what went
     * wrong.
     */
    private reportRefusal(uri: vscode.Uri, file: string, error: unknown): string {
        const found = this.view.problemsOf(error);
        this.problems.set(
            uri,
            found.map((problem) => {
                // Problems are 1-based on both axes and 0 where unlocated; VS Code's positions are 0-based.
                const at = new vscode.Position(Math.max(0, problem.line - 1), Math.max(0, problem.column - 1));
                return new vscode.Diagnostic(
                    new vscode.Range(at, at),
                    problem.message,
                    vscode.DiagnosticSeverity.Error,
                );
            }),
        );
        // The first problem rather than a count: this becomes the text on the save failure, and the rest are in
        // the Problems panel a moment later.
        const first = found[0];
        const rest = found.length > 1 ? ` (and ${found.length - 1} more)` : "";
        if (first)
            return `${file} was not saved - it does not compile. ${first.line}:${first.column}: ${first.message}${rest}`;
        const detail = this.view.detailOf?.(error);
        return `${file} was not saved - it does not compile.${detail === undefined ? "" : ` ${detail}`}`;
    }

    readDirectory(): [string, vscode.FileType][] {
        throw vscode.FileSystemError.NoPermissions("a compiled script is a file, not a directory");
    }

    createDirectory(): void {
        throw vscode.FileSystemError.NoPermissions("a compiled script is a file, not a directory");
    }

    delete(uri: vscode.Uri): void {
        throw vscode.FileSystemError.NoPermissions(
            `delete ${this.sourcePath(uri)} in the explorer; this view is a rendering of it`,
        );
    }

    rename(oldUri: vscode.Uri): void {
        throw vscode.FileSystemError.NoPermissions(
            `rename ${this.sourcePath(oldUri)} in the explorer; this view is a rendering of it`,
        );
    }

    dispose(): void {
        this.problems.dispose();
        this.changed.dispose();
    }
}
