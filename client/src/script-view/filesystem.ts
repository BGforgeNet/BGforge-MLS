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
 *
 * The source is addressed by `vscode.Uri`, not by path, and every read/write goes through `vscode.workspace.fs`.
 * That routes each source to whichever provider owns it - the real filesystem for `file:`, the game archive
 * bridge for `bgforge-ie-resource:` - with no branching here: a compiled script living inside a BIF is served
 * exactly like one on disk.
 */

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
     * Appended to the source's URI path to name the view document, so the tab reads as source and every
     * language feature keyed on the extension applies. Both directions come from this one value.
     */
    readonly viewSuffix: string;
    /** The document body: the source rendered as source, or why there is none to show. */
    render(source: vscode.Uri): Promise<string>;
    /** Compiles edited text into the bytes that replace the source. */
    compile(source: vscode.Uri, text: string): Promise<Uint8Array>;
    /** The located problems inside a failed compile; empty when it carries none. */
    problemsOf(error: unknown): readonly ScriptViewProblem[];
    /**
     * Why this source cannot be saved back AT ALL, or undefined when it can - a property of the source, so it
     * is also what marks the tab read-only before an edit is attempted. Views whose every document is writable
     * omit it.
     */
    refuseFile?(source: vscode.Uri): Promise<string | undefined>;
    /**
     * Why this TEXT cannot be compiled back, or undefined - a property of what the buffer now holds, which
     * only a save can know. Views whose rendering is always source omit it.
     */
    refuseText?(source: vscode.Uri, text: string): string | undefined;
    /** Extra detail for the failure sentence when a compile error carries no located problems. */
    detailOf?(error: unknown): string;
}

/**
 * The view URI for a source: named `<source path><viewSuffix>` so the tab reads as source, carrying the
 * source's own URI in a `src` query so `sourceUriOf` can recover it. The path alone cannot express the source,
 * since a source is not always a file: a tree-opened script's source is a `bgforge-ie-resource:` URI, which
 * `.path` names but which no other view URI's path could stand in for.
 */
export function buildViewUri(scheme: string, viewSuffix: string, source: vscode.Uri): vscode.Uri {
    return vscode.Uri.from({
        scheme,
        path: `${source.path}${viewSuffix}`,
        query: `src=${encodeURIComponent(source.toString())}`,
    });
}

