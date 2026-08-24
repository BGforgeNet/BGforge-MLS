/**
 * Unit tests for the LSP request-handler wiring layer (server/src/handlers/).
 *
 * Each handler module exports `register(ctx: HandlerContext): void` and wires one
 * or more `connection.on*` callbacks that delegate to the provider registry. These
 * tests exercise that wiring directly (the smoke test only drives initialize/
 * shutdown, and the provider logic underneath is covered by the per-provider unit
 * tests) - so they cover the seam between the LSP connection and the registry:
 *
 *   - the expected connection method is wired by register(),
 *   - an unknown document short-circuits to the documented empty result before any
 *     delegation (the guard every document handler shares), and
 *   - a known document delegates to the matching registry method.
 *
 * Scope: the document-delegating request handlers. The stateful lifecycle handlers
 * (initialize, document-lifecycle, execute-command, config) mutate the registry
 * singleton / server-context and are exercised through the smoke and e2e tiers
 * rather than re-mocked here.
 */

import { describe, expect, it, vi, afterEach, beforeAll } from "vitest";
import { MarkupKind, type Connection, type InlayHint, type TextDocuments } from "vscode-languageserver/node";
import type { TextDocument } from "vscode-languageserver-textdocument";
import { registry } from "../../src/provider-registry";
import { HoverResult as HoverResultFactory } from "../../src/language-provider";
import { initServerContext } from "../../src/server-context";
import { initSettingsService } from "../../src/settings-service";
import type { HandlerContext } from "../../src/handlers/context";
import { defaultSettings, type ProjectSettings } from "../../src/settings";
import { GameStrings } from "../../src/ie-resources/game-strings";
import type { Translation } from "../../src/translation";

import * as completion from "../../src/handlers/completion";
import * as folding from "../../src/handlers/folding";
import * as selectionRange from "../../src/handlers/selection-range";
import * as formatting from "../../src/handlers/formatting";
import * as symbols from "../../src/handlers/symbols";
import * as semanticTokens from "../../src/handlers/semantic-tokens";
import * as signature from "../../src/handlers/signature";
import * as hover from "../../src/handlers/hover";
import * as definition from "../../src/handlers/definition";
import * as references from "../../src/handlers/references";
import * as inlayHints from "../../src/handlers/inlay-hints";
import * as rename from "../../src/handlers/rename";

type AnyHandler = (...args: unknown[]) => unknown;

/** Build a mock HandlerContext whose connection records every wired callback by name. */
function makeCtx(docs: Map<string, TextDocument>): { ctx: HandlerContext; wired: Record<string, AnyHandler> } {
    const wired: Record<string, AnyHandler> = {};
    const record = (name: string) =>
        vi.fn((handler: AnyHandler) => {
            wired[name] = handler;
        });

    const connection = {
        onCompletion: record("onCompletion"),
        onCompletionResolve: record("onCompletionResolve"),
        onFoldingRanges: record("onFoldingRanges"),
        onSelectionRanges: record("onSelectionRanges"),
        onDocumentFormatting: record("onDocumentFormatting"),
        onDocumentSymbol: record("onDocumentSymbol"),
        onWorkspaceSymbol: record("onWorkspaceSymbol"),
        onSignatureHelp: record("onSignatureHelp"),
        onHover: record("onHover"),
        onDefinition: record("onDefinition"),
        onReferences: record("onReferences"),
        onPrepareRename: record("onPrepareRename"),
        onRenameRequest: record("onRenameRequest"),
        sendNotification: vi.fn(),
        languages: {
            inlayHint: { on: record("inlayHint") },
            semanticTokens: { on: record("semanticTokens") },
        },
    } as unknown as Connection;

    const documents = { get: (uri: string) => docs.get(uri) } as unknown as TextDocuments<TextDocument>;

    const ctx = {
        connection,
        documents,
        timingOpts: { warn: () => {}, thresholdMs: 50 },
        renameSuppression: { markAffected: vi.fn() },
    } as unknown as HandlerContext;

    return { ctx, wired };
}

function mockDoc(text: string, languageId = "fallout-ssl"): TextDocument {
    return { getText: () => text, languageId } as unknown as TextDocument;
}

/** Return the callback register() wired under `name`, asserting it was wired (narrows away undefined). */
function wiredHandler(wired: Record<string, AnyHandler>, name: string): AnyHandler {
    const handler = wired[name];
    if (typeof handler !== "function") {
        throw new TypeError(`register() did not wire connection.${name}`);
    }
    return handler;
}

const KNOWN_URI = "file:///known.ssl";
const UNKNOWN_URI = "file:///missing.ssl";
const POSITION = { line: 0, character: 0 };
const TOKEN = { isCancellationRequested: false, onCancellationRequested: () => ({ dispose() {} }) };

/**
 * Stub translation object satisfying the Translation interface surface used by
 * hover, definition, references, and inlay-hints handlers. All methods return
 * null/[] by default; individual tests override with vi.spyOn.
 */
function makeTranslationStub(): Translation {
    return {
        getHover: vi.fn().mockReturnValue(null),
        getDefinition: vi.fn().mockReturnValue(null),
        getReferences: vi.fn().mockResolvedValue(null),
        getInlayHints: vi.fn().mockReturnValue([]),
    } as unknown as Translation;
}

