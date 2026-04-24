/**
 * Tests for shared/parser-factory.ts - tree-sitter parser factory with caching.
 */

import { describe, expect, it, vi, beforeEach } from "vitest";

// Mock the dependencies
vi.mock("fs", () => ({
    default: {
        readFileSync: vi.fn(() => new Uint8Array([0, 97, 115, 109])), // Minimal WASM header
    },
    readFileSync: vi.fn(() => new Uint8Array([0, 97, 115, 109])),
}));

vi.mock("web-tree-sitter", () => {
    const mockTree = { rootNode: { type: "source_file" } };
    const mockParser = {
        parse: vi.fn(() => mockTree),
        setLanguage: vi.fn(),
    };
    const mockLanguage = {};

    return {
        Parser: {
            init: vi.fn(),
        },
        Language: {
            load: vi.fn(() => Promise.resolve(mockLanguage)),
        },
        // Factory function for creating mock parsers
        _createMockParser: () => ({
            parse: vi.fn(() => mockTree),
            setLanguage: vi.fn(),
        }),
        _getMockParser: () => mockParser,
    };
});

// Import after mocking
import { createParserModule, createCachedParserModule } from "../../src/shared/parser-factory";

describe("shared/parser-factory", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    describe("createParserModule()", () => {
        it("should create a parser module", () => {
            const module = createParserModule("test.wasm", "Test");

            expect(module).toHaveProperty("init");
            expect(module).toHaveProperty("getParser");
            expect(module).toHaveProperty("isInitialized");
        });

        it("should not be initialized before init()", () => {
            const module = createParserModule("test.wasm", "Test");

            expect(module.isInitialized()).toBe(false);
        });

        it("should throw when getParser() called before init()", () => {
            const module = createParserModule("test.wasm", "Test");

            expect(() => module.getParser()).toThrow("Test parser not initialized");
        });

        // Note: Testing init() requires complex WASM mocking
        // The integration is tested via E2E tests instead
    });

    describe("createCachedParserModule()", () => {
        it("should create a cached parser module with cache methods", () => {
            const module = createCachedParserModule("test.wasm", "Test");

            expect(module).toHaveProperty("parseWithCache");
            expect(module).toHaveProperty("invalidateCache");
        });

        it("should return null from parseWithCache when not initialized", () => {
            const module = createCachedParserModule("test.wasm", "Test");

            const result = module.parseWithCache("test content");

            expect(result).toBeNull();
        });

        it("should invalidate cache without error", () => {
            const module = createCachedParserModule("test.wasm", "Test");

            // Should not throw
            expect(() => module.invalidateCache()).not.toThrow();
            expect(() => module.invalidateCache("some text")).not.toThrow();
        });

        it("should have a default cache size suitable for editor workloads", () => {
            // Guard against silent regression to the old size-10 default.
            // Loading the module source keeps the constant internal (not exported).
            const fs = require("fs");
            const path = require("path");
            const source = fs.readFileSync(
                path.join(__dirname, "../../src/shared/parser-factory.ts"),
                "utf-8",
            );
            const match = source.match(/DEFAULT_MAX_CACHE_SIZE\s*=\s*(\d+)/);
            expect(match).not.toBeNull();
            const defaultSize = Number(match![1]);
            expect(defaultSize).toBeGreaterThanOrEqual(32);
        });
    });
});