/** The source a view URI stands for - the inverse of `buildViewUri`, read the same way on both sides. */
export function sourceUriOf(view: vscode.Uri): vscode.Uri {
    const src = new URLSearchParams(view.query).get("src");
    if (src === null) throw new Error(`${view.toString()} carries no source`);
    return vscode.Uri.parse(src);
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
     * The last render of a source, keyed by its URI and mtime. `stat` has to report the RENDERED length (it is
     * the text VS Code is about to read, and the stored size would make its large-file guard measure the wrong
     * thing), and `readFile` then produces the identical string moments later - so without this, opening or
     * saving a document renders it twice, and VS Code calls `stat` more often than that.
     */
    private rendered: { uri: string; mtimeMs: number; text: string } | undefined;

    constructor(view: ScriptView) {
        this.view = view;
        this.problems = vscode.languages.createDiagnosticCollection(view.diagnostics);
    }

    /** The source a view URI stands for. */
    private sourceUri(uri: vscode.Uri): vscode.Uri {
        return sourceUriOf(uri);
    }

    /** `vscode.workspace.fs.stat`, reporting a missing or unreadable source as the VIEW URI's FileNotFound. */
    private async statSource(source: vscode.Uri, viewUri: vscode.Uri): Promise<vscode.FileStat> {
        try {
            return await vscode.workspace.fs.stat(source);
        } catch {
            throw vscode.FileSystemError.FileNotFound(viewUri);
        }
    }

    private async renderCached(source: vscode.Uri, mtimeMs: number): Promise<string> {
        const key = source.toString();
        const hit = this.rendered;
        if (hit && hit.uri === key && hit.mtimeMs === mtimeMs) return hit.text;
        const text = await this.view.render(source);
        this.rendered = { uri: key, mtimeMs, text };
        return text;
    }

    /** The `.int` / `.bcs` is watched by the workspace already; nothing here needs a second watcher. */
    watch(): vscode.Disposable {
        return new vscode.Disposable(() => {
            /* nothing is watched, so nothing needs releasing */
        });
    }

    async stat(uri: vscode.Uri): Promise<vscode.FileStat> {
        const source = this.sourceUri(uri);
        const stats = await this.statSource(source, uri);
        const text = await this.renderCached(source, stats.mtime);
        return {
            type: vscode.FileType.File,
            ctime: stats.ctime,
            mtime: stats.mtime,
            size: Buffer.byteLength(text, "utf8"),
            // A document that cannot be written back offers no save to refuse, rather than refusing one at
            // the end of the gesture.
            ...((await this.view.refuseFile?.(source)) === undefined
                ? {}
                : { permissions: vscode.FilePermission.Readonly }),
        };
    }

    async readFile(uri: vscode.Uri): Promise<Uint8Array> {
        // Reading is also the REVERT path, and what it produces is the source - which compiles by
        // construction, since it came out of a compiled source. Whatever a refused save left in the Problems
        // panel describes text that no longer exists.
        this.problems.delete(uri);
        const source = this.sourceUri(uri);
        const stats = await this.statSource(source, uri);
        const text = await this.renderCached(source, stats.mtime);
        return Buffer.from(text, "utf8");
    }

    async writeFile(uri: vscode.Uri, content: Uint8Array): Promise<void> {
        const source = this.sourceUri(uri);
        const text = Buffer.from(content).toString("utf8");
        const refused = (await this.view.refuseFile?.(source)) ?? this.view.refuseText?.(source, text);
        if (refused !== undefined) throw new Error(refused);

        let compiled: Uint8Array;
        try {
            compiled = await this.view.compile(source, text);
        } catch (error) {
            // Every refusal is reported the same way rather than only the ones this knows by class: a compiler
            // throws a different error type per stage, and a save must not write the source on any of them.
            throw new Error(this.reportRefusal(uri, source, error), { cause: error });
        }
        this.problems.delete(uri);
        await vscode.workspace.fs.writeFile(source, compiled);
        // The rendering this cached describes the bytes that were just replaced.
        this.rendered = undefined;
        this.changed.fire([{ type: vscode.FileChangeType.Changed, uri }]);
    }

    /**
     * Records why a save was refused, and returns the sentence to put on the failure itself. Both come from
     * the same list of problems, so the tab's message and the Problems panel cannot disagree about what went
     * wrong.
     */
    private reportRefusal(uri: vscode.Uri, source: vscode.Uri, error: unknown): string {
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
            return `${source.fsPath} was not saved - it does not compile. ${first.line}:${first.column}: ${first.message}${rest}`;
        const detail = this.view.detailOf?.(error);
        return `${source.fsPath} was not saved - it does not compile.${detail === undefined ? "" : ` ${detail}`}`;
    }

    readDirectory(): [string, vscode.FileType][] {
        throw vscode.FileSystemError.NoPermissions("a compiled script is a file, not a directory");
    }

    createDirectory(): void {
        throw vscode.FileSystemError.NoPermissions("a compiled script is a file, not a directory");
    }

    delete(uri: vscode.Uri): void {
        throw vscode.FileSystemError.NoPermissions(
            `delete ${this.sourceUri(uri).fsPath} in the explorer; this view is a rendering of it`,
        );
    }

    rename(oldUri: vscode.Uri): void {
        throw vscode.FileSystemError.NoPermissions(
            `rename ${this.sourceUri(oldUri).fsPath} in the explorer; this view is a rendering of it`,
        );
    }

    dispose(): void {
        this.problems.dispose();
        this.changed.dispose();
    }
}
