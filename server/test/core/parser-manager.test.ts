/**
 * Tests for core/parser-manager.ts — registration, initialization, and lookup.
 *
 * web-tree-sitter and the underlying WASM files are not available in the unit-test
 * environment. The shared/parser-factory module is mocked so ParserManager tests
 * can exercise all branches without loading WASM.
 */

import { describe, expect, it, vi, beforeEach } from "vitest";

// Mocks must be declared before importing the module under test.
const mockInit = vi.fn();
const mockIsInitialized = vi.fn();
const mockParseWithCache = vi.fn();
const mockGetParser = vi.fn();

// Each call to createCachedParserModule returns a fresh mock module instance.
vi.mock("../../src/shared/parser-factory", () => ({
    createCachedParserModule: vi.fn(() => ({
        init: mockInit,
        isInitialized: mockIsInitialized,
        parseWithCache: mockParseWithCache,
        getParser: mockGetParser,
    })),
}));

// Suppress conlog output in tests
vi.mock("../../src/common", () => ({
    conlog: vi.fn(),
    errorMessage: (err: unknown) => (err instanceof Error ? err.message : String(err)),
}));

// Import after mocks are set up.  Use a fresh ParserManager instance for each
// test by importing the class directly rather than the singleton.
import { parserManager } from "../../src/core/parser-manager";

// Because the singleton is module-level we reset mock state before each test
// rather than re-importing the module.
beforeEach(() => {
    vi.clearAllMocks();
    // Default: not initialized
    mockIsInitialized.mockReturnValue(false);
});

describe("core/parser-manager", () => {
    describe("register()", () => {
        it("registers a new language without error", () => {
            expect(() => parserManager.register("test-lang", "test.wasm", "Test")).not.toThrow();
        });

        it("is a no-op when the same langId is registered a second time", async () => {
            const { createCachedParserModule } = await import("../../src/shared/parser-factory");
            const callsBefore = vi.mocked(createCachedParserModule).mock.calls.length;

            parserManager.register("dup-lang", "dup.wasm", "Dup");
            parserManager.register("dup-lang", "dup.wasm", "Dup");

            // createCachedParserModule should have been called exactly once more
            expect(vi.mocked(createCachedParserModule).mock.calls.length).toBe(callsBefore + 1);
        });
    });

    describe("isInitialized()", () => {
        it("returns false for an unregistered language", () => {
            expect(parserManager.isInitialized("unknown-lang-xyz")).toBe(false);
        });

        it("returns false for a registered but uninitialized language", () => {
            mockIsInitialized.mockReturnValue(false);
            parserManager.register("not-init-lang", "x.wasm", "X");

            expect(parserManager.isInitialized("not-init-lang")).toBe(false);
        });

        it("returns true for a registered and initialized language", () => {
            mockIsInitialized.mockReturnValue(true);
            parserManager.register("init-lang", "y.wasm", "Y");

            expect(parserManager.isInitialized("init-lang")).toBe(true);
        });
    });

    describe("initOne()", () => {
        it("calls init() when the parser is not yet initialized", async () => {
            mockIsInitialized.mockReturnValue(false);
            mockInit.mockResolvedValue(undefined);

            await parserManager.initOne("initone-lang", "io.wasm", "IO");

            expect(mockInit).toHaveBeenCalledOnce();
        });

        it("skips init() when the parser is already initialized", async () => {
            mockIsInitialized.mockReturnValue(true);

            await parserManager.initOne("already-lang", "al.wasm", "AL");

            expect(mockInit).not.toHaveBeenCalled();
        });
    });

    describe("initAll()", () => {
        it("calls init() for all registered parsers sequentially", async () => {
            mockInit.mockResolvedValue(undefined);

            parserManager.register("all-lang-a", "a.wasm", "A");
            parserManager.register("all-lang-b", "b.wasm", "B");

            await parserManager.initAll();

            // init was called at least twice (once per freshly registered parser)
            expect(mockInit.mock.calls.length).toBeGreaterThanOrEqual(2);
        });

        it("logs an error and continues when a parser init throws", async () => {
            const { conlog } = await import("../../src/common");
            mockInit.mockRejectedValueOnce(new Error("WASM load failed"));

            parserManager.register("fail-lang", "fail.wasm", "Fail");

            // Should not throw even though one parser failed
            await expect(parserManager.initAll()).resolves.toBeUndefined();
            expect(vi.mocked(conlog)).toHaveBeenCalled();
        });
    });

    describe("parseWithCache()", () => {
        it("throws when the language is not registered", () => {
            expect(() => parserManager.parseWithCache("unregistered-parse-lang", "text")).toThrow(
                "No parser registered for language: unregistered-parse-lang",
            );
        });

        it("delegates to the module's parseWithCache for a registered language", () => {
            const fakeTree = { rootNode: {} };
            mockParseWithCache.mockReturnValue(fakeTree);
            parserManager.register("parse-lang", "p.wasm", "P");

            const result = parserManager.parseWithCache("parse-lang", "some text");

            expect(mockParseWithCache).toHaveBeenCalledWith("some text");
            expect(result).toBe(fakeTree);
        });
    });

    describe("getParser()", () => {
        it("throws when the language is not registered", () => {
            expect(() => parserManager.getParser("unregistered-getparser-lang")).toThrow(
                "No parser registered for language: unregistered-getparser-lang",
            );
        });

        it("delegates to the module's getParser for a registered language", () => {
            const fakeParser = { parse: vi.fn() };
            mockGetParser.mockReturnValue(fakeParser);
            parserManager.register("getparser-lang", "gp.wasm", "GP");

            const result = parserManager.getParser("getparser-lang");

            expect(mockGetParser).toHaveBeenCalled();
            expect(result).toBe(fakeParser);
        });
    });
});
