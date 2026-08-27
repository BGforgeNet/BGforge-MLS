/**
 * The compiled-script editor, exercised against real compiled bytes.
 *
 * Reading and writing run for real: a `.int` is emitted into a temp directory and the provider decompiles
 * and recompiles it, so the round trip these tests assert is the one a save performs.
 *
 * The redirect that opens a `.int` as source is covered only as far as the calls it makes - which
 * document it asks for, which language it sets, which group it shows it in, and that it closes its own
 * panel. What those calls DO is VS Code's, and that half is verified by driving the real editor.
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
import { REPO_ROOT } from "./repo-root";

// The modules reach vscode for Uri, the registration APIs and the diagnostic types; nothing here needs
// a real one. Hoisted so the vi.mock factory, which runs before the module body, can close over them.
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
    class Positional {
        readonly parts: unknown[];
        constructor(...parts: unknown[]) {
            this.parts = parts;
        }
    }
    return {
        FakeUri,
        FileSystemError,
        Positional,
        diagnostics: [] as unknown[],
        opened: [] as string[],
        /** Documents VS Code cannot open - what a missing or unreadable compiled script produces. */
        unopenable: new Set<string>(),
        languages: [] as string[],
        shownIn: [] as (number | undefined)[],
        errors: [] as string[],
        info: [] as string[],
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
    DiagnosticSeverity: { Error: 0 },
    // Positional shapes only: the provider builds these and hands them straight to VS Code, so nothing
    // under test reads a field back. Keeping the arguments makes a failure legible if one ever does.
    Position: h.Positional,
    Range: h.Positional,
    Diagnostic: h.Positional,
    languages: {
        setTextDocumentLanguage: (_document: unknown, language: string) => {
            h.languages.push(language);
            return Promise.resolve({});
        },
        createDiagnosticCollection: () => ({
            set: (_uri: unknown, list: unknown) => h.diagnostics.push(list),
            delete: () => h.diagnostics.splice(0),
            dispose: () => undefined,
        }),
    },
    workspace: {
        registerFileSystemProvider: () => ({}),
        // Bridges to real node fs for `file:` sources, the only kind these tests write - the same real bytes
        // a `.int` on disk holds, reached the way VS Code itself reaches them rather than a bare fs path.
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
        showInformationMessage: (message: string) => h.info.push(message),
    },
}));

import { LISTING_MARKER, render } from "../src/int-editor/document";
import { intScriptView } from "../src/int-editor/filesystem";
import { routeCompile } from "../src/script-view/compile-command";
import { ScriptViewFileSystemProvider, scriptViewUri, sourceUriOf } from "../src/script-view/filesystem";
import { SCRIPT_VIEW_SCHEME } from "../src/script-view/formats";
import { registerScriptViews } from "../src/script-view/register";
import { emitInt } from "../../compilers/ssl/src/int/emit";

function compiled(): string {
    const bytes = emitInt({
        declarations: [
            { kind: "global", variable: { name: "counter", initial: { kind: "int", value: 2 } } },
            {
                kind: "procedure",
                procedure: {
                    name: "start",
                    args: [],
                    locals: [],
                    body: [
                        {
                            kind: "assign",
                            target: { kind: "var", scope: "global", index: 0, name: "counter" },
                            op: "=",
                            value: { kind: "int", value: 5 },
                        },
                    ],
                },
            },
        ],
    });
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "int-edit-")), "script.int");
    fs.writeFileSync(file, bytes);
    return file;
}

/** A fake source URI standing in for `vscode.Uri.file`: only `.path`/`.fsPath` are read by anything under test. */
const source = (file: string) => new h.FakeUri("file", file) as never;
const view = (file: string) => scriptViewUri(source(file)) as never;