/**
 * Initialize the module-level server-context barrier once for the handlers
 * that call getServerContext(). Using the real initServerContext keeps the
 * test from mocking internals it does not own.
 */
let translationStub: Translation;

beforeAll(() => {
    translationStub = makeTranslationStub();
    // The hover and inlay handlers read per-resource settings; wire the real service, as with the context.
    initSettingsService(() => Promise.resolve(defaultSettings));
    initServerContext({
        capabilities: { configuration: false, workspaceFolders: false, fileWatching: false },
        workspaceRoot: undefined,
        projectSettings: {} as ProjectSettings,
        settings: { ...defaultSettings, debug: false },
        translation: translationStub,
        gameStrings: new GameStrings(),
    });
});

afterEach(() => {
    vi.restoreAllMocks();
});

// --- Wiring + missing-document guard -------------------------------------------------------------

interface GuardCase {
    name: string;
    register: (ctx: HandlerContext) => void;
    wires: string;
    params: unknown;
    empty: unknown;
}

const GUARD_CASES: GuardCase[] = [
    {
        name: "completion",
        register: completion.register,
        wires: "onCompletion",
        params: { textDocument: { uri: UNKNOWN_URI }, position: POSITION },
        empty: [],
    },
    {
        name: "folding",
        register: folding.register,
        wires: "onFoldingRanges",
        params: { textDocument: { uri: UNKNOWN_URI } },
        empty: [],
    },
    {
        name: "selection range",
        register: selectionRange.register,
        wires: "onSelectionRanges",
        params: { textDocument: { uri: UNKNOWN_URI }, positions: [POSITION] },
        empty: [],
    },
    {
        name: "formatting",
        register: formatting.register,
        wires: "onDocumentFormatting",
        params: { textDocument: { uri: UNKNOWN_URI } },
        empty: [],
    },
    {
        name: "document symbols",
        register: symbols.register,
        wires: "onDocumentSymbol",
        params: { textDocument: { uri: UNKNOWN_URI } },
        empty: [],
    },
    {
        name: "semantic tokens",
        register: semanticTokens.register,
        wires: "semanticTokens",
        params: { textDocument: { uri: UNKNOWN_URI } },
        empty: { data: [] },
    },
    {
        name: "signature",
        register: signature.register,
        wires: "onSignatureHelp",
        params: { textDocument: { uri: UNKNOWN_URI }, position: POSITION },
        empty: null,
    },
    {
        name: "hover",
        register: hover.register,
        wires: "onHover",
        params: { textDocument: { uri: UNKNOWN_URI }, position: POSITION },
        empty: undefined,
    },
    {
        name: "definition",
        register: definition.register,
        wires: "onDefinition",
        params: { textDocument: { uri: UNKNOWN_URI }, position: POSITION },
        empty: undefined,
    },
    {
        name: "references",
        register: references.register,
        wires: "onReferences",
        params: { textDocument: { uri: UNKNOWN_URI }, position: POSITION, context: { includeDeclaration: true } },
        empty: [],
    },
    {
        name: "inlay hints",
        register: inlayHints.register,
        wires: "inlayHint",
        params: { textDocument: { uri: UNKNOWN_URI }, range: { start: POSITION, end: POSITION } },
        empty: undefined,
    },
    {
        name: "prepare rename",
        register: rename.register,
        wires: "onPrepareRename",
        params: { textDocument: { uri: UNKNOWN_URI }, position: POSITION },
        empty: null,
    },
    {
        name: "rename",
        register: rename.register,
        wires: "onRenameRequest",
        params: { textDocument: { uri: UNKNOWN_URI }, position: POSITION, newName: "x" },
        empty: null,
    },
];

describe("handler registration + missing-document guard", () => {
    it.each(GUARD_CASES)("$name wires $wires and returns empty for an unknown document", async (c) => {
        const { ctx, wired } = makeCtx(new Map());
        c.register(ctx);

        const handler = wiredHandler(wired, c.wires);
        const result = await handler(c.params, TOKEN);
        expect(result).toEqual(c.empty);
    });
});

// --- Delegation to the registry (clean synchronous handlers) -------------------------------------

