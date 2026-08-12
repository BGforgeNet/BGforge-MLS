/**
 * The decompiled view's content, exercised against real compiled bytes.
 *
 * Only the parts that read a file and produce a document are covered here; opening an editor is
 * VS Code's own behaviour, and mocking it would assert nothing about this extension.
 */

import { describe, expect, it, vi } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

// The module reaches vscode only for Uri and the registration APIs; the content path needs neither.
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
    return {
        FakeUri,
        shown: [] as string[],
        opened: [] as string[],
        languages: [] as string[],
        registered: {} as Record<string, (target?: unknown) => unknown>,
        activeTab: { input: undefined as unknown },
        provider: { current: undefined as { provideTextDocumentContent(uri: unknown): string } | undefined },
    };
});
const { FakeUri, shown, opened, languages, registered, activeTab } = h;

vi.mock("vscode", () => ({
    // The same class the tests construct, so the production `instanceof` check sees a match.
    Uri: Object.assign(h.FakeUri, {
        from: (parts: { scheme: string; path: string }) => new h.FakeUri(parts.scheme, parts.path),
    }),
    EventEmitter: class {
        event = () => undefined;
        fire() {}
    },
    Disposable: { from: (...parts: unknown[]) => ({ parts }) },
    workspace: {
        registerTextDocumentContentProvider: (_scheme: string, provider: never) => {
            h.provider.current = provider;
            return {};
        },
        openTextDocument: (uri: { path: string }) => {
            h.opened.push(uri.path);
            return Promise.resolve({ uri });
        },
    },
    languages: {
        setTextDocumentLanguage: (_document: unknown, language: string) => {
            h.languages.push(language);
            return Promise.resolve({});
        },
    },
    commands: {
        registerCommand: (name: string, handler: (target?: unknown) => unknown) => {
            h.registered[name] = handler;
            return {};
        },
    },
    window: {
        tabGroups: {
            activeTabGroup: {
                get activeTab() {
                    return h.activeTab;
                },
            },
        },
        activeTextEditor: undefined,
        showTextDocument: () => Promise.resolve({}),
        showInformationMessage: (message: string) => h.shown.push(message),
        showErrorMessage: (message: string) => h.shown.push(message),
    },
}));

import { COMMAND_DECOMPILE_INT, INT_SCHEME, registerIntViewer, render, sourcePath } from "../src/int-viewer/register";
import { emitInt } from "../../ssl/src/int/emit";

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
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "int-view-")), "script.int");
    fs.writeFileSync(file, bytes);
    return file;
}

describe("the decompiled view", () => {
    it("renders a compiled script as source", () => {
        const file = compiled();
        const text = render(file);

        expect(text).toContain(`// Decompiled from ${file}.`);
        expect(text).toContain("variable counter := 2;");
        expect(text).toContain("procedure start begin");
        expect(text).toContain("counter := 5;");
    });

    it("falls back to a commented listing when the source cannot be recovered", () => {
        const file = compiled();
        const bytes = new Uint8Array(fs.readFileSync(file));
        // An opcode belonging to no engine function stops the decompiler but not the disassembler.
        bytes[bytes.length - 2] = 0x8f;
        bytes[bytes.length - 1] = 0xff;
        fs.writeFileSync(file, bytes);

        const text = render(file);

        expect(text).toContain("could not be reconstructed as source");
        expect(text).toContain("// The instruction listing follows.");
        expect(text).toContain("// start:");
        // Every listing line is a comment, so the document is still valid source.
        for (const line of text.split("\n")) expect(line === "" || line.startsWith("//")).toBe(true);
    });

    it("maps a view back to the script it was made from", () => {
        expect(sourcePath({ path: "/mods/a.int.ssl" } as never)).toBe("/mods/a.int");
    });
});

describe("the decompile command", () => {
    it("opens the view for the file it is handed", async () => {
        const file = compiled();
        registerIntViewer();

        await registered[COMMAND_DECOMPILE_INT]!(new FakeUri("file", file));

        expect(opened).toEqual([`${file}.ssl`]);
        expect(languages).toEqual(["fallout-ssl"]);
        expect(h.provider.current?.provideTextDocumentContent(new FakeUri(INT_SCHEME, `${file}.ssl`))).toContain(
            "procedure start begin",
        );
    });

    it("falls back to the active tab when invoked without one", async () => {
        const file = compiled();
        opened.length = 0;
        activeTab.input = { uri: new FakeUri("file", file) };
        registerIntViewer();

        await registered[COMMAND_DECOMPILE_INT]!();

        expect(opened).toEqual([`${file}.ssl`]);
    });

    it("says so when nothing selectable is open", async () => {
        opened.length = 0;
        shown.length = 0;
        activeTab.input = undefined;
        registerIntViewer();

        await registered[COMMAND_DECOMPILE_INT]!();

        expect(opened).toEqual([]);
        expect(shown).toEqual(["Select a compiled .int script to decompile."]);
    });
});
