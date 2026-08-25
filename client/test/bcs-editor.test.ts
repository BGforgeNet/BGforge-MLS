/**
 * The compiled-Infinity-Engine-script editor, exercised against real stored bytes.
 *
 * Both directions run for real: a `.bcs` is written to a temp directory, the provider decompiles it, and a
 * save compiles the source back over it with the same grammar and tables the extension ships. What is pinned
 * is that an untouched script saves as itself, that an edit reaches the stored bytes, and that a script with
 * no game behind it is left alone rather than written from a notice.
 *
 * The redirect that opens a `.bcs` as source is covered as far as the calls it makes: which document it asks
 * for, which language it sets, which group it shows it in, and that it closes its own panel. What those calls
 * DO is VS Code's.
 *
 * The provider now reads and writes through `vscode.workspace.fs` rather than a bare fs path, so it can serve
 * a source living inside a game archive as well as one on disk. The mock below bridges `workspace.fs` to real
 * node `fs` for `file:` sources - the only kind these tests need - so the same real-bytes round trip still
 * runs; routing a `bgforge-ie-resource:` source to the archive bridge is VS Code's own contract, already
 * established elsewhere, not something this suite re-proves.
 */

import { describe, expect, it, vi } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

// Hoisted so the vi.mock factory, which runs before the module body, can close over them.
const h = vi.hoisted(() => {
    class FakeUri {
        readonly scheme: string;
        readonly path: string;
        readonly query: string;
        constructor(scheme: string, uriPath: string, query = "") {
            this.scheme = scheme;
            this.path = uriPath;
            this.query = query;
        }
        get fsPath() {
            return this.path;
        }
        toString() {
            return this.query ? `${this.scheme}:${this.path}?${this.query}` : `${this.scheme}:${this.path}`;
        }
        static parse(s: string): FakeUri {
            const q = s.indexOf("?");
            const withoutQuery = q === -1 ? s : s.slice(0, q);
            const query = q === -1 ? "" : s.slice(q + 1);
            const colon = withoutQuery.indexOf(":");
            return new FakeUri(withoutQuery.slice(0, colon), withoutQuery.slice(colon + 1), query);
        }
    }
    class FileSystemError extends Error {
        override name = "FileSystemError";
        static FileNotFound = (uri: unknown) => new FileSystemError(`not found: ${String(uri)}`);
        static NoPermissions = (why: string) => new FileSystemError(why);
    }
    return {
        FakeUri,
        FileSystemError,
        opened: [] as string[],
        unopenable: new Set<string>(),
        /** Paths the fake host rejects for, mapped to the reason - which is not always an `Error`. */
        rejectWith: new Map<string, unknown>(),
        languages: [] as string[],
        shownIn: [] as (number | undefined)[],
        errors: [] as string[],
        diagnostics: [] as { message: string }[],
        disposedPanels: 0,
        editor: {
            provider: undefined as
                | {
                      openCustomDocument(uri: unknown): { uri: unknown };
                      resolveCustomEditor(document: { uri: unknown }, panel: unknown): Promise<void>;
                  }
                | undefined,
        },
    };
});