describe("handler delegation to the provider registry", () => {
    it("completion delegates to registry.completion", async () => {
        const { ctx, wired } = makeCtx(new Map([[KNOWN_URI, mockDoc("text")]]));
        const sentinel = [{ label: "x" }];
        const spy = vi.spyOn(registry, "completion").mockReturnValue(sentinel as never);

        completion.register(ctx);
        const result = await wiredHandler(
            wired,
            "onCompletion",
        )({ textDocument: { uri: KNOWN_URI }, position: POSITION });

        expect(spy).toHaveBeenCalledWith("fallout-ssl", "text", KNOWN_URI, POSITION, undefined);
        expect(result).toBe(sentinel);
    });

    it("folding delegates to registry.foldingRanges", async () => {
        const { ctx, wired } = makeCtx(new Map([[KNOWN_URI, mockDoc("text")]]));
        const sentinel = [{ startLine: 0, endLine: 1 }];
        const spy = vi.spyOn(registry, "foldingRanges").mockReturnValue(sentinel as never);

        folding.register(ctx);
        const result = await wiredHandler(wired, "onFoldingRanges")({ textDocument: { uri: KNOWN_URI } });

        expect(spy).toHaveBeenCalledWith("fallout-ssl", "text");
        expect(result).toBe(sentinel);
    });

    it("selection range delegates to registry.selectionRanges", async () => {
        const { ctx, wired } = makeCtx(new Map([[KNOWN_URI, mockDoc("text")]]));
        const sentinel = [{ range: { start: POSITION, end: POSITION } }];
        const spy = vi.spyOn(registry, "selectionRanges").mockReturnValue(sentinel as never);

        selectionRange.register(ctx);
        const result = await wiredHandler(
            wired,
            "onSelectionRanges",
        )({ textDocument: { uri: KNOWN_URI }, positions: [POSITION] });

        expect(spy).toHaveBeenCalledWith("fallout-ssl", "text", [POSITION]);
        expect(result).toBe(sentinel);
    });

    it("formatting delegates to registry.format and returns its edits", async () => {
        const { ctx, wired } = makeCtx(new Map([[KNOWN_URI, mockDoc("text")]]));
        const edits = [{ range: { start: POSITION, end: POSITION }, newText: "" }];
        const spy = vi.spyOn(registry, "format").mockReturnValue({ edits } as never);

        formatting.register(ctx);
        const result = await wiredHandler(wired, "onDocumentFormatting")({ textDocument: { uri: KNOWN_URI } });

        expect(spy).toHaveBeenCalledWith("fallout-ssl", "text", KNOWN_URI);
        expect(result).toBe(edits);
    });

    it("document symbols delegate to registry.symbols", async () => {
        const { ctx, wired } = makeCtx(new Map([[KNOWN_URI, mockDoc("text")]]));
        const sentinel = [{ name: "proc" }];
        const spy = vi.spyOn(registry, "symbols").mockReturnValue(sentinel as never);

        symbols.register(ctx);
        const result = await wiredHandler(wired, "onDocumentSymbol")({ textDocument: { uri: KNOWN_URI } });

        expect(spy).toHaveBeenCalledWith("fallout-ssl", "text");
        expect(result).toBe(sentinel);
    });

    it("semantic tokens delegate to registry.semanticTokens", async () => {
        const { ctx, wired } = makeCtx(new Map([[KNOWN_URI, mockDoc("text")]]));
        const sentinel = { data: [1, 2, 3] };
        const spy = vi.spyOn(registry, "semanticTokens").mockReturnValue(sentinel as never);

        semanticTokens.register(ctx);
        const result = await wiredHandler(wired, "semanticTokens")({ textDocument: { uri: KNOWN_URI } });

        expect(spy).toHaveBeenCalledWith("fallout-ssl", "text", KNOWN_URI);
        expect(result).toBe(sentinel);
    });
});

// --- signature handler -----------------------------------------------------------------------

describe("signature handler", () => {
    // Text that produces a parseable signature request: cursor after the opening
    // paren of "myFunc(" so getRequest returns { symbol: "myFunc", parameter: 0 }.
    const SIG_TEXT = "myFunc(";
    // Position at the end of the line (character 7 = after the open-paren).
    const SIG_POS = { line: 0, character: 7 };

    it("returns null when getRequest finds no function call at position", async () => {
        // Empty text: no open-paren, so getRequest returns undefined.
        const { ctx, wired } = makeCtx(new Map([[KNOWN_URI, mockDoc("")]]));
        signature.register(ctx);
        const result = await wiredHandler(
            wired,
            "onSignatureHelp",
        )({
            textDocument: { uri: KNOWN_URI },
            position: { line: 0, character: 0 },
        });
        expect(result).toBeNull();
    });

    it("delegates to registry.signature when a function call is detected", async () => {
        const { ctx, wired } = makeCtx(new Map([[KNOWN_URI, mockDoc(SIG_TEXT)]]));
        const sentinel = { signatures: [], activeSignature: 0, activeParameter: 0 };
        const spy = vi.spyOn(registry, "signature").mockReturnValue(sentinel);

        signature.register(ctx);
        const result = await wiredHandler(
            wired,
            "onSignatureHelp",
        )({
            textDocument: { uri: KNOWN_URI },
            position: SIG_POS,
        });

        // registry.signature receives (langId, text, uri, symbol, paramIndex)
        expect(spy).toHaveBeenCalledWith("fallout-ssl", SIG_TEXT, KNOWN_URI, "myFunc", 0);
        expect(result).toBe(sentinel);
    });

    it("returns the registry result when it is null (no signature data for this symbol)", async () => {
        const { ctx, wired } = makeCtx(new Map([[KNOWN_URI, mockDoc(SIG_TEXT)]]));
        vi.spyOn(registry, "signature").mockReturnValue(null);

        signature.register(ctx);
        const result = await wiredHandler(
            wired,
            "onSignatureHelp",
        )({
            textDocument: { uri: KNOWN_URI },
            position: SIG_POS,
        });
        expect(result).toBeNull();
    });
});

// --- hover handler ---------------------------------------------------------------------------

