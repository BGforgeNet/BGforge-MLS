/**
 * Tests for shared/static-data.ts — loadStaticMap helper.
 * Covers the happy path (data file found) and the fallback branch (file missing or unreadable)
 * that returns an empty Map (line 36).
 */

import { describe, expect, it, vi, beforeEach } from "vitest";

// Mock fs.readFileSync before importing the module under test
vi.mock("fs", () => ({
    readFileSync: vi.fn(),
}));

// Mock conlog to avoid the LSP connection requirement
vi.mock("../../src/common", () => ({
    conlog: vi.fn(),
    errorMessage: (err: unknown) => (err instanceof Error ? err.message : String(err)),
}));

import { loadStaticMap } from "../../src/shared/static-data";
import { readFileSync } from "fs";

const mockReadFileSync = vi.mocked(readFileSync);

describe("shared/static-data", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    describe("loadStaticMap()", () => {
        it("returns a populated Map when the JSON file exists", () => {
            const data = { foo: "bar value", baz: "qux value" };
            mockReadFileSync.mockReturnValue(JSON.stringify(data));

            const result = loadStaticMap<string>("hover", "weidu-baf");

            expect(result.size).toBe(2);
            expect(result.get("foo")).toBe("bar value");
            expect(result.get("baz")).toBe("qux value");
        });

        it("returns an empty Map when the file cannot be read (fallback branch)", () => {
            mockReadFileSync.mockImplementation(() => {
                throw new Error("ENOENT: no such file or directory");
            });

            const result = loadStaticMap<string>("hover", "nonexistent-lang");

            expect(result).toBeInstanceOf(Map);
            expect(result.size).toBe(0);
        });

        it("returns an empty Map when the JSON contains an empty object", () => {
            mockReadFileSync.mockReturnValue("{}");

            const result = loadStaticMap<string>("signature", "weidu-baf");

            expect(result.size).toBe(0);
        });

        it("preserves structured values as Map entries", () => {
            const data = { MyAction: { description: "does something", params: [] } };
            mockReadFileSync.mockReturnValue(JSON.stringify(data));

            const result = loadStaticMap<{ description: string; params: unknown[] }>("hover", "weidu-baf");

            const entry = result.get("MyAction");
            expect(entry).toBeDefined();
            expect(entry?.description).toBe("does something");
        });
    });
});
