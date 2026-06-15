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

import { describe, expect, it, vi, afterEach } from "vitest";
import type { Connection, TextDocuments } from "vscode-languageserver/node";
import type { TextDocument } from "vscode-languageserver-textdocument";
import { registry } from "../../src/provider-registry";
import type { HandlerContext } from "../../src/handlers/context";

import * as completion from "../../src/handlers/completion";
import * as folding from "../../src/handlers/folding";
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