describe("hover handler", () => {
    // A word on line 0 so symbolAtPosition returns a non-empty token.
    const HOVER_TEXT = "my_proc";
    const HOVER_POS = { line: 0, character: 3 };

    it("returns undefined when there is no symbol at position (whitespace only)", async () => {
        const { ctx, wired } = makeCtx(new Map([[KNOWN_URI, mockDoc("   ")]]));
        hover.register(ctx);
        // Position character=0 on a whitespace-only line yields no word token.
        const result = await wiredHandler(
            wired,
            "onHover",
        )({
            textDocument: { uri: KNOWN_URI },
            position: { line: 0, character: 0 },
        });
        expect(result).toBeUndefined();
    });

    it("returns undefined when shouldProvideFeatures is false (comment zone)", async () => {
        const { ctx, wired } = makeCtx(new Map([[KNOWN_URI, mockDoc(HOVER_TEXT)]]));
        vi.spyOn(registry, "shouldProvideFeatures").mockReturnValue(false);

        hover.register(ctx);
        const result = await wiredHandler(
            wired,
            "onHover",
        )({
            textDocument: { uri: KNOWN_URI },
            position: HOVER_POS,
        });
        expect(result).toBeUndefined();
    });

    it("returns translation hover when translation.getHover matches", async () => {
        const { ctx, wired } = makeCtx(new Map([[KNOWN_URI, mockDoc(HOVER_TEXT)]]));
        vi.spyOn(registry, "shouldProvideFeatures").mockReturnValue(true);
        const translationHover = { contents: { kind: MarkupKind.PlainText, value: "msg #1" } };
        vi.spyOn(translationStub, "getHover").mockReturnValue(translationHover);

        hover.register(ctx);
        const result = await wiredHandler(
            wired,
            "onHover",
        )({
            textDocument: { uri: KNOWN_URI },
            position: HOVER_POS,
        });
        expect(result).toBe(translationHover);
    });

    it("returns localHover result when provider handles it (handled=true, hover found)", async () => {
        const { ctx, wired } = makeCtx(new Map([[KNOWN_URI, mockDoc(HOVER_TEXT)]]));
        vi.spyOn(registry, "shouldProvideFeatures").mockReturnValue(true);
        vi.spyOn(translationStub, "getHover").mockReturnValue(null);
        const localHoverValue = { contents: { kind: MarkupKind.PlainText, value: "local" } };
        vi.spyOn(registry, "localHover").mockReturnValue(HoverResultFactory.found(localHoverValue));

        hover.register(ctx);
        const result = await wiredHandler(
            wired,
            "onHover",
        )({
            textDocument: { uri: KNOWN_URI },
            position: HOVER_POS,
        });
        expect(result).toBe(localHoverValue);
    });

    it("returns null when localHover is handled but has no content (handled=true, hover=null)", async () => {
        const { ctx, wired } = makeCtx(new Map([[KNOWN_URI, mockDoc(HOVER_TEXT)]]));
        vi.spyOn(registry, "shouldProvideFeatures").mockReturnValue(true);
        vi.spyOn(translationStub, "getHover").mockReturnValue(null);
        vi.spyOn(registry, "localHover").mockReturnValue(HoverResultFactory.empty());

        hover.register(ctx);
        const result = await wiredHandler(
            wired,
            "onHover",
        )({
            textDocument: { uri: KNOWN_URI },
            position: HOVER_POS,
        });
        // handled=true with hover=null means "block fallthrough, return null"
        expect(result).toBeNull();
    });

    it("falls through to registry.hover (data-driven) when localHover is not handled", async () => {
        const { ctx, wired } = makeCtx(new Map([[KNOWN_URI, mockDoc(HOVER_TEXT)]]));
        vi.spyOn(registry, "shouldProvideFeatures").mockReturnValue(true);
        vi.spyOn(translationStub, "getHover").mockReturnValue(null);
        vi.spyOn(registry, "localHover").mockReturnValue(HoverResultFactory.notHandled());
        // Cursor is on a code identifier, not a string, so the data-driven lookup is allowed.
        vi.spyOn(registry, "isPositionInString").mockReturnValue(false);
        const dataHover = { contents: { kind: MarkupKind.PlainText, value: "data" } };
        const dataSpy = vi.spyOn(registry, "hover").mockReturnValue(dataHover);

        hover.register(ctx);
        const result = await wiredHandler(
            wired,
            "onHover",
        )({
            textDocument: { uri: KNOWN_URI },
            position: HOVER_POS,
        });
        expect(dataSpy).toHaveBeenCalledWith("fallout-ssl", KNOWN_URI, "my_proc", HOVER_TEXT);
        expect(result).toBe(dataHover);
    });

    it("does NOT run the data-driven hover when the cursor is inside a string", async () => {
        // A filename inside a path string can match an indexed symbol name; the same gate as the
        // definition fallback must stop the bare-word hover from showing that symbol's doc.
        const { ctx, wired } = makeCtx(new Map([[KNOWN_URI, mockDoc(HOVER_TEXT)]]));
        vi.spyOn(registry, "shouldProvideFeatures").mockReturnValue(true);
        vi.spyOn(translationStub, "getHover").mockReturnValue(null);
        vi.spyOn(registry, "localHover").mockReturnValue(HoverResultFactory.notHandled());
        vi.spyOn(registry, "isPositionInString").mockReturnValue(true);
        const dataSpy = vi.spyOn(registry, "hover");

        hover.register(ctx);
        const result = await wiredHandler(
            wired,
            "onHover",
        )({
            textDocument: { uri: KNOWN_URI },
            position: HOVER_POS,
        });
        expect(dataSpy).not.toHaveBeenCalled();
        expect(result).toBeNull();
    });

    // The extracted symbol must span the whole name, or the lookup misses a shipped symbol: BAF
    // IDS names carry `-` (KUO-TOA) and TP2 macro names carry `#` (tb#factorial). The handler is
    // where the language's character set is applied, so this is the seam that broke.
    it.each([
        { lang: "weidu-baf", text: "\tRace(Myself,KUO-TOA)", character: 15, symbol: "KUO-TOA" },
        { lang: "weidu-tp2", text: "  LAUNCH_PATCH_MACRO tb#factorial", character: 24, symbol: "tb#factorial" },
    ])("passes the whole $lang name '$symbol' to registry.hover", async ({ lang, text, character, symbol }) => {
        const { ctx, wired } = makeCtx(new Map([[KNOWN_URI, mockDoc(text, lang)]]));
        vi.spyOn(registry, "shouldProvideFeatures").mockReturnValue(true);
        vi.spyOn(translationStub, "getHover").mockReturnValue(null);
        vi.spyOn(registry, "localHover").mockReturnValue(HoverResultFactory.notHandled());
        vi.spyOn(registry, "isPositionInString").mockReturnValue(false);
        const dataSpy = vi.spyOn(registry, "hover").mockReturnValue(null);

        hover.register(ctx);
        await wiredHandler(
            wired,
            "onHover",
        )({
            textDocument: { uri: KNOWN_URI },
            position: { line: 0, character },
        });
        expect(dataSpy).toHaveBeenCalledWith(lang, KNOWN_URI, symbol, text);
    });
});