describe("the decompiled document", () => {
    it("renders a compiled script as source", async () => {
        const file = compiled();
        const text = await render(source(file));

        expect(text).toContain(`// Decompiled from ${file}.`);
        expect(text).toContain("variable counter := 2;");
        expect(text).toContain("procedure start begin");
        expect(text).toContain("counter := 5;");
    });

    it("falls back to a commented listing when the source cannot be recovered", async () => {
        const file = compiled();
        const bytes = new Uint8Array(fs.readFileSync(file));
        // An opcode belonging to no engine function stops the decompiler but not the disassembler.
        bytes[bytes.length - 2] = 0x8f;
        bytes[bytes.length - 1] = 0xff;
        fs.writeFileSync(file, bytes);

        const text = await render(source(file));

        expect(text).toContain("could not be reconstructed as source");
        expect(text).toContain(LISTING_MARKER);
        expect(text).toContain("// start:");
        // Every listing line is a comment, so the document is still valid source.
        for (const line of text.split("\n")) expect(line === "" || line.startsWith("//")).toBe(true);
    });

    it("maps a script to its view and back", () => {
        const src = source("/mods/a.int");
        const viewed = scriptViewUri(src);

        // The `.ssl` suffix is what makes the tab read as source rather than as the compiled file.
        expect(viewed.path).toBe("/mods/a.int.ssl");
        expect(sourceUriOf(viewed).path).toBe("/mods/a.int");
    });
});

describe("the compiled-script filesystem", () => {
    const files = () => new ScriptViewFileSystemProvider(new Map([["int", intScriptView(REPO_ROOT)]]));

    it("reports the length of the text it will serve, not of the compiled file", async () => {
        const file = compiled();
        const stat = await files().stat(view(file));

        expect(stat.size).toBe(Buffer.byteLength(await render(source(file)), "utf8"));
        expect(stat.size).not.toBe(fs.statSync(file).size);
    });

    it("serves the decompiled source", async () => {
        const file = compiled();

        expect(Buffer.from(await files().readFile(view(file))).toString("utf8")).toContain("procedure start begin");
    });

    it("saving an unedited script reproduces it byte for byte", async () => {
        const file = compiled();
        const before = new Uint8Array(fs.readFileSync(file));
        const provider = files();

        await provider.writeFile(view(file), await provider.readFile(view(file)));

        expect(new Uint8Array(fs.readFileSync(file))).toEqual(before);
    });

    it("saving an edit compiles it over the script", async () => {
        const file = compiled();
        const provider = files();
        const edited = Buffer.from(await provider.readFile(view(file)))
            .toString("utf8")
            .replace("counter := 5;", "counter := 9;");

        await provider.writeFile(view(file), Buffer.from(edited, "utf8"));

        expect(await render(source(file))).toContain("counter := 9;");
    });

    // Both refusals, because the front end throws a DIFFERENT error type per stage and an editor written
    // against one of them degrades to a raw stack message on the other. The unterminated procedure is
    // refused while parsing; the miscounted call parses and is refused while lowering.
    it.each([
        ["parsing", "procedure start begin", /does not compile\. 1:22: missing end/],
        ["lowering", "procedure start begin\n display_msg();\nend\n", /does not compile\. 2:2: 'display_msg' takes 1/],
    ])("refuses a save the compiler rejects while %s, and leaves the script alone", async (_stage, text, said) => {
        const file = compiled();
        const before = new Uint8Array(fs.readFileSync(file));
        const provider = files();

        await expect(provider.writeFile(view(file), Buffer.from(text, "utf8"))).rejects.toThrow(said);
        expect(new Uint8Array(fs.readFileSync(file))).toEqual(before);
    });

    it("refuses to save a listing, which describes the code rather than being it", async () => {
        const file = compiled();
        const provider = files();

        await expect(provider.writeFile(view(file), Buffer.from(`${LISTING_MARKER}\n// noop`, "utf8"))).rejects.toThrow(
            /could not be decompiled/,
        );
    });

    it("reports a missing script rather than throwing whatever the filesystem said", async () => {
        await expect(files().stat(view("/nowhere/absent.int"))).rejects.toThrow(h.FileSystemError);
        await expect(files().readFile(view("/nowhere/absent.int"))).rejects.toThrow(h.FileSystemError);
    });

    // A compiled script is one file, and this view is a rendering of it - so the operations that would
    // treat the scheme as a filesystem in its own right refuse, rather than half-working on the `.int`.
    it("refuses every operation that is not reading or writing the one file", () => {
        const provider = files();
        const uri = view("/mods/a.int");

        expect(() => provider.readDirectory()).toThrow(/not a directory/);
        expect(() => provider.createDirectory()).toThrow(/not a directory/);
        expect(() => provider.delete(uri)).toThrow(/delete \/mods\/a\.int in the explorer/);
        expect(() => provider.rename(uri)).toThrow(/rename \/mods\/a\.int in the explorer/);
    });

    it("watches nothing, because the workspace already watches the compiled file", () => {
        const provider = files();
        expect(() => provider.watch().dispose()).not.toThrow();
        expect(() => provider.dispose()).not.toThrow();
    });

    it("compiles over bytes it cannot decompile, having no previous layout to match", async () => {
        const file = compiled();
        const provider = files();
        const text = Buffer.from(await provider.readFile(view(file)));
        fs.writeFileSync(file, Uint8Array.from([1, 2, 3]));

        await provider.writeFile(view(file), text);

        // Not a comparison against the original bytes: the point is that an unreadable previous file is
        // not an error, only the absence of an ordering to preserve.
        expect(await render(source(file))).toContain("procedure start begin");
    });
});

