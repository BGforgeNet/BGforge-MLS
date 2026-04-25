/**
 * Tests for shared/format-options.ts — getFormatOptions reads editorconfig settings
 * and falls back to defaults (indent=4, lineLimit=120) when settings are unavailable.
 */

import { describe, expect, it, vi, beforeEach } from "vitest";

const mockGetEditorconfigSettings = vi.fn();

vi.mock("@bgforge/format", () => ({
    getEditorconfigSettings: (...args: unknown[]) => mockGetEditorconfigSettings(...args),
}));

import { getFormatOptions } from "../../src/shared/format-options";

const DEFAULT_INDENT = 4;
const DEFAULT_LINE_LIMIT = 120;

describe("shared/format-options", () => {
    beforeEach(() => {
        mockGetEditorconfigSettings.mockReset();
    });

    describe("getFormatOptions()", () => {
        it("returns defaults when editorconfig returns nulls", () => {
            mockGetEditorconfigSettings.mockReturnValue({ indentSize: null, maxLineLength: null });

            const result = getFormatOptions("file:///some/file.baf");

            expect(result.indentSize).toBe(DEFAULT_INDENT);
            expect(result.lineLimit).toBe(DEFAULT_LINE_LIMIT);
        });

        it("uses indentSize from editorconfig when present", () => {
            mockGetEditorconfigSettings.mockReturnValue({ indentSize: 2, maxLineLength: null });

            const result = getFormatOptions("file:///some/file.baf");

            expect(result.indentSize).toBe(2);
            expect(result.lineLimit).toBe(DEFAULT_LINE_LIMIT);
        });

        it("uses maxLineLength from editorconfig when present", () => {
            mockGetEditorconfigSettings.mockReturnValue({ indentSize: null, maxLineLength: 80 });

            const result = getFormatOptions("file:///some/file.baf");

            expect(result.indentSize).toBe(DEFAULT_INDENT);
            expect(result.lineLimit).toBe(80);
        });

        it("uses both editorconfig values when both are present", () => {
            mockGetEditorconfigSettings.mockReturnValue({ indentSize: 2, maxLineLength: 100 });

            const result = getFormatOptions("file:///some/file.baf");

            expect(result.indentSize).toBe(2);
            expect(result.lineLimit).toBe(100);
        });

        it("returns defaults when editorconfig throws", () => {
            mockGetEditorconfigSettings.mockImplementation(() => {
                throw new Error("Permission denied");
            });

            const result = getFormatOptions("file:///some/file.baf");

            expect(result.indentSize).toBe(DEFAULT_INDENT);
            expect(result.lineLimit).toBe(DEFAULT_LINE_LIMIT);
        });

        it("returns defaults for a non-file URI that cannot be converted", () => {
            // fileURLToPath will throw on non-file scheme, triggering the catch branch
            const result = getFormatOptions("unknown-scheme:///file.baf");

            expect(result.indentSize).toBe(DEFAULT_INDENT);
            expect(result.lineLimit).toBe(DEFAULT_LINE_LIMIT);
        });

        it("passes the file path (not URI) to getEditorconfigSettings", () => {
            mockGetEditorconfigSettings.mockReturnValue({ indentSize: null, maxLineLength: null });

            getFormatOptions("file:///home/user/mod/script.baf");

            expect(mockGetEditorconfigSettings).toHaveBeenCalledWith("/home/user/mod/script.baf");
        });
    });
});
