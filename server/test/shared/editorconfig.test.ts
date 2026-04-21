/**
 * Tests for shared/editorconfig.ts - editorconfig parsing utilities.
 *
 * Note: The 'ini' library has limitations with editorconfig-style sections.
 * Sections like [*.txt] are parsed as nested objects, not separate sections.
 * Only simple sections like [*], exact filenames, and brace patterns work correctly.
 */

import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

// Mock fs module before importing the module under test
const mockExistsSync = vi.fn();
const mockReadFileSync = vi.fn();
vi.mock("fs", () => ({
    default: {
        existsSync: (...args: unknown[]) => mockExistsSync(...args),
        readFileSync: (...args: unknown[]) => mockReadFileSync(...args),
    },
    existsSync: (...args: unknown[]) => mockExistsSync(...args),
    readFileSync: (...args: unknown[]) => mockReadFileSync(...args),
}));

import { getEditorconfigSettings } from "../../src/shared/editorconfig";

describe("shared/editorconfig", () => {
    beforeEach(() => {
        mockExistsSync.mockReset();
        mockReadFileSync.mockReset();
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    describe("getEditorconfigSettings()", () => {
        it("should return nulls when no .editorconfig exists", () => {
            mockExistsSync.mockReturnValue(false);

            const result = getEditorconfigSettings("/path/to/file.txt");

            expect(result.indentSize).toBeNull();
            expect(result.maxLineLength).toBeNull();
        });

        it("should parse indent_size from .editorconfig with [*] section", () => {
            mockExistsSync.mockReturnValue(true);
            mockReadFileSync.mockReturnValue(`
[*]
indent_size = 4
`);

            const result = getEditorconfigSettings("/path/to/file.txt");

            expect(result.indentSize).toBe(4);
        });

        it("should parse max_line_length from .editorconfig", () => {
            mockExistsSync.mockReturnValue(true);
            mockReadFileSync.mockReturnValue(`
[*]
max_line_length = 120
`);

            const result = getEditorconfigSettings("/path/to/file.txt");

            expect(result.maxLineLength).toBe(120);
        });

        it("should parse string indent_size", () => {
            mockExistsSync.mockReturnValue(true);
            mockReadFileSync.mockReturnValue(`
[*]
indent_size = 2
`);

            const result = getEditorconfigSettings("/path/to/file.txt");

            expect(result.indentSize).toBe(2);
        });

        it("should ignore max_line_length = off", () => {
            mockExistsSync.mockReturnValue(true);
            mockReadFileSync.mockReturnValue(`
[*]
max_line_length = off
`);

            const result = getEditorconfigSettings("/path/to/file.txt");

            expect(result.maxLineLength).toBeNull();
        });

        it("should match * pattern for all files", () => {
            mockExistsSync.mockReturnValue(true);
            mockReadFileSync.mockReturnValue(`
[*]
indent_size = 3
`);

            const result = getEditorconfigSettings("/path/to/anyfile.xyz");

            expect(result.indentSize).toBe(3);
        });

        it("should match exact filename pattern", () => {
            mockExistsSync.mockReturnValue(true);
            mockReadFileSync.mockReturnValue(`
[Makefile]
indent_size = 8
`);

            const result = getEditorconfigSettings("/path/to/Makefile");

            expect(result.indentSize).toBe(8);
        });

        it("should stop at root = true", () => {
            mockExistsSync.mockImplementation((p: string) => p.includes("child"));
            mockReadFileSync.mockReturnValue(`
root = true

[*]
indent_size = 2
`);

            const result = getEditorconfigSettings("/parent/child/file.txt");

            expect(result.indentSize).toBe(2);
        });

        it("should handle read errors gracefully", () => {
            mockExistsSync.mockReturnValue(true);
            mockReadFileSync.mockImplementation(() => {
                throw new Error("Permission denied");
            });

            const result = getEditorconfigSettings("/path/to/file.txt");

            expect(result.indentSize).toBeNull();
            expect(result.maxLineLength).toBeNull();
        });

        it("should return both settings when found", () => {
            mockExistsSync.mockReturnValue(true);
            mockReadFileSync.mockReturnValue(`
[*]
indent_size = 4
max_line_length = 100
`);

            const result = getEditorconfigSettings("/path/to/file.txt");

            expect(result.indentSize).toBe(4);
            expect(result.maxLineLength).toBe(100);
        });

        it("should return null when section doesn't match filename", () => {
            mockExistsSync.mockReturnValue(true);
            mockReadFileSync.mockReturnValue(`
[specific.file]
indent_size = 4
`);

            const result = getEditorconfigSettings("/path/to/other.txt");

            expect(result.indentSize).toBeNull();
        });

        it("should handle empty config file", () => {
            mockExistsSync.mockReturnValue(true);
            mockReadFileSync.mockReturnValue("");

            const result = getEditorconfigSettings("/path/to/file.txt");

            expect(result.indentSize).toBeNull();
            expect(result.maxLineLength).toBeNull();
        });

        it("should handle invalid indent_size value", () => {
            mockExistsSync.mockReturnValue(true);
            mockReadFileSync.mockReturnValue(`
[*]
indent_size = invalid
`);

            const result = getEditorconfigSettings("/path/to/file.txt");

            expect(result.indentSize).toBeNull();
        });

        it("should handle invalid max_line_length value", () => {
            mockExistsSync.mockReturnValue(true);
            mockReadFileSync.mockReturnValue(`
[*]
max_line_length = invalid
`);

            const result = getEditorconfigSettings("/path/to/file.txt");

            expect(result.maxLineLength).toBeNull();
        });

        it("walks up to parent directory when settings not fully found", () => {
            // First directory has only indent_size, second has max_line_length
            mockExistsSync.mockReturnValue(true);
            mockReadFileSync
                .mockReturnValueOnce(`
[*]
indent_size = 2
`)
                .mockReturnValueOnce(`
[*]
max_line_length = 100
`);

            const result = getEditorconfigSettings("/parent/child/file.txt");

            expect(result.indentSize).toBe(2);
            // Walked up and found max_line_length in parent
            expect(result.maxLineLength).toBe(100);
        });
    });
});