describe("compiling from the editor command", () => {
    /** A document plus the record of whether it was saved, which is how the .int gets written. */
    const fake = (scheme: string, { dirty = true, writes = true } = {}) => {
        const saved: true[] = [];
        const document = {
            uri:
                scheme === SCRIPT_VIEW_SCHEME
                    ? view("/mods/a.int")
                    : (new h.FakeUri(scheme, "/mods/a.int.ssl") as never),
            isDirty: dirty,
            save: () => {
                saved.push(true);
                return Promise.resolve(writes);
            },
        };
        return { document, saved };
    };
    const run = async (document: unknown) => {
        h.info.length = 0;
        const sent: true[] = [];
        await routeCompile(document as never, () => {
            sent.push(true);
            return Promise.resolve();
        });
        return sent;
    };

    // Each case asserts the path NOT taken as well: a router that did both would satisfy either
    // assertion alone, and doing both means compiling the same text twice down two different paths.
    it("compiles a decompiled script by saving it, which writes the .int in place", async () => {
        const { document, saved } = fake(SCRIPT_VIEW_SCHEME);

        const sent = await run(document);

        expect(saved).toEqual([true]);
        expect(sent).toEqual([]);
    });

    it("says what it wrote, because a silent command is indistinguishable from a broken one", async () => {
        const { document } = fake(SCRIPT_VIEW_SCHEME);

        await run(document);

        expect(h.info).toEqual(["Compiled a.int"]);
    });

    // The command reports the state either way rather than quietly doing nothing, which is what an
    // unedited document looked like before: the bytes on disk already match, and that is worth saying.
    it("reports an unedited script as already current, and does not rewrite it", async () => {
        const { document, saved } = fake(SCRIPT_VIEW_SCHEME, { dirty: false });

        await run(document);

        expect(saved).toEqual([]);
        expect(h.info).toEqual(["a.int is already up to date"]);
    });

    it("claims nothing when the save was refused, leaving the refusal as the only message", async () => {
        const { document, saved } = fake(SCRIPT_VIEW_SCHEME, { writes: false });

        await run(document);

        expect(saved).toEqual([true]);
        expect(h.info).toEqual([]);
    });

    it("sends an ordinary source file to the language server", async () => {
        const { document, saved } = fake("file");

        const sent = await run(document);

        expect(sent).toEqual([true]);
        expect(saved).toEqual([]);
        expect(h.info).toEqual([]);
    });
});

describe("opening a compiled script", () => {
    const open = async (file: string): Promise<void> => {
        const context = { extensionPath: REPO_ROOT } as never;
        registerScriptViews(context, () => undefined);
        const provider = h.editor.provider!;
        const document = provider.openCustomDocument(new h.FakeUri("file", file));
        await provider.resolveCustomEditor(document, { viewColumn: 2, dispose: () => disposed.push(true) });
    };
    const disposed: boolean[] = [];

    it("hands the file to a text editor in the panel's own group, then closes the panel", async () => {
        const file = compiled();
        h.opened.length = 0;
        h.languages.length = 0;
        h.shownIn.length = 0;
        disposed.length = 0;

        await open(file);

        expect(h.opened).toEqual([`${file}.ssl`]);
        // Two of this extension's languages claim `.ssl`, so the name alone does not settle which.
        expect(h.languages).toEqual(["fallout-ssl"]);
        expect(h.shownIn).toEqual([2]);
        expect(disposed).toEqual([true]);
    });

    it("says why when the file cannot be opened, and still closes the panel", async () => {
        h.errors.length = 0;
        disposed.length = 0;
        h.unopenable.add("/nowhere/absent.int.ssl");

        await open("/nowhere/absent.int");

        expect(h.errors[0]).toMatch(/Could not open \/nowhere\/absent\.int/);
        // The panel goes either way: a placeholder tab left behind would be worse than the error.
        expect(disposed).toEqual([true]);
    });
});
