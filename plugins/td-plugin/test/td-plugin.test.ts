/**
 * Unit tests for TD TypeScript Language Service Plugin.
 * Tests runtime injection, compilation settings override, and completion filtering.
 */

import { describe, expect, it, vi, beforeEach } from "vitest";
import type ts from "typescript";

const FAKE_RUNTIME_PATH = "/ext/server/out/td-runtime.d.ts";
const FAKE_RUNTIME_CONTENT = [
    "declare function begin(dialog: string, ...states: Function[]): void",
    "declare function state(name: string, fn: () => void): Function",
    "declare function say(...text: number[]): void",
    "interface Action { readonly __brand: 'Action' }",
    "type StrRef = number & { __brand: 'StrRef' }",
].join("\n");

vi.mock("fs", () => ({
    existsSync: vi.fn(() => true),
    readFileSync: vi.fn(() => FAKE_RUNTIME_CONTENT),
}));

vi.mock("path", async () => {
    const actual = await vi.importActual<typeof import("path")>("path");
    return {
        ...actual,
        resolve: vi.fn(() => FAKE_RUNTIME_PATH),
    };
});

// Import after mocks are set up (vitest hoists vi.mock)
import init from "../src/index";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const MOCK_TS_MODULES = {
    typescript: {
        ScriptTarget: { ES2020: 7 },
    } as unknown as typeof ts,
};

interface MockHost {
    getScriptFileNames: () => string[];
    getCompilationSettings: () => ts.CompilerOptions;
}

interface MockCompletionEntry {
    name: string;
    kind: string;
}

function makeCompletionResult(entries: MockCompletionEntry[]) {
    return { entries, metadata: undefined } as unknown as ts.WithMetadata<ts.CompletionInfo>;
}

