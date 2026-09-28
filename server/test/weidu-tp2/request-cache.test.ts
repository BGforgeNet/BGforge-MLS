/**
 * Hover, go-to-definition and completion each need a walk of the whole document - its local functions, its
 * deep-scoped variables - and on a large installer that walk costs tens of milliseconds. Asked per request, it
 * was repeated for every hover over an unchanged file; cached by document version, it runs once per edit.
 */

import { beforeAll, describe, expect, it, vi } from "vitest";

const calls = vi.hoisted(() => ({ header: 0, variables: 0 }));

vi.mock("../../src/lsp-connection", () => ({
    getConnection: vi.fn(() => ({
        console: { log: vi.fn(), info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() },
        sendDiagnostics: vi.fn(),
    })),
    initLspConnection: vi.fn(),
}));

// Counts the real walks rather than replacing them: the assertion is how OFTEN they run.
vi.mock("../../src/weidu-tp2/header-parser", async (importOriginal) => {
    const actual = await importOriginal<typeof import("../../src/weidu-tp2/header-parser")>();
    return {
        ...actual,
        parseHeader: (...args: Parameters<typeof actual.parseHeader>) => {
            calls.header++;
            return actual.parseHeader(...args);
        },
    };
});
vi.mock("../../src/weidu-tp2/ast-utils", async (importOriginal) => {
    const actual = await importOriginal<typeof import("../../src/weidu-tp2/ast-utils")>();
    return {
        ...actual,
        localCompletion: (...args: Parameters<typeof actual.localCompletion>) => {
            calls.variables++;
            return actual.localCompletion(...args);
        },
    };
});

import { initParser } from "@bgforge/shared/parsers/weidu-tp2";
import { normalizeUri } from "../../src/core/normalized-uri";
import { defaultSettings } from "../../src/settings";
import { weiduTp2Provider } from "../../src/weidu-tp2/provider";

const URI = normalizeUri("file:///request-cache.tp2");
const TEXT = "DEFINE_ACTION_FUNCTION f INT_VAR x = 1 BEGIN END\nLAF f INT_VAR x = 2 END\n";

beforeAll(async () => {
    await initParser();
    // Every open document has a version; this one never changes.
    await weiduTp2Provider.init({ workspaceRoot: undefined, settings: defaultSettings, getDocumentVersion: () => 1 });
});

describe("weidu-tp2 per-request walks", () => {
    it("reads an unchanged document's local functions once, across hovers and definitions", async () => {
        calls.header = 0;
        const onParam = { line: 1, character: 14 };
        const onCall = { line: 1, character: 4 };

        weiduTp2Provider.hover!(TEXT, "x", URI, onParam);
        weiduTp2Provider.hover!(TEXT, "x", URI, onParam);
        const definition = await weiduTp2Provider.definition!(TEXT, onCall, URI);
        await weiduTp2Provider.definition!(TEXT, onCall, URI);

        expect(definition?.range.start.line).toBe(0);
        expect(calls.header).toBe(1);
    });

    it("reads an unchanged document's variables once across completions", () => {
        calls.variables = 0;
        const position = { line: 2, character: 0 };

        weiduTp2Provider.filterCompletions!([], TEXT, position, URI);
        weiduTp2Provider.filterCompletions!([], TEXT, position, URI);

        expect(calls.variables).toBe(1);
    });
});
