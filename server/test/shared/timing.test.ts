/**
 * Tests for shared/timing.ts - the latency-measuring primitive the LSP server's request wrapper and the
 * extension host's expensive-operation logging both run on.
 */

import { describe, expect, it, vi } from "vitest";
import { timed } from "../../../shared/timing";

const sink = (warn: (message: string) => void, thresholdMs = 50) => ({ warn, thresholdMs, tag: "test-timing" });

/** Burn the clock for at least `ms`; a sleep would not, since the work under test is synchronous. */
function spin(ms: number): void {
    const until = performance.now() + ms;
    while (performance.now() < until) {
        /* deliberate busy-wait: this measures a BLOCKING operation */
    }
}

describe("timed", () => {
    it("returns the work's value and stays quiet below the threshold", () => {
        const warn = vi.fn();
        expect(timed("fast", sink(warn), () => 42)).toBe(42);
        expect(warn).not.toHaveBeenCalled();
    });

    it("reports the operation and its elapsed time once past the threshold", () => {
        const warn = vi.fn();
        timed("slow", sink(warn, 5), () => spin(20));
        expect(warn).toHaveBeenCalledTimes(1);
        expect(warn.mock.calls[0]?.[0]).toMatch(/^\[test-timing] slow took \d+ms$/);
    });

    it("reports a throw with its elapsed time, and lets the error through", () => {
        const warn = vi.fn();
        expect(() => timed("boom", sink(warn, 5), () => spin(20))).not.toThrow();
        warn.mockClear();
        expect(() =>
            timed("boom", sink(warn, 5), () => {
                throw new Error("nope");
            }),
        ).toThrow("nope");
        expect(warn.mock.calls[0]?.[0]).toMatch(/^\[test-timing] boom threw after \d+ms$/);
    });

    it("measures asynchronous work to its settlement, not to when it was started", async () => {
        const warn = vi.fn();
        const value = await timed("async", sink(warn, 5), async () => {
            await new Promise((resolve) => {
                setTimeout(resolve, 25);
            });
            return "done";
        });
        expect(value).toBe("done");
        expect(warn.mock.calls[0]?.[0]).toMatch(/^\[test-timing] async took \d+ms$/);
    });

    it("reports a rejection, and leaves the rejection rejecting", async () => {
        const warn = vi.fn();
        await expect(
            timed("asyncBoom", sink(warn, 0), async () => {
                await new Promise((resolve) => {
                    setTimeout(resolve, 5);
                });
                throw new Error("async nope");
            }),
        ).rejects.toThrow("async nope");
        expect(warn.mock.calls[0]?.[0]).toMatch(/^\[test-timing] asyncBoom threw after \d+ms$/);
    });
});