function createMockInfo(
    files: string[],
    settings: ts.CompilerOptions = {},
    completionResult?: ts.WithMetadata<ts.CompletionInfo>,
): ts.server.PluginCreateInfo {
    const host: MockHost = {
        getScriptFileNames: () => [...files],
        getCompilationSettings: () => ({ ...settings }),
    };

    const languageService = {
        getCompletionsAtPosition: vi.fn(() => completionResult),
    } as unknown as ts.LanguageService;

    return {
        languageService,
        languageServiceHost: host as unknown as ts.LanguageServiceHost,
        project: {} as ts.server.Project,
        config: {},
        serverHost: {} as ts.server.ServerHost,
    } as ts.server.PluginCreateInfo;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("TD plugin", () => {
    let plugin: ts.server.PluginModule;

    beforeEach(() => {
        vi.clearAllMocks();
        // Re-initialize to reset memoized state
        plugin = init(MOCK_TS_MODULES);
    });

    describe("runtime injection via getScriptFileNames", () => {
        it("injects td-runtime.d.ts when project has .td files", () => {
            const info = createMockInfo(["/project/dialog.td"]);
            plugin.create(info);

            const host = info.languageServiceHost;
            const files = host.getScriptFileNames();
            expect(files).toContain(FAKE_RUNTIME_PATH);
        });

        it("does not inject when project has no .td files", () => {
            const info = createMockInfo(["/project/script.tssl", "/project/main.ts"]);
            plugin.create(info);

            const host = info.languageServiceHost;
            const files = host.getScriptFileNames();
            expect(files).not.toContain(FAKE_RUNTIME_PATH);
        });

        it("does not double-inject if runtime already in list", () => {
            const info = createMockInfo(["/project/dialog.td", FAKE_RUNTIME_PATH]);
            plugin.create(info);

            const host = info.languageServiceHost;
            const files = host.getScriptFileNames();
            const runtimeCount = files.filter((f: string) => f === FAKE_RUNTIME_PATH).length;
            expect(runtimeCount).toBe(1);
        });

        it("preserves original files in the list", () => {
            const origFiles = ["/project/dialog.td", "/project/utils.ts"];
            const info = createMockInfo(origFiles);
            plugin.create(info);

            const host = info.languageServiceHost;
            const files = host.getScriptFileNames();
            for (const f of origFiles) {
                expect(files).toContain(f);
            }
        });

        it("does not mutate the original array", () => {
            const origFiles = ["/project/dialog.td"];
            const info = createMockInfo(origFiles);
            plugin.create(info);

            const host = info.languageServiceHost;
            const files = host.getScriptFileNames();
            expect(files).not.toBe(origFiles);
        });
    });

    describe("compilation settings override", () => {
        it("sets ES2020 target for projects with .td files", () => {
            const info = createMockInfo(["/project/dialog.td"], { target: 99 });
            plugin.create(info);

            const host = info.languageServiceHost;
            const settings = host.getCompilationSettings();
            expect(settings.target).toBe(7); // ScriptTarget.ES2020
            expect(settings.lib).toEqual(["lib.es2020.d.ts"]);
        });

        it("does not override settings for non-.td projects", () => {
            const info = createMockInfo(["/project/script.tssl"], { target: 99 });
            plugin.create(info);

            const host = info.languageServiceHost;
            const settings = host.getCompilationSettings();
            expect(settings.target).toBe(99);
            expect(settings.lib).toBeUndefined();
        });

        it("uses current host file list, not stale pre-override reference", () => {
            // Start with no .td files — getCompilationSettings should not override
            const info = createMockInfo(["/project/utils.ts"], { target: 99 });
            plugin.create(info);

            const host = info.languageServiceHost as unknown as MockHost;
            let settings = host.getCompilationSettings();
            expect(settings.target).toBe(99);

            // Simulate tsserver/another plugin adding a .td file to the overridden list
            const prevGetFiles = host.getScriptFileNames;
            host.getScriptFileNames = () => [...prevGetFiles(), "/project/dialog.td"];

            // getCompilationSettings should detect the .td file via current host method
            settings = host.getCompilationSettings();
            expect(settings.target).toBe(7); // ScriptTarget.ES2020
        });
    });

    describe("completion filtering in .td files", () => {
        it("filters ES lib names from .td file completions", () => {
            const entries: MockCompletionEntry[] = [
                { name: "begin", kind: "function" },
                { name: "Array", kind: "var" },
                { name: "Map", kind: "var" },
            ];
            const info = createMockInfo(["/project/dialog.td"], {}, makeCompletionResult(entries));
            const service = plugin.create(info);

            const result = service.getCompletionsAtPosition("/project/dialog.td", 0, undefined!);
            const names = result!.entries.map((e: { name: string }) => e.name);
            expect(names).toContain("begin");
            expect(names).not.toContain("Array");
            expect(names).not.toContain("Map");
        });

        it("keeps keyword-kind entries even if name is in blocklist", () => {
            const entries: MockCompletionEntry[] = [
                { name: "string", kind: "keyword" },
                { name: "number", kind: "keyword" },
            ];
            const info = createMockInfo(["/project/dialog.td"], {}, makeCompletionResult(entries));
            const service = plugin.create(info);

            const result = service.getCompletionsAtPosition("/project/dialog.td", 0, undefined!);
            expect(result!.entries).toHaveLength(2);
        });

        it("keeps member/local/parameter kinds regardless of name", () => {
            const memberKinds = ["property", "method", "local var", "local function", "parameter"];
            const entries = memberKinds.map((kind) => ({ name: "Array", kind }));
            const info = createMockInfo(["/project/dialog.td"], {}, makeCompletionResult(entries));
            const service = plugin.create(info);

            const result = service.getCompletionsAtPosition("/project/dialog.td", 0, undefined!);
            expect(result!.entries).toHaveLength(memberKinds.length);
        });
    });

    describe("completion filtering in non-.td files", () => {
        it("filters TD runtime names from non-.td file completions", () => {
            const entries: MockCompletionEntry[] = [
                { name: "myFunction", kind: "function" },
                { name: "begin", kind: "function" },
                { name: "state", kind: "function" },
                { name: "say", kind: "function" },
            ];
            const info = createMockInfo(["/project/script.tssl"], {}, makeCompletionResult(entries));
            const service = plugin.create(info);

            const result = service.getCompletionsAtPosition("/project/script.tssl", 0, undefined!);
            const names = result!.entries.map((e: { name: string }) => e.name);
            expect(names).toContain("myFunction");
            expect(names).not.toContain("begin");
            expect(names).not.toContain("state");
            expect(names).not.toContain("say");
        });
    });

    describe("file extension matching", () => {
        it("matches .td files correctly", () => {
            const info = createMockInfo(["/project/dialog.td"]);
            plugin.create(info);

            const host = info.languageServiceHost;
            const files = host.getScriptFileNames();
            expect(files).toContain(FAKE_RUNTIME_PATH);
        });

        it("does not match files with .td as directory component", () => {
            const info = createMockInfo(["/project/.td/file.ts"]);
            plugin.create(info);

            const host = info.languageServiceHost;
            const files = host.getScriptFileNames();
            // Should NOT inject runtime — .td is a directory, not a file extension
            expect(files).not.toContain(FAKE_RUNTIME_PATH);
        });
    });

    describe("runtime not found", () => {
        it("returns original language service when runtime file missing", async () => {
            const { existsSync } = await import("fs");
            // Both VSIX and npm paths must fail
            vi.mocked(existsSync).mockReturnValueOnce(false).mockReturnValueOnce(false);

            const freshPlugin = init(MOCK_TS_MODULES);
            const info = createMockInfo(["/project/dialog.td"]);
            const service = freshPlugin.create(info);

            // Should be the original, unwrapped language service
            expect(service).toBe(info.languageService);
        });

        it("resolves runtime via npm path when VSIX path is absent", async () => {
            const { existsSync } = await import("fs");
            // First call (VSIX path) fails; second call (npm path) succeeds
            vi.mocked(existsSync).mockReturnValueOnce(false).mockReturnValueOnce(true);

            const freshPlugin = init(MOCK_TS_MODULES);
            const info = createMockInfo(["/project/dialog.td"]);
            const service = freshPlugin.create(info);

            // Runtime found via npm path — plugin should be active (proxy, not original)
            expect(service).not.toBe(info.languageService);
        });
    });

    describe("TD names filtering with empty runtime", () => {
        it("skips filtering in non-.td files when runtime names set is empty", async () => {
            const { readFileSync } = await import("fs");
            // readFileSync throws so loadTdNames returns an empty Set (catch branch)
            vi.mocked(readFileSync).mockImplementationOnce(() => {
                throw new Error("read error");
            });

            const freshPlugin = init(MOCK_TS_MODULES);
            const entries: MockCompletionEntry[] = [
                { name: "myFunction", kind: "function" },
                { name: "begin", kind: "function" },
            ];
            const info = createMockInfo(["/project/script.tssl"], {}, makeCompletionResult(entries));
            const service = freshPlugin.create(info);

            // With an empty names set, filtering is skipped and result is returned as-is
            const result = service.getCompletionsAtPosition("/project/script.tssl", 0, undefined!);
            expect(result!.entries).toHaveLength(2);
        });
    });
});
