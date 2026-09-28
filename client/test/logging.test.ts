/**
 * Unit tests for the client extension's output-channel logging helper.
 * Validates both branches of `conlog` (channel set vs. unset) and the
 * `initOutputChannel` registration shape.
 */

import { vi, describe, expect, it, beforeEach } from "vitest";

const { createOutputChannelMock, levelMocks } = vi.hoisted(() => {
    const levels = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), dispose: vi.fn() };
    return { levelMocks: levels, createOutputChannelMock: vi.fn(() => levels) };
});

vi.mock("vscode", () => ({
    window: {
        createOutputChannel: createOutputChannelMock,
    },
}));

// Imported after the mock so the module sees the fake `vscode`.
import { conlog, initOutputChannel } from "../src/logging";

describe("logging", () => {
    beforeEach(() => {
        for (const level of [levelMocks.debug, levelMocks.info, levelMocks.warn, levelMocks.error]) level.mockReset();
        createOutputChannelMock.mockClear();
    });

    describe("conlog before initOutputChannel", () => {
        it("falls back to console.log for info messages", async () => {
            // vi.resetModules() discards the cached logging module so the next
            // dynamic import() gets a fresh instance where outputChannel is
            // undefined - regardless of which other test ran first.
            // The top-level static bindings (conlog, initOutputChannel, ...) are
            // unaffected: they were bound at load time to the original instance
            // and stay valid for the rest of the suite.
            vi.resetModules();
            const { conlog: freshConlog } = await import("../src/logging");
            const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
            try {
                freshConlog("pre-init fallback", "info");
                expect(consoleSpy).toHaveBeenCalledWith("[client] pre-init fallback");
            } finally {
                consoleSpy.mockRestore();
            }
        });
    });

    describe("initOutputChannel", () => {
        it("creates a channel named 'BGforge MLS' and registers it for disposal", () => {
            const subscriptions: { dispose: () => void }[] = [];
            const context = { subscriptions } as unknown as Parameters<typeof initOutputChannel>[0];

            const channel = initOutputChannel(context);

            expect(createOutputChannelMock).toHaveBeenCalledWith("BGforge MLS", { log: true });
            expect(subscriptions).toHaveLength(1);
            expect(subscriptions[0]).toBe(channel);
        });
    });

    // Written at its own level, so the channel's "Set Log Level" decides what shows - a level spelled into
    // the text of an info line is one no filter can see.
    describe("conlog after initOutputChannel", () => {
        beforeEach(() => {
            const subscriptions: { dispose: () => void }[] = [];
            initOutputChannel({ subscriptions } as unknown as Parameters<typeof initOutputChannel>[0]);
        });

        it.each(["debug", "info", "warn", "error"] as const)("writes a %s line at that level", (level) => {
            conlog("hello", level);
            expect(levelMocks[level]).toHaveBeenCalledWith("[client] hello");
        });

        it("defaults the level to info", () => {
            conlog("default level");
            expect(levelMocks.info).toHaveBeenCalledWith("[client] default level");
        });
    });
});