vi.mock("vscode", () => ({
    // FakeUri already carries a static `parse`; assigning `from` onto the same class object is enough to make
    // both reachable as `Uri.from`/`Uri.parse` without shadowing `parse` with a wrapper that calls itself.
    Uri: Object.assign(h.FakeUri, {
        from: (parts: { scheme: string; path: string; query?: string }) =>
            new h.FakeUri(parts.scheme, parts.path, parts.query ?? ""),
    }),
    EventEmitter: class {
        event = () => undefined;
        fire() {}
        dispose() {}
    },
    Disposable: class {
        dispose: () => void;
        static from = (...parts: unknown[]) => ({ parts });
        constructor(onDispose: () => void) {
            this.dispose = onDispose;
        }
    },
    FileSystemError: h.FileSystemError,
    FileType: { File: 1 },
    FileChangeType: { Changed: 1 },
    FilePermission: { Readonly: 1 },
    languages: {
        setTextDocumentLanguage: (_document: unknown, language: string) => {
            h.languages.push(language);
            return Promise.resolve({});
        },
        createDiagnosticCollection: () => ({
            set: (_uri: unknown, found: { message: string }[]) => {
                h.diagnostics.length = 0;
                h.diagnostics.push(...found);
            },
            delete: () => {
                h.diagnostics.length = 0;
            },
            dispose: () => undefined,
        }),
    },
    // Only the message is read back, so a position and a range need carry nothing but their arguments.
    Position: function (this: Record<string, unknown>, line: number, character: number) {
        Object.assign(this, { line, character });
    },
    Range: function (this: Record<string, unknown>, start: unknown, end: unknown) {
        Object.assign(this, { start, end });
    },
    Diagnostic: class {
        message: string;
        constructor(_range: unknown, message: string) {
            this.message = message;
        }
    },
    DiagnosticSeverity: { Error: 0 },
    workspace: {
        registerFileSystemProvider: () => ({}),
        // Bridges to real node fs for `file:` sources, the only kind these tests write - the same real bytes
        // a `.bcs` on disk holds, reached the way VS Code itself reaches them rather than a bare fs path.
        fs: {
            stat: (uri: { path: string }) => {
                const stats = fs.statSync(uri.path);
                return Promise.resolve({ type: 1, ctime: stats.ctimeMs, mtime: stats.mtimeMs, size: stats.size });
            },
            readFile: (uri: { path: string }) => Promise.resolve(new Uint8Array(fs.readFileSync(uri.path))),
            writeFile: (uri: { path: string }, content: Uint8Array) => {
                fs.writeFileSync(uri.path, content);
                return Promise.resolve();
            },
        },
        openTextDocument: (uri: { path: string }) => {
            // Held as data rather than written inline: a host can reject with something that is not an
            // Error, and the reason has to reach the user either way, so the tests supply both shapes.
            const reason = h.rejectWith.get(uri.path);
            if (reason !== undefined) return Promise.reject(reason);
            if (h.unopenable.has(uri.path)) return Promise.reject(new Error("file not found"));
            h.opened.push(uri.path);
            return Promise.resolve({ uri });
        },
    },
    window: {
        registerCustomEditorProvider: (_type: string, provider: never) => {
            h.editor.provider = provider;
            return {};
        },
        showTextDocument: (_document: unknown, options: { viewColumn?: number }) => {
            h.shownIn.push(options.viewColumn);
            return Promise.resolve({});
        },
        showErrorMessage: (message: string) => h.errors.push(message),
    },
}));

import type { BcsCompileSymbols, BcsSymbols } from "../../compilers/bcs/src/index";
import { REPO_ROOT } from "./repo-root";
import { viewUri } from "../src/bcs-editor/document";
import { BcsFileSystemProvider } from "../src/bcs-editor/filesystem";
import { registerBcsEditor } from "../src/bcs-editor/register";

// One block: a False() condition and a Continue() response, in the marker form a real file uses.
const SCRIPT =
    'SC\nCR\nCO\nTR\n16432 0 0 0 0"" ""OB\n0 0 0 0 0 0 0 0 0 0 0 0 ""OB\nTR\nCO\nRS\nRE\n100AC\n36OB\n' +
    '0 0 0 0 0 0 0 0 0 0 0 0 ""OB\nOB\n0 0 0 0 0 0 0 0 0 0 0 0 ""OB\nOB\n0 0 0 0 0 0 0 0 0 0 0 0 ""OB\n' +
    '0 0 0 0 0"" ""AC\nRE\nRS\nCR\nSC\n';

const SYMBOLS: BcsSymbols = {
    trigger: (id) => (id === 16432 ? ["False()"] : []),
    action: (id) => (id === 36 ? ["Continue()"] : []),
    ids: () => undefined,
};

