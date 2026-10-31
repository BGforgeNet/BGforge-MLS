/**
 * Tests for shared/static-data.ts - loadStaticMap helper.
 * Covers the happy path (data file found) and the fallback branch (file missing or unreadable)
 * that returns an empty Map (line 36).
 */

import { describe, expect, it, vi, beforeEach } from "vitest";

// Mock fs.readFileSync before importing the module under test
vi.mock("fs", () => ({
    readFileSync: vi.fn(),
}));

// Mock conlog to avoid the LSP connection requirement
vi.mock("../../src/diagnostics", () => ({
    errorMessage: (err: unknown) => (err instanceof Error ? err.message : String(err)),
}));

vi.mock("../../src/logger", () => ({
    conlog: vi.fn(),
}));

import * as path from "path";
import { loadStaticMap } from "../../src/shared/static-data";
import { conlog } from "../../src/logger";
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

        it("warns naming the file and the error's own message when the file cannot be read", () => {
            mockReadFileSync.mockImplementation(() => {
                throw new Error("ENOENT: no such file or directory");
            });

            loadStaticMap<string>("hover", "nonexistent-lang");

            expect(vi.mocked(conlog)).toHaveBeenCalledTimes(1);
            expect(vi.mocked(conlog)).toHaveBeenCalledWith(
                `Failed to load static hover data for nonexistent-lang from ${path.join(
                    import.meta.dirname,
                    "../../src/shared/hover.nonexistent-lang.json",
                )}: ENOENT: no such file or directory`,
                "warn",
            );
        });

        it("warns when the file holds unparsable JSON", () => {
            mockReadFileSync.mockReturnValue("{not json");

            const result = loadStaticMap<string>("signature", "weidu-baf");

            expect(result.size).toBe(0);
            expect(vi.mocked(conlog)).toHaveBeenCalledTimes(1);
            const [message, level] = vi.mocked(conlog).mock.calls[0]!;
            expect(level).toBe("warn");
            expect(message).toMatch(
                /^Failed to load static signature data for weidu-baf from .*signature\.weidu-baf\.json: /,
            );
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