// --- definition handler ----------------------------------------------------------------------

describe("definition handler", () => {
    const DEF_TEXT = "my_proc";
    const DEF_POS = { line: 0, character: 3 };

    it("returns undefined when shouldProvideFeatures is false", async () => {
        const { ctx, wired } = makeCtx(new Map([[KNOWN_URI, mockDoc(DEF_TEXT)]]));
        vi.spyOn(registry, "shouldProvideFeatures").mockReturnValue(false);

        definition.register(ctx);
        const result = await wiredHandler(
            wired,
            "onDefinition",
        )({
            textDocument: { uri: KNOWN_URI },
            position: DEF_POS,
        });
        expect(result).toBeUndefined();
    });

    it("returns provider AST-based definition when registry.definition resolves a location", async () => {
        const { ctx, wired } = makeCtx(new Map([[KNOWN_URI, mockDoc(DEF_TEXT)]]));
        vi.spyOn(registry, "shouldProvideFeatures").mockReturnValue(true);
        const loc = { uri: KNOWN_URI, range: { start: POSITION, end: POSITION } };
        const provSpy = vi.spyOn(registry, "definition").mockResolvedValue(loc);

        definition.register(ctx);
        const result = await wiredHandler(
            wired,
            "onDefinition",
        )({
            textDocument: { uri: KNOWN_URI },
            position: DEF_POS,
        });
        expect(provSpy).toHaveBeenCalledWith("fallout-ssl", DEF_TEXT, DEF_POS, KNOWN_URI);
        expect(result).toBe(loc);
    });

    // Same seam as the hover handler: definition extracts the symbol with the same helper, so it
    // needs the language's extra identifier characters applied at its own call site too.
    it("passes the whole hyphenated name to registry.symbolDefinition", async () => {
        const text = "\tRace(Myself,KUO-TOA)";
        const { ctx, wired } = makeCtx(new Map([[KNOWN_URI, mockDoc(text, "weidu-baf")]]));
        vi.spyOn(registry, "shouldProvideFeatures").mockReturnValue(true);
        vi.spyOn(registry, "definition").mockResolvedValue(null);
        vi.spyOn(translationStub, "getDefinition").mockReturnValue(null);
        vi.spyOn(registry, "isPositionInString").mockReturnValue(false);
        const symSpy = vi.spyOn(registry, "symbolDefinition").mockReturnValue(null);

        definition.register(ctx);
        await wiredHandler(
            wired,
            "onDefinition",
        )({
            textDocument: { uri: KNOWN_URI },
            position: { line: 0, character: 15 },
        });
        expect(symSpy).toHaveBeenCalledWith("weidu-baf", "KUO-TOA");
    });

    it("returns translation definition when registry.definition is null and translation matches", async () => {
        const { ctx, wired } = makeCtx(new Map([[KNOWN_URI, mockDoc(DEF_TEXT)]]));
        vi.spyOn(registry, "shouldProvideFeatures").mockReturnValue(true);
        vi.spyOn(registry, "definition").mockResolvedValue(null);
        const traLoc = { uri: "file:///strings.tra", range: { start: POSITION, end: POSITION } };
        vi.spyOn(translationStub, "getDefinition").mockReturnValue(traLoc);

        definition.register(ctx);
        const result = await wiredHandler(
            wired,
            "onDefinition",
        )({
            textDocument: { uri: KNOWN_URI },
            position: DEF_POS,
        });
        expect(result).toBe(traLoc);
    });

    it("returns symbolDefinition (data-driven) when provider and translation both return null", async () => {
        const { ctx, wired } = makeCtx(new Map([[KNOWN_URI, mockDoc(DEF_TEXT)]]));
        vi.spyOn(registry, "shouldProvideFeatures").mockReturnValue(true);
        vi.spyOn(registry, "definition").mockResolvedValue(null);
        vi.spyOn(translationStub, "getDefinition").mockReturnValue(null);
        // Cursor is on a code identifier, not a string, so the fallback is allowed to fire.
        vi.spyOn(registry, "isPositionInString").mockReturnValue(false);
        const symLoc = { uri: "file:///header.ssl", range: { start: POSITION, end: POSITION } };
        const symSpy = vi.spyOn(registry, "symbolDefinition").mockReturnValue(symLoc);

        definition.register(ctx);
        const result = await wiredHandler(
            wired,
            "onDefinition",
        )({
            textDocument: { uri: KNOWN_URI },
            position: DEF_POS,
        });
        expect(symSpy).toHaveBeenCalledWith("fallout-ssl", "my_proc");
        expect(result).toBe(symLoc);
    });

    it("does NOT fire the symbolDefinition fallback when the cursor is inside a string", async () => {
        // A filename inside a path string can match an indexed symbol name; the gate must stop the
        // bare-word fallback from wrong-jumping there. Provider and translation both return null.
        const { ctx, wired } = makeCtx(new Map([[KNOWN_URI, mockDoc(DEF_TEXT)]]));
        vi.spyOn(registry, "shouldProvideFeatures").mockReturnValue(true);
        vi.spyOn(registry, "definition").mockResolvedValue(null);
        vi.spyOn(translationStub, "getDefinition").mockReturnValue(null);
        vi.spyOn(registry, "isPositionInString").mockReturnValue(true);
        const symSpy = vi.spyOn(registry, "symbolDefinition");

        definition.register(ctx);
        const result = await wiredHandler(
            wired,
            "onDefinition",
        )({
            textDocument: { uri: KNOWN_URI },
            position: DEF_POS,
        });
        expect(symSpy).not.toHaveBeenCalled();
        expect(result).toBeNull();
    });

    it("returns null when no symbol is under the cursor and provider returns null", async () => {
        // Whitespace-only text -> symbolAtPosition returns "" which is falsy
        const { ctx, wired } = makeCtx(new Map([[KNOWN_URI, mockDoc("   ")]]));
        vi.spyOn(registry, "shouldProvideFeatures").mockReturnValue(true);
        vi.spyOn(registry, "definition").mockResolvedValue(null);

        definition.register(ctx);
        const result = await wiredHandler(
            wired,
            "onDefinition",
        )({
            textDocument: { uri: KNOWN_URI },
            position: { line: 0, character: 0 },
        });
        expect(result).toBeNull();
    });
});

