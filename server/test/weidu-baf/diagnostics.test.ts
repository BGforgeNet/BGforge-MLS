/**
 * Unit tests for weidu-baf/diagnostics.ts - which compiler runBafDiagnostics dispatches to.
 */

import { describe, expect, it, vi, beforeEach } from "vitest";

const mockWeiduCompile = vi.fn().mockResolvedValue(undefined);
vi.mock("../../src/weidu-compile", () => ({
    compile: (...args: unknown[]) => mockWeiduCompile(...args),
}));

const mockShowWarning = vi.fn();
vi.mock("../../src/user-messages", () => ({
    showInfo: vi.fn(),
    showWarning: (...args: unknown[]) => mockShowWarning(...args),
    showError: vi.fn(),
}));

// A parser that reports itself initialized, and a game that opens but yields neither table, so the
// tables/style-undefined arm is reachable without a real grammar or install on disk.
vi.mock("../../../shared/parsers/parser-manager", () => ({
    parserManager: { isInitialized: () => true },
}));

const mockConfiguredGame = { tables: vi.fn(), scriptStyle: vi.fn() };
vi.mock("../../src/server-context", () => ({
    getServerContext: () => Promise.resolve({ configuredGame: mockConfiguredGame }),
}));

import { runBafDiagnostics } from "../../src/weidu-baf/diagnostics";
import { defaultSettings } from "../../src/settings";
import { normalizeUri } from "../../src/core/normalized-uri";

const URI = normalizeUri("file:///mod/test.baf");

describe("runBafDiagnostics", () => {
    beforeEach(() => {
        mockWeiduCompile.mockClear();
        mockShowWarning.mockClear();
    });

    // Regression pin: the external route used to be gated on gamePath at this layer too, which meant an
    // unconfigured game silently produced no diagnostics and no warning on the default setting. It must
    // instead reach weiduCompile unconditionally, so weiduCompile's own gamePath guard and warning fire.
    it("reaches the external compiler even with no game configured, on the default setting", async () => {
        const settings = { ...defaultSettings, weidu: { ...defaultSettings.weidu, gamePath: "" } };

        const reached = await runBafDiagnostics(URI, "IF ... END", settings, true);

        expect(mockWeiduCompile).toHaveBeenCalledWith(URI, settings.weidu, true, "IF ... END");
        expect(reached).toBe(true);
    });

    it("warns instead of silently refusing when the built-in compiler has no game", async () => {
        const settings = {
            ...defaultSettings,
            weidu: { ...defaultSettings.weidu, gamePath: "", compiler: "built-in" as const },
        };

        const reached = await runBafDiagnostics(URI, "IF ... END", settings, true);

        expect(mockWeiduCompile).not.toHaveBeenCalled();
        expect(mockShowWarning).toHaveBeenCalledWith(expect.stringContaining("game"));
        expect(reached).toBe(false);
    });

    // Regression pin: a gamePath that is set but does not open (typo, moved install) used to fall through the
    // tables/style undefined arm with no warning at all - the built-in route went silently dark.
    it("warns naming the path when a configured gamePath fails to open", async () => {
        const settings = {
            ...defaultSettings,
            weidu: { ...defaultSettings.weidu, gamePath: "/not/a/real/game", compiler: "built-in" as const },
        };

        const reached = await runBafDiagnostics(URI, "IF ... END", settings, true);

        expect(mockWeiduCompile).not.toHaveBeenCalled();
        expect(mockShowWarning).toHaveBeenCalledWith(expect.stringContaining("/not/a/real/game"));
        expect(reached).toBe(false);
    });
});
