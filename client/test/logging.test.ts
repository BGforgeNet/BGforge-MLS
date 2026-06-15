/**
 * Unit tests for the client extension's output-channel logging helper.
 * Validates both branches of `conlog` (channel set vs. unset) and the
 * `initOutputChannel` registration shape.
 */

import { vi, describe, expect, it, beforeEach } from "vitest";

const { createOutputChannelMock, appendLineMock } = vi.hoisted(() => {
    const inner = vi.fn();
    return {
        appendLineMock: inner,
        createOutputChannelMock: vi.fn(() => ({
            appendLine: inner,
            dispose: vi.fn(),
        })),
    };
});

vi.mock("vscode", () => ({
    window: {
        createOutputChannel: createOutputChannelMock,
    },
}));

// Imported after the mock so the module sees the fake `vscode`.
import { conlog, initOutputChannel, setDebugLogging } from "../src/logging";

describe("logging", () => {
    beforeEach(() => {
        appendLineMock.mockReset();
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

            expect(createOutputChannelMock).toHaveBeenCalledWith("BGforge MLS");
            expect(subscriptions).toHaveLength(1);
            expect(subscriptions[0]).toBe(channel);
        });
    });

    describe("conlog after initOutputChannel", () => {
        beforeEach(() => {
            const subscriptions: { dispose: () => void }[] = [];
            initOutputChannel({ subscriptions } as unknown as Parameters<typeof initOutputChannel>[0]);
            appendLineMock.mockReset();
        });

        it("tags info messages with [client] only", () => {
            conlog("hello", "info");
            expect(appendLineMock).toHaveBeenCalledWith("[client] hello");
        });

        it("defaults the level to info", () => {
            conlog("default level");
            expect(appendLineMock).toHaveBeenCalledWith("[client] default level");
        });

        it("tags warn messages with [client] [warn]", () => {
            conlog("careful", "warn");
            expect(appendLineMock).toHaveBeenCalledWith("[client] [warn] careful");
        });

        it("tags error messages with [client] [error]", () => {
            conlog("kaboom", "error");
            expect(appendLineMock).toHaveBeenCalledWith("[client] [error] kaboom");
        });

        it("drops debug messages when debug logging is off (default)", () => {
            // Default state: setDebugLogging(true) hasn't been called.
            conlog("noisy", "debug");
            expect(appendLineMock).not.toHaveBeenCalled();
        });

        it("emits debug messages when debug logging is on", () => {
            setDebugLogging(true);
            try {
                conlog("noisy", "debug");
                expect(appendLineMock).toHaveBeenCalledWith("[client] [debug] noisy");
            } finally {
                setDebugLogging(false);
            }
        });
    });
});