// --- definition handler string gate, through the REAL registry -------------------------------
//
// The tests above stub registry.isPositionInString to prove the handler's control flow. This block
// exercises the real registry.isPositionInString delegation and the real handler gate together, so
// the two are verified end-to-end rather than as two separately-mocked halves. The real tp2/ssl
// providers keep a self-location sentinel, so their definition() returns non-null and the handler
// returns before the gate is ever reached - the gate can only be exercised by the future-provider
// shape (definition() returns null on a path string, getSymbolDefinition would match the filename),
// which this stand-in provider reproduces.

describe("definition handler string gate (real registry delegation)", () => {
    const GATE_LANG = "gate-stand-in-lang";
    const GATE_URI = "file:///gate.tpa";
    const GATE_POS = { line: 0, character: 10 };
    // The location the bare-word fallback WOULD wrong-jump to (a same-named symbol).
    const WRONG = { uri: "file:///wrong-symbol.h", range: { start: POSITION, end: POSITION } };

    function registerStandIn(isPositionInString: boolean): void {
        const provider = {
            id: GATE_LANG,
            shouldProvideFeatures: () => true,
            definition: () => null, // future provider: no AST result on the path string
            getSymbolDefinition: () => WRONG, // bare-word lookup that collides with the filename
            isPositionInString: () => isPositionInString,
        } as unknown as import("../../src/language-provider").LanguageProvider;
        // Insert straight into the singleton's map rather than registry.register(), whose conlog
        // needs an initialized LSP connection this seam-level test does not stand up.
        (registry as unknown as { providers: Map<string, unknown> }).providers.set(GATE_LANG, provider);
    }

    afterEach(() => {
        // No public unregister; drop the stand-in from the singleton so it cannot leak into other
        // tests. Deliberate localized coupling, preferred over a production-only unregister seam.
        (registry as unknown as { providers: Map<string, unknown> }).providers.delete(GATE_LANG);
    });

    it("skips the fallback when the cursor is in a string (no wrong-jump)", async () => {
        registerStandIn(true);
        vi.spyOn(translationStub, "getDefinition").mockReturnValue(null);
        const { ctx, wired } = makeCtx(new Map([[GATE_URI, mockDoc('INCLUDE "foo.tpa"', GATE_LANG)]]));

        definition.register(ctx);
        const result = await wiredHandler(
            wired,
            "onDefinition",
        )({ textDocument: { uri: GATE_URI }, position: GATE_POS });

        expect(result).toBeNull();
    });

    it("fires the fallback when the cursor is NOT in a string (gate is what makes the difference)", async () => {
        registerStandIn(false);
        vi.spyOn(translationStub, "getDefinition").mockReturnValue(null);
        const { ctx, wired } = makeCtx(new Map([[GATE_URI, mockDoc('INCLUDE "foo.tpa"', GATE_LANG)]]));

        definition.register(ctx);
        const result = await wiredHandler(
            wired,
            "onDefinition",
        )({ textDocument: { uri: GATE_URI }, position: GATE_POS });

        expect(result).toEqual(WRONG);
    });
});

