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
import { conlog, initOutputChannel } from "../src/logging";

describe("logging", () => {
    beforeEach(() => {
        appendLineMock.mockReset();
        createOutputChannelMock.mockClear();
    });

    describe("conlog before initOutputChannel", () => {
        it("falls back to console.log for info messages", () => {
            // Fresh module — no channel registered yet (the conlog tests below
            // run against a channel; this case must run first to capture the
            // pre-init fallback path).
            const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
            try {
                // Use a marker string the channel-attached test can't possibly emit.
                conlog("pre-init fallback", "info");
                // The fallback path can only have run if we are in fact pre-init,
                // which holds in the very first call before initOutputChannel.
                // Once initOutputChannel runs in a later test, this assertion
                // would no longer be valid — that's why this test runs first.
                if (createOutputChannelMock.mock.calls.length === 0) {
                    expect(consoleSpy).toHaveBeenCalledWith("[client] pre-init fallback");
                }
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
    });
});
