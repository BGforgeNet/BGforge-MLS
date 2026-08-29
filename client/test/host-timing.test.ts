/**
 * The extension host runs synchronous work that blocks the whole VS Code UI - opening a game parses
 * chitin.key and indexes every resource it names. The LSP server has reported its own slow requests for
 * a while; this is the same reporting for the host, which had none.
 */

import { describe, expect, it, vi } from "vitest";

const logged: Array<{ message: string; level: string }> = [];
vi.mock("../src/logging", () => ({
    conlog: (message: string, level = "info") => {
        logged.push({ message, level });
    },
}));

// Imported after vi.mock so the mocked logger is in place.
import { HOST_SLOW_MS, reportSlowFrame, timedHost } from "../src/timing";

/** Burn the clock; the point is to measure work that HOLDS the thread, which a sleep would not. */
function spin(ms: number): void {
    const until = performance.now() + ms;
    while (performance.now() < until) {
        /* deliberate busy-wait */
    }
}

describe("timedHost", () => {
    it("returns the work's value and says nothing about a fast operation", () => {
        logged.length = 0;
        expect(timedHost("quick", () => "value")).toBe("value");
        expect(logged).toEqual([]);
    });

    it("reports an operation that held the host past the budget, as a warning", () => {
        logged.length = 0;
        timedHost("openGame", () => spin(HOST_SLOW_MS + 30));
        expect(logged).toHaveLength(1);
        expect(logged[0]?.level).toBe("warn");
        expect(logged[0]?.message).toMatch(/^\[host-timing] openGame took \d+ms$/);
    });
});

/**
 * A webview measures its own stalls (client/src/webview-utils.ts observeSlowFrames) and posts them up,
 * because nothing outside its frame can see them. The host's job is to put the number somewhere readable,
 * naming which editor and which file - the two things the log line is useless without.
 */
describe("reportSlowFrame", () => {
    it("logs the editor, the file and the duration as a warning", () => {
        logged.length = 0;
        reportSlowFrame("Dialog editor", "bcarl.d", 412);
        expect(logged).toEqual([
            { message: "[webview-timing] Dialog editor (bcarl.d) blocked for 412ms", level: "warn" },
        ]);
    });
});