// --- references handler ----------------------------------------------------------------------

describe("references handler", () => {
    const REF_TEXT = "my_proc";
    const REF_POS = { line: 0, character: 3 };
    const refParams = (uri: string) => ({
        textDocument: { uri },
        position: REF_POS,
        context: { includeDeclaration: true },
    });

    it("returns [] when shouldProvideFeatures is false", async () => {
        const { ctx, wired } = makeCtx(new Map([[KNOWN_URI, mockDoc(REF_TEXT)]]));
        vi.spyOn(registry, "shouldProvideFeatures").mockReturnValue(false);

        references.register(ctx);
        const result = await wiredHandler(wired, "onReferences")(refParams(KNOWN_URI));
        expect(result).toEqual([]);
    });

    it("returns provider references when registry.references returns a non-empty list", async () => {
        const { ctx, wired } = makeCtx(new Map([[KNOWN_URI, mockDoc(REF_TEXT)]]));
        vi.spyOn(registry, "shouldProvideFeatures").mockReturnValue(true);
        const locs = [{ uri: KNOWN_URI, range: { start: POSITION, end: POSITION } }];
        const refSpy = vi.spyOn(registry, "references").mockReturnValue(locs);

        references.register(ctx);
        const result = await wiredHandler(wired, "onReferences")(refParams(KNOWN_URI), TOKEN);
        expect(refSpy).toHaveBeenCalledWith("fallout-ssl", REF_TEXT, REF_POS, KNOWN_URI, true, TOKEN);
        expect(result).toBe(locs);
    });

    it("falls through to translation.getReferences when provider returns empty", async () => {
        const { ctx, wired } = makeCtx(new Map([[KNOWN_URI, mockDoc(REF_TEXT)]]));
        vi.spyOn(registry, "shouldProvideFeatures").mockReturnValue(true);
        vi.spyOn(registry, "references").mockReturnValue([]);
        const traLocs = [{ uri: "file:///strings.tra", range: { start: POSITION, end: POSITION } }];
        vi.spyOn(translationStub, "getReferences").mockResolvedValue(traLocs);

        references.register(ctx);
        const result = await wiredHandler(wired, "onReferences")(refParams(KNOWN_URI), TOKEN);
        expect(result).toBe(traLocs);
    });

    it("returns [] when both provider and translation return empty", async () => {
        const { ctx, wired } = makeCtx(new Map([[KNOWN_URI, mockDoc(REF_TEXT)]]));
        vi.spyOn(registry, "shouldProvideFeatures").mockReturnValue(true);
        vi.spyOn(registry, "references").mockReturnValue([]);
        vi.spyOn(translationStub, "getReferences").mockResolvedValue([]);

        references.register(ctx);
        const result = await wiredHandler(wired, "onReferences")(refParams(KNOWN_URI), TOKEN);
        expect(result).toEqual([]);
    });
});

// --- inlay-hints handler ---------------------------------------------------------------------

describe("inlay-hints handler", () => {
    const INLAY_RANGE = { start: POSITION, end: { line: 1, character: 0 } };
    const inlayParams = (uri: string) => ({ textDocument: { uri }, range: INLAY_RANGE });

    it("passes the requested document and range to the provider", async () => {
        const { ctx, wired } = makeCtx(new Map([[KNOWN_URI, mockDoc("text")]]));
        const hints = [{ position: POSITION, label: "42" }];
        const spy = vi.spyOn(registry, "inlayHints").mockReturnValue(hints as never);

        inlayHints.register(ctx);
        const result = await wiredHandler(wired, "inlayHint")(inlayParams(KNOWN_URI));
        expect(spy).toHaveBeenCalledWith("fallout-ssl", "text", KNOWN_URI, INLAY_RANGE);
        expect(result).toEqual(hints);
    });

    it("returns translation hints when the provider has none", async () => {
        const { ctx, wired } = makeCtx(new Map([[KNOWN_URI, mockDoc("text")]]));
        vi.spyOn(registry, "inlayHints").mockReturnValue([]);
        const traHints = [{ position: POSITION, label: "@99" }];
        vi.spyOn(translationStub, "getInlayHints").mockReturnValue(traHints as never);

        inlayHints.register(ctx);
        const result = await wiredHandler(wired, "inlayHint")(inlayParams(KNOWN_URI));
        expect(result).toEqual(traHints);
    });

    it("merges the sources rather than letting the first non-empty one win", async () => {
        // One BAF line can carry both a `@100` translation reference and a bare TLK strref, so a handler
        // that returned the first non-empty source would silently drop the other kind.
        const { ctx, wired } = makeCtx(new Map([[KNOWN_URI, mockDoc("text")]]));
        vi.spyOn(registry, "inlayHints").mockReturnValue([{ position: POSITION, label: "42" }] as never);
        vi.spyOn(translationStub, "getInlayHints").mockReturnValue([{ position: POSITION, label: "@99" }] as never);

        inlayHints.register(ctx);
        const result = await wiredHandler(wired, "inlayHint")(inlayParams(KNOWN_URI));
        expect((result as InlayHint[]).map((hint) => hint.label)).toEqual(["42", "@99"]);
    });
});

