/**
 * The compiled-Infinity-Engine-script editor, exercised against real stored bytes.
 *
 * Reading runs for real: a `.bcs` is written to a temp directory and the provider decompiles it. Writing is
 * refused at every entry point, which is the property worth pinning - the view is a rendering, and BAF cannot
 * be compiled back here.
 *
 * The redirect that opens a `.bcs` as source is covered as far as the calls it makes: which document it asks
 * for, which language it sets, which group it shows it in, and that it closes its own panel. What those calls
 * DO is VS Code's.
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
        constructor(scheme: string, uriPath: string) {
            this.scheme = scheme;
            this.path = uriPath;
        }
        get fsPath() {
            return this.path;
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
    Uri: Object.assign(h.FakeUri, {
        from: (parts: { scheme: string; path: string }) => new h.FakeUri(parts.scheme, parts.path),
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
    },
    workspace: {
        registerFileSystemProvider: () => ({}),
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

import type { BcsSymbols } from "../../compilers/bcs/src/index";
import { BCS_SCHEME } from "../src/bcs-editor/document";
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

const NAMING = { symbols: SYMBOLS, engine: "bg" } as const;

/** A `.bcs` on disk plus the view URI that renders it. The fake Uri stands in for vscode's, as next door. */
function script(): { file: string; view: never } {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bgforge-bcs-view-"));
    const file = path.join(dir, "AERIE.bcs");
    fs.writeFileSync(file, SCRIPT, "latin1");
    return { file, view: new h.FakeUri(BCS_SCHEME, `${file}.baf`) as never };
}

describe("the .bcs custom editor", () => {
    it("reads a compiled script as decompiled source", () => {
        const { view } = script();
        const provider = new BcsFileSystemProvider(() => NAMING);

        const text = Buffer.from(provider.readFile(view)).toString("utf8");

        expect(text).toBe(["IF", "  False()", "THEN", "  RESPONSE #100", "    Continue()", "END", ""].join("\n"));
    });

    /**
     * The size has to be the DECOMPILED length: it is the text the editor is about to read, and a script
     * expands severalfold, so reporting the stored size makes the large-file guard measure the wrong thing.
     */
    it("reports the decompiled size and marks the document readonly", () => {
        const { file, view } = script();
        const provider = new BcsFileSystemProvider(() => NAMING);

        const stat = provider.stat(view);

        expect(stat.size).toBe(Buffer.byteLength(Buffer.from(provider.readFile(view)).toString("utf8"), "utf8"));
        expect(stat.size).not.toBe(fs.statSync(file).size);
        expect(stat.permissions).toBe(1);
    });

    it("reports a missing script as not found rather than throwing a read error", () => {
        const provider = new BcsFileSystemProvider(() => NAMING);

        expect(() => provider.stat(new h.FakeUri(BCS_SCHEME, "/nowhere/MISSING.bcs.baf") as never)).toThrow(
            /not found/,
        );
    });

    // Every mutating entry point refuses: the view is a rendering, and BAF cannot be compiled back here.
    it("refuses every write path with a reason", () => {
        const { view } = script();
        const provider = new BcsFileSystemProvider(() => NAMING);

        expect(() => provider.writeFile(view)).toThrow(/cannot be compiled back/);
        expect(() => provider.delete(view)).toThrow(/delete .* in the explorer/);
        expect(() => provider.rename(view)).toThrow(/rename .* in the explorer/);
        expect(() => provider.readDirectory()).toThrow(/not a directory/);
        expect(() => provider.createDirectory()).toThrow(/not a directory/);
    });

    // A missing file reaches readFile as an ENOENT from the read itself, where stat rejects it up front.
    it("reports a missing script as not found on read too", () => {
        const provider = new BcsFileSystemProvider(() => NAMING);

        expect(() => provider.readFile(new h.FakeUri(BCS_SCHEME, "/nowhere/MISSING.bcs.baf") as never)).toThrow(
            /not found/,
        );
    });

    // Anything that is not a missing file propagates: a decompiler that refuses a script must not read as
    // "no such file", which would send the user looking for the wrong problem.
    it("propagates a failure that is not a missing file", () => {
        const { view } = script();
        const provider = new BcsFileSystemProvider(() => {
            throw new Error("tables unreadable");
        });

        expect(() => provider.readFile(view)).toThrow(/tables unreadable/);
    });

    // Nothing is watched, so both lifecycle hooks are no-ops that still have to be callable: VS Code disposes
    // the provider on shutdown and subscribes a watcher on every open.
    it("has disposable lifecycle hooks even though it watches nothing", () => {
        const provider = new BcsFileSystemProvider(() => NAMING);

        expect(() => provider.watch().dispose()).not.toThrow();
        expect(() => provider.dispose()).not.toThrow();
    });

    it("opens the file as BAF source in the group it was opened from, then closes its own panel", async () => {
        const { file } = script();
        h.opened.splice(0);
        h.languages.splice(0);
        h.shownIn.splice(0);
        h.disposedPanels = 0;
        registerBcsEditor(() => NAMING);
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
        registerBcsEditor(() => NAMING);
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
        registerBcsEditor(() => NAMING);
        const provider = h.editor.provider!;

        const document = provider.openCustomDocument(new h.FakeUri("file", file) as never);
        await provider.resolveCustomEditor(document, { viewColumn: 1, dispose: () => h.disposedPanels++ });

        expect(h.errors[0]).toContain("host said no");
        expect(h.disposedPanels).toBe(1);
        h.rejectWith.clear();
    });
});
