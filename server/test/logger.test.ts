/**
 * The server's lines reach the client's output channel at their own level, so its "Set Log Level" decides
 * what shows. A `log` message carries no level: the client appends it unfiltered, whatever the setting.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const { remote } = vi.hoisted(() => ({
    remote: { log: vi.fn(), debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock("../src/lsp-connection", () => ({ getConnection: () => ({ console: remote }) }));

const { conlog, setDebugLogging } = await import("../src/logger");

describe("conlog", () => {
    beforeEach(() => {
        for (const method of Object.values(remote)) method.mockClear();
        setDebugLogging(false);
    });

    it.each(["info", "warn", "error"] as const)("sends a %s line at that level", (level) => {
        conlog("hello", level);
        expect(remote[level]).toHaveBeenCalledWith("hello");
        expect(remote.log).not.toHaveBeenCalled();
    });

    it("sends a debug line at debug level when debug logging is on", () => {
        setDebugLogging(true);
        conlog("noisy", "debug");
        expect(remote.debug).toHaveBeenCalledWith("noisy");
        expect(remote.log).not.toHaveBeenCalled();
    });

    // Some debug lines cost real work to build, so the setting still stops them at the source.
    it("sends no debug line while debug logging is off", () => {
        conlog("noisy", "debug");
        for (const method of Object.values(remote)) expect(method).not.toHaveBeenCalled();
    });
});