/** The same two rows read the other way, as an open game supplies them. */
const COMPILE_SYMBOLS: BcsCompileSymbols = {
    triggerByName: (name) => (name.toLowerCase() === "false" ? [{ id: 16432, signature: "False()" }] : []),
    actionByName: (name) => (name.toLowerCase() === "continue" ? [{ id: 36, signature: "Continue()" }] : []),
    idsAll: () => undefined,
};

const NAMING = { symbols: SYMBOLS, compileSymbols: COMPILE_SYMBOLS, engine: "bg" } as const;

/** The grammar the compiler loads ships in the server's build output, which the repo root holds. */
const newProvider = (naming: () => typeof NAMING | undefined = () => NAMING): BcsFileSystemProvider =>
    new BcsFileSystemProvider(naming, REPO_ROOT);

/** A `.bcs` on disk plus the view URI that renders it, built the same way production does. */
function script(): { file: string; view: never } {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bgforge-bcs-view-"));
    const file = path.join(dir, "AERIE.bcs");
    fs.writeFileSync(file, SCRIPT, "latin1");
    return { file, view: viewUri(new h.FakeUri("file", file) as never) as never };
}

describe("the .bcs custom editor", () => {
    it("reads a compiled script as decompiled source", async () => {
        const { view } = script();
        const provider = newProvider();

        const text = Buffer.from(await provider.readFile(view)).toString("utf8");

        expect(text).toBe(["IF", "  False()", "THEN", "  RESPONSE #100", "    Continue()", "END", ""].join("\n"));
    });

    /**
     * The size has to be the DECOMPILED length: it is the text the editor is about to read, and a script
     * expands severalfold, so reporting the stored size makes the large-file guard measure the wrong thing.
     */
    it("reports the decompiled size rather than the stored one", async () => {
        const { file, view } = script();
        const provider = newProvider();

        const stat = await provider.stat(view);

        expect(stat.size).toBe(Buffer.byteLength(Buffer.from(await provider.readFile(view)).toString("utf8"), "utf8"));
        expect(stat.size).not.toBe(fs.statSync(file).size);
    });

    it("is editable with a game behind it and readonly without one", async () => {
        const { view } = script();

        const withGame = await newProvider().stat(view);
        expect(withGame.permissions).toBeUndefined();
        // What the tab shows with no game is a notice, not source, so it offers no save to refuse.
        const withoutGame = await newProvider(() => undefined).stat(view);
        expect(withoutGame.permissions).toBe(1);
    });

    it("leaves a file holding no script readonly, notice and all", async () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bgforge-bcs-empty-"));
        const file = path.join(dir, "EMPTY.bcs");
        fs.writeFileSync(file, "");

        const stat = await newProvider().stat(viewUri(new h.FakeUri("file", file) as never) as never);

        expect(stat.permissions).toBe(1);
    });

    it("reports a missing script as not found rather than throwing a read error", async () => {
        const provider = newProvider();

        await expect(
            provider.stat(viewUri(new h.FakeUri("file", "/nowhere/MISSING.bcs") as never) as never),
        ).rejects.toThrow(/not found/);
    });

    // The whole point of the editable view: an untouched script has to save as itself.
    it("saves an untouched script back to the same source", async () => {
        const { view } = script();
        const provider = newProvider();
        const before = Buffer.from(await provider.readFile(view)).toString("utf8");

        await provider.writeFile(view, Buffer.from(before, "utf8"));

        expect(Buffer.from(await provider.readFile(view)).toString("utf8")).toBe(before);
    });

    it("writes an edit through to the stored bytes", async () => {
        const { file, view } = script();
        const provider = newProvider();
        const source = Buffer.from(await provider.readFile(view)).toString("utf8");

        await provider.writeFile(view, Buffer.from(source.replace("#100", "#50"), "utf8"));

        // The weight rides on its first action's opening marker, which is what makes it `50AC`.
        expect(fs.readFileSync(file, "latin1")).toContain("50AC");
    });

    it("refuses a save that does not compile, and says where", async () => {
        const { file, view } = script();
        const provider = newProvider();
        const stored = fs.readFileSync(file, "latin1");
        h.diagnostics.splice(0);

        await expect(
            provider.writeFile(view, Buffer.from("IF\n  NoSuchTrigger()\nTHEN\n  RESPONSE #100\nEND\n", "utf8")),
        ).rejects.toThrow(/was not saved/);

        expect(fs.readFileSync(file, "latin1")).toBe(stored);
        expect(h.diagnostics[0]?.message).toContain("NoSuchTrigger");
    });

    // With no game the tab holds a notice rather than source, and compiling that would write a script with
    // no blocks over the file.
    it("refuses a save into a file holding no script", async () => {
        // The tab shows a notice for one of these, and compiling a notice would write a two-marker script
        // over a file the install ships empty.
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bgforge-bcs-empty-"));
        const file = path.join(dir, "EMPTY.bcs");
        fs.writeFileSync(file, "");
        const view = viewUri(new h.FakeUri("file", file) as never) as never;

        await expect(newProvider().writeFile(view, Buffer.from("IF\nTHEN\nEND\n", "utf8"))).rejects.toThrow(
            /holds no script/,
        );

        expect(fs.statSync(file).size).toBe(0);
    });

    it("refuses a save with no game behind the document", async () => {
        const { file, view } = script();
        const stored = fs.readFileSync(file, "latin1");

        await expect(
            newProvider(() => undefined).writeFile(view, Buffer.from("IF\nTHEN\nEND\n", "utf8")),
        ).rejects.toThrow(/without the game it belongs to/);

        expect(fs.readFileSync(file, "latin1")).toBe(stored);
    });

    // The view is a rendering of one file, so the paths that would move or restructure it still refuse.
    it("refuses every path that is not a write to the script itself", () => {
        const { view } = script();
        const provider = newProvider();

        expect(() => provider.delete(view)).toThrow(/delete .* in the explorer/);
        expect(() => provider.rename(view)).toThrow(/rename .* in the explorer/);
        expect(() => provider.readDirectory()).toThrow(/not a directory/);
        expect(() => provider.createDirectory()).toThrow(/not a directory/);
    });

    // A missing file reaches readFile as a FileNotFound from the stat it performs first, same as `stat` itself.
    it("reports a missing script as not found on read too", async () => {
        const provider = newProvider();

        await expect(
            provider.readFile(viewUri(new h.FakeUri("file", "/nowhere/MISSING.bcs") as never) as never),
        ).rejects.toThrow(/not found/);
    });

    // Anything that is not a missing file propagates: a decompiler that refuses a script must not read as
    // "no such file", which would send the user looking for the wrong problem.
    it("propagates a failure that is not a missing file", async () => {
        const { view } = script();
        const files = newProvider(() => {
            throw new Error("tables unreadable");
        });

        await expect(files.readFile(view)).rejects.toThrow(/tables unreadable/);
    });

    // Nothing is watched, so both lifecycle hooks are no-ops that still have to be callable: VS Code disposes
    // the provider on shutdown and subscribes a watcher on every open.
    it("has disposable lifecycle hooks even though it watches nothing", () => {
        const provider = newProvider();

        expect(() => provider.watch().dispose()).not.toThrow();
        expect(() => provider.dispose()).not.toThrow();
    });

    it("opens the file as BAF source in the group it was opened from, then closes its own panel", async () => {
        const { file } = script();
        h.opened.splice(0);
        h.languages.splice(0);
        h.shownIn.splice(0);
        h.disposedPanels = 0;
        registerBcsEditor({ extensionPath: REPO_ROOT } as never, () => NAMING);
        const provider = h.editor.provider;
        expect(provider, "the custom editor did not register").toBeDefined();

        const document = provider!.openCustomDocument(new h.FakeUri("file", file) as never);
        await provider!.resolveCustomEditor(document, {
            viewColumn: 2,
            dispose: () => {
                h.disposedPanels++;
            },
        });

        expect(h.opened).toEqual([`${file}.baf`]);
        expect(h.languages).toEqual(["weidu-baf"]);
        expect(h.shownIn).toEqual([2]);
        expect(h.disposedPanels).toBe(1);
    });

    it("reports a document it cannot open rather than leaving an empty tab", async () => {
        const { file } = script();
        h.errors.splice(0);
        h.unopenable.add(`${file}.baf`);
        h.disposedPanels = 0;
        registerBcsEditor({ extensionPath: REPO_ROOT } as never, () => NAMING);
        const provider = h.editor.provider!;

        const document = provider.openCustomDocument(new h.FakeUri("file", file) as never);
        await provider.resolveCustomEditor(document, {
            viewColumn: 1,
            dispose: () => {
                h.disposedPanels++;
            },
        });

        expect(h.errors[0]).toContain("Could not open");
        // The panel still closes, so a failed open does not strand an empty custom-editor tab.
        expect(h.disposedPanels).toBe(1);
        h.unopenable.clear();
    });

    // Not everything thrown across a host API boundary is an Error, and the reason still has to reach the user.
    it("reports a failure that was not thrown as an Error", async () => {
        const { file } = script();
        h.errors.splice(0);
        h.rejectWith.set(`${file}.baf`, "host said no");
        h.disposedPanels = 0;
        registerBcsEditor({ extensionPath: REPO_ROOT } as never, () => NAMING);
        const provider = h.editor.provider!;

        const document = provider.openCustomDocument(new h.FakeUri("file", file) as never);
        await provider.resolveCustomEditor(document, { viewColumn: 1, dispose: () => h.disposedPanels++ });

        expect(h.errors[0]).toContain("host said no");
        expect(h.disposedPanels).toBe(1);
        h.rejectWith.clear();
    });
});

