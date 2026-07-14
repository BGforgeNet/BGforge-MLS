/**
 * Unit tests for core/format-only-provider.ts -- factory for format-only LanguageProviders.
 */

import { describe, expect, it, vi } from "vitest";
import type { FormatOutput } from "@bgforge/format";
import type { ProviderContext } from "../../src/core/capabilities";
import { defaultSettings } from "../../src/settings";
import { normalizeUri } from "../../src/core/normalized-uri";

// Mock the LSP connection module so conlog() (called from init()) has a connection to log through.
// getConnection must return the SAME object on every call (matching the real singleton-holder
// semantics of lsp-connection.ts) so a test can inspect calls recorded during provider.init().
const mockConsole = { log: vi.fn(), warn: vi.fn(), error: vi.fn() };
vi.mock("../../src/lsp-connection", () => ({
    getConnection: vi.fn(() => ({ console: mockConsole })),
    initLspConnection: vi.fn(),
}));

import { createFormatOnlyProvider } from "../../src/core/format-only-provider";
import { getConnection } from "../../src/lsp-connection";

const emptyContext: ProviderContext = {
    workspaceRoot: undefined,
    settings: defaultSettings,
};

const testUri = normalizeUri("file:///a.tra");

describe("createFormatOnlyProvider", () => {
    it("sets id from the constructor argument", () => {
        const provider = createFormatOnlyProvider("weidu-tra", () => ({ text: "x" }));
        expect(provider.id).toBe("weidu-tra");
    });

    it("init() logs an initialization message through the LSP connection and resolves", async () => {
        const provider = createFormatOnlyProvider("weidu-tra", () => ({ text: "x" }));
        await expect(provider.init(emptyContext)).resolves.toBeUndefined();
        const logFn = getConnection().console.log;
        expect(logFn).toHaveBeenCalledWith("weidu-tra provider initialized");
    });

    it("format() returns a full-document replacement edit when the formatted text differs", () => {
        const formatFn = (text: string): FormatOutput => ({ text: `${text}\nformatted` });
        const provider = createFormatOnlyProvider("weidu-tra", formatFn);

        const result = provider.format!("line one\nline two", testUri);

        expect(result.warning).toBeUndefined();
        expect(result.edits).toHaveLength(1);
        expect(result.edits[0]).toEqual({
            range: { start: { line: 0, character: 0 }, end: { line: 1, character: 8 } },
            newText: "line one\nline two\nformatted",
        });
    });

    it("format() returns no edits when the formatted text equals the original (no-op)", () => {
        const formatFn = (text: string): FormatOutput => ({ text });
        const provider = createFormatOnlyProvider("weidu-tra", formatFn);

        const result = provider.format!("unchanged text", testUri);

        expect(result).toEqual({ edits: [] });
    });

    it("format() returns a warning with no edits when FormatOutput carries one, even though the text also changed", () => {
        const formatFn = (): FormatOutput => ({ text: "would-be-different", warning: "invalid delimiter" });
        const provider = createFormatOnlyProvider("weidu-tra", formatFn);

        const result = provider.format!("original", testUri);

        // The warning branch is checked first in the implementation, so a warning
        // must suppress edits even when out.text differs from the input.
        expect(result).toEqual({ edits: [], warning: "invalid delimiter" });
    });

    it("format() propagates an error thrown by formatFn rather than swallowing it", () => {
        const formatFn = (): FormatOutput => {
            throw new Error("formatter exploded");
        };
        const provider = createFormatOnlyProvider("weidu-tra", formatFn);

        expect(() => provider.format!("text", testUri)).toThrow("formatter exploded");
    });

    it("two provider instances keep independent id and formatFn -- no shared state", () => {
        const traProvider = createFormatOnlyProvider("weidu-tra", () => ({ text: "TRA" }));
        const msgProvider = createFormatOnlyProvider("fallout-msg", () => ({ text: "MSG" }));

        expect(traProvider.id).toBe("weidu-tra");
        expect(msgProvider.id).toBe("fallout-msg");
        expect(traProvider.format!("x", testUri).edits[0]?.newText).toBe("TRA");
        expect(msgProvider.format!("x", testUri).edits[0]?.newText).toBe("MSG");
    });

    describe("traExt-gated symbols/foldingRanges", () => {
        it("does not implement symbols/foldingRanges when traExt is omitted", () => {
            const provider = createFormatOnlyProvider("fallout-scripts-lst", () => ({ text: "x" }));

            expect(provider.symbols).toBeUndefined();
            expect(provider.foldingRanges).toBeUndefined();
        });

        it("implements symbols() over the entries, keyed as @N, when traExt is 'tra'", () => {
            const provider = createFormatOnlyProvider("weidu-tra", () => ({ text: "x" }), "tra");

            const symbols = provider.symbols!("@1 = ~One~\n");
            expect(symbols).toHaveLength(1);
            expect(symbols[0]!.name).toBe("@1");
        });

        it("implements symbols() over the entries, keyed as {N}, when traExt is 'msg'", () => {
            const provider = createFormatOnlyProvider("fallout-msg", () => ({ text: "x" }), "msg");

            const symbols = provider.symbols!("{1}{}{One}\n");
            expect(symbols).toHaveLength(1);
            expect(symbols[0]!.name).toBe("{1}");
        });

        it("implements foldingRanges() for a multiline entry when traExt is 'tra'", () => {
            const provider = createFormatOnlyProvider("weidu-tra", () => ({ text: "x" }), "tra");

            const ranges = provider.foldingRanges!("@1 = ~One\nTwo~\n");
            expect(ranges).toEqual([{ startLine: 0, endLine: 1 }]);
        });
    });
});
