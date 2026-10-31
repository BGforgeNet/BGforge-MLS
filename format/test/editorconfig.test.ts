/**
 * Tests for getEditorconfigSettings: section matching, the upward walk with nearest-wins precedence, `root = true`,
 * and errors from an `.editorconfig` that exists but cannot be read or parsed.
 */

import * as path from "path";
import { describe, expect, it, vi, beforeEach } from "vitest";

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

import { getEditorconfigSettings } from "@bgforge/format";

/** The `.editorconfig` path in `dir`, built the way the reader builds it so the keys match on every platform. */
function configIn(dir: string): string {
    return path.join(dir, ".editorconfig");
}

/** Serves the given `.editorconfig` contents by directory; every other path does not exist. */
function withConfigs(configs: Record<string, string>): void {
    const byPath = new Map(Object.entries(configs).map(([dir, content]) => [configIn(dir), content]));
    mockExistsSync.mockImplementation((p: string) => byPath.has(p));
    mockReadFileSync.mockImplementation((p: string) => {
        const content = byPath.get(p);
        if (content === undefined) throw new Error(`unexpected read of ${p}`);
        return content;
    });
}

describe("getEditorconfigSettings()", () => {
    beforeEach(() => {
        mockExistsSync.mockReset();
        mockReadFileSync.mockReset();
    });

    it("returns nulls when no .editorconfig exists", () => {
        withConfigs({});

        expect(getEditorconfigSettings("/path/to/file.txt")).toEqual({ indentSize: null, maxLineLength: null });
    });

    it("reads indent_size and max_line_length from a [*] section", () => {
        withConfigs({ "/path/to": "[*]\nindent_size = 4\nmax_line_length = 100\n" });

        expect(getEditorconfigSettings("/path/to/file.txt")).toEqual({ indentSize: 4, maxLineLength: 100 });
    });

    it("treats max_line_length = off as no limit", () => {
        withConfigs({ "/path/to": "[*]\nmax_line_length = off\n" });

        expect(getEditorconfigSettings("/path/to/file.txt").maxLineLength).toBeNull();
    });

    it("returns null for a value that is not a number", () => {
        withConfigs({ "/path/to": "[*]\nindent_size = invalid\nmax_line_length = invalid\n" });

        expect(getEditorconfigSettings("/path/to/file.txt")).toEqual({ indentSize: null, maxLineLength: null });
    });

    it("matches an exact filename section and not another file", () => {
        withConfigs({ "/path/to": "[Makefile]\nindent_size = 8\n" });

        expect(getEditorconfigSettings("/path/to/Makefile").indentSize).toBe(8);
        expect(getEditorconfigSettings("/path/to/other.txt").indentSize).toBeNull();
    });

    it("applies a [*.ext] section to that extension only", () => {
        withConfigs({ "/proj": "[*.ssl]\nindent_size = 2\n" });

        expect(getEditorconfigSettings("/proj/a.ssl").indentSize).toBe(2);
        expect(getEditorconfigSettings("/proj/a.d").indentSize).toBeNull();
    });

    it("applies a [*.{a,b}] section to every listed extension", () => {
        withConfigs({ "/proj": "[*.{d,tp2}]\nindent_size = 3\n" });

        expect(getEditorconfigSettings("/proj/a.d").indentSize).toBe(3);
        expect(getEditorconfigSettings("/proj/setup.tp2").indentSize).toBe(3);
        expect(getEditorconfigSettings("/proj/a.ssl").indentSize).toBeNull();
    });

    it("lets a later matching section in the same file override an earlier one", () => {
        withConfigs({ "/proj": "[*]\nindent_size = 4\n\n[*.ssl]\nindent_size = 2\n" });
        expect(getEditorconfigSettings("/proj/a.ssl").indentSize).toBe(2);

        withConfigs({ "/proj": "[*.ssl]\nindent_size = 2\n\n[*]\nindent_size = 4\n" });
        expect(getEditorconfigSettings("/proj/a.ssl").indentSize).toBe(4);
    });

    it("reads keys case-insensitively and skips # and ; comments", () => {
        withConfigs({ "/proj": "# comment\n; another\n[*]\nIndent_Size = 2\n  MAX_LINE_LENGTH=90  \n" });

        expect(getEditorconfigSettings("/proj/a.ssl")).toEqual({ indentSize: 2, maxLineLength: 90 });
    });

    it("lets a nearer .editorconfig override its parent for the same key", () => {
        withConfigs({
            "/parent": "[*]\nindent_size = 8\nmax_line_length = 100\n",
            "/parent/child": "[*]\nindent_size = 2\n",
        });

        // indent_size comes from the child, max_line_length from the parent, which the child does not set.
        expect(getEditorconfigSettings("/parent/child/file.txt")).toEqual({ indentSize: 2, maxLineLength: 100 });
    });

    it("lets a nearer max_line_length = off override a parent's limit", () => {
        withConfigs({
            "/parent": "[*]\nmax_line_length = 100\n",
            "/parent/child": "[*]\nmax_line_length = off\n",
        });

        expect(getEditorconfigSettings("/parent/child/file.txt").maxLineLength).toBeNull();
    });

    it("stops the walk at root = true", () => {
        withConfigs({
            "/parent": "[*]\nindent_size = 8\nmax_line_length = 100\n",
            "/parent/child": "root = TRUE\n\n[*]\nindent_size = 2\n",
        });

        expect(getEditorconfigSettings("/parent/child/file.txt")).toEqual({ indentSize: 2, maxLineLength: null });
        expect(mockReadFileSync).not.toHaveBeenCalledWith(configIn("/parent"), "utf-8");
    });

    it("ignores root = true inside a section", () => {
        withConfigs({
            "/parent": "[*]\nmax_line_length = 100\n",
            "/parent/child": "[*]\nroot = true\nindent_size = 2\n",
        });

        expect(getEditorconfigSettings("/parent/child/file.txt")).toEqual({ indentSize: 2, maxLineLength: 100 });
    });

    it("returns nulls for an empty file", () => {
        withConfigs({ "/path/to": "" });

        expect(getEditorconfigSettings("/path/to/file.txt")).toEqual({ indentSize: null, maxLineLength: null });
    });

    it("throws, naming the file, when an .editorconfig cannot be read", () => {
        mockExistsSync.mockImplementation((p: string) => p === configIn("/path/to"));
        mockReadFileSync.mockImplementation(() => {
            throw new Error("Permission denied");
        });

        expect(() => getEditorconfigSettings("/path/to/file.txt")).toThrow(
            `${configIn("/path/to")}: Permission denied`,
        );
    });

    it("throws, naming the file and line, on a line that is neither a section nor key = value", () => {
        withConfigs({ "/path/to": "[*]\nindent_size = 4\nindent_size\n" });

        expect(() => getEditorconfigSettings("/path/to/file.txt")).toThrow(
            `${configIn("/path/to")}:3: expected a [section] header or a key = value line, got "indent_size"`,
        );
    });
});