/**
 * Properties of the shared script-view provider, exercised through the `.bcs` view that uses it. The `.int`
 * view is the other user and gets them from the same code.
 */
describe("the shared script view", () => {
    it("gives each provider its own diagnostics, so disposing one does not silence the other", async () => {
        const { view } = script();
        const first = newProvider();
        const second = newProvider();

        first.dispose();

        // The surviving provider must still be able to report. A collection created at module scope and
        // disposed from an instance method would already be dead here.
        expect(await second.readFile(view)).toBeInstanceOf(Uint8Array);
        second.dispose();
    });

    it("renders once for a stat-then-read, not once per call", async () => {
        // `stat` needs the RENDERED length and `readFile` produces the identical string moments later; VS Code
        // calls stat on open, save, revert and focus, so rendering per call decompiles the script every time.
        //
        // Counted through the naming lookup, which a render performs exactly once. `stat` asks twice - once
        // for the render, once for `refuseFile` deciding the readonly flag - and a cached `readFile` asks not
        // at all, so a cache HIT totals 2 and a miss would total 3.
        const { view } = script();
        const symbolsFor = vi.fn(() => NAMING);
        const provider = new BcsFileSystemProvider(symbolsFor, REPO_ROOT);

        await provider.stat(view);
        await provider.readFile(view);

        expect(symbolsFor).toHaveBeenCalledTimes(2);
        provider.dispose();
    });

    it("re-renders after a save, rather than serving the replaced file's text", async () => {
        const { view } = script();
        const provider = newProvider();
        const before = Buffer.from(await provider.readFile(view)).toString("utf8");
        expect(before).toContain("RESPONSE #100");

        await provider.writeFile(view, Buffer.from(before.replace("RESPONSE #100", "RESPONSE #50"), "utf8"));

        // The cache is keyed by mtime and cleared on write, so this must reflect the bytes just written.
        expect(Buffer.from(await provider.readFile(view)).toString("utf8")).toContain("RESPONSE #50");
        provider.dispose();
    });
});