// --- rename handler --------------------------------------------------------------------------

describe("rename handler", () => {
    const RENAME_TEXT = "my_proc";
    const RENAME_POS = { line: 0, character: 3 };

    it("prepareRename delegates to registry.prepareRename", async () => {
        const { ctx, wired } = makeCtx(new Map([[KNOWN_URI, mockDoc(RENAME_TEXT)]]));
        const rangeResult = { range: { start: RENAME_POS, end: RENAME_POS }, placeholder: "my_proc" };
        const spy = vi.spyOn(registry, "prepareRename").mockReturnValue(rangeResult);

        rename.register(ctx);
        const result = await wiredHandler(
            wired,
            "onPrepareRename",
        )({
            textDocument: { uri: KNOWN_URI },
            position: RENAME_POS,
        });
        expect(spy).toHaveBeenCalledWith("fallout-ssl", RENAME_TEXT, RENAME_POS);
        expect(result).toBe(rangeResult);
    });

    it("onRenameRequest delegates to registry.rename and returns WorkspaceEdit", async () => {
        const { ctx, wired } = makeCtx(new Map([[KNOWN_URI, mockDoc(RENAME_TEXT)]]));
        const workspaceEdit = {
            documentChanges: [
                {
                    textDocument: { uri: KNOWN_URI, version: 1 },
                    edits: [{ range: { start: RENAME_POS, end: RENAME_POS }, newText: "new_proc" }],
                },
            ],
        };
        const spy = vi.spyOn(registry, "rename").mockResolvedValue(workspaceEdit as never);

        rename.register(ctx);
        const result = await wiredHandler(
            wired,
            "onRenameRequest",
        )({
            textDocument: { uri: KNOWN_URI },
            position: RENAME_POS,
            newName: "new_proc",
        });
        expect(spy).toHaveBeenCalledWith("fallout-ssl", RENAME_TEXT, RENAME_POS, "new_proc", KNOWN_URI);
        expect(result).toBe(workspaceEdit);
    });

    it("onRenameRequest calls renameSuppression.markAffected for each TextDocumentEdit", async () => {
        const { ctx, wired } = makeCtx(new Map([[KNOWN_URI, mockDoc(RENAME_TEXT)]]));
        const secondUri = "file:///other.ssl";
        const workspaceEdit = {
            documentChanges: [
                {
                    textDocument: { uri: KNOWN_URI, version: 1 },
                    edits: [{ range: { start: RENAME_POS, end: RENAME_POS }, newText: "x" }],
                },
                {
                    textDocument: { uri: secondUri, version: 2 },
                    edits: [{ range: { start: RENAME_POS, end: RENAME_POS }, newText: "x" }],
                },
            ],
        };
        vi.spyOn(registry, "rename").mockResolvedValue(workspaceEdit as never);

        rename.register(ctx);
        await wiredHandler(
            wired,
            "onRenameRequest",
        )({
            textDocument: { uri: KNOWN_URI },
            position: RENAME_POS,
            newName: "x",
        });

        // Both URIs should have been passed to markAffected (as a snapshot array)
        expect(ctx.renameSuppression.markAffected).toHaveBeenCalledOnce();
        const [affectedUris] = (ctx.renameSuppression.markAffected as ReturnType<typeof vi.fn>).mock.calls[0] as [
            string[],
        ];
        expect(affectedUris).toHaveLength(2);
    });

    it("onRenameRequest does not call markAffected when registry returns null", async () => {
        const { ctx, wired } = makeCtx(new Map([[KNOWN_URI, mockDoc(RENAME_TEXT)]]));
        vi.spyOn(registry, "rename").mockResolvedValue(null);

        rename.register(ctx);
        await wiredHandler(
            wired,
            "onRenameRequest",
        )({
            textDocument: { uri: KNOWN_URI },
            position: RENAME_POS,
            newName: "x",
        });
        expect(ctx.renameSuppression.markAffected).not.toHaveBeenCalled();
    });

    it("onRenameRequest does not call markAffected when documentChanges is empty", async () => {
        const { ctx, wired } = makeCtx(new Map([[KNOWN_URI, mockDoc(RENAME_TEXT)]]));
        vi.spyOn(registry, "rename").mockResolvedValue({ documentChanges: [] } as never);

        rename.register(ctx);
        await wiredHandler(
            wired,
            "onRenameRequest",
        )({
            textDocument: { uri: KNOWN_URI },
            position: RENAME_POS,
            newName: "x",
        });
        expect(ctx.renameSuppression.markAffected).not.toHaveBeenCalled();
    });
});
