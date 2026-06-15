/**
 * Unit tests for handleCompileError - the shared catch handler for
 * fire-and-forget compile() calls. A swallowed compile exception must always be
 * logged at error level (so it shows in the output channel), and an interactive
 * invocation must also surface a toast (the user explicitly asked to compile and
 * would otherwise see nothing); a non-interactive save/validate failure stays
 * log-only to avoid a toast on every save/keystroke.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const mockConlog = vi.fn();
vi.mock("../../src/logger", () => ({
    conlog: (...args: unknown[]) => mockConlog(...args),
}));

const mockShowError = vi.fn();
vi.mock("../../src/user-messages", () => ({
    showError: (...args: unknown[]) => mockShowError(...args),
}));

import { handleCompileError } from "../../src/handlers/compile-error";

describe("handleCompileError", () => {
    beforeEach(() => {
        vi.resetAllMocks();
    });

    it("logs at error level and surfaces a toast for interactive failures", () => {
        handleCompileError(new Error("boom"), true);
        expect(mockConlog).toHaveBeenCalledWith(expect.stringContaining("boom"), "error");
        expect(mockShowError).toHaveBeenCalledTimes(1);
        expect(mockShowError).toHaveBeenCalledWith(expect.stringContaining("boom"));
    });

    it("logs at error level but shows no toast for non-interactive failures", () => {
        handleCompileError(new Error("boom"), false);
        expect(mockConlog).toHaveBeenCalledWith(expect.stringContaining("boom"), "error");
        expect(mockShowError).not.toHaveBeenCalled();
    });

    it("stringifies a non-Error throwable", () => {
        handleCompileError("plain failure", true);
        expect(mockConlog).toHaveBeenCalledWith(expect.stringContaining("plain failure"), "error");
        expect(mockShowError).toHaveBeenCalledWith(expect.stringContaining("plain failure"));
    });
});
