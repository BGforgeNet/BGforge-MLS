/**
 * Tests for shared/time-handler.ts - LSP request latency timing wrapper.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi, beforeEach, afterEach, type Mock } from "vitest";
import { timeHandler, makeTimingOptions, DEFAULT_THRESHOLD_MS } from "../../src/shared/time-handler";

describe("shared/time-handler", () => {
    let warnSpy: Mock<(message: string) => void>;

    beforeEach(() => {
        warnSpy = vi.fn<(message: string) => void>();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    describe("below-threshold: fast handler does NOT log", () => {
        it("sync handler completing instantly does not call warn", () => {
            const handler = timeHandler("testFast", () => 42, { warn: warnSpy, thresholdMs: 50 });
            const result = handler();
            expect(result).toBe(42);
            expect(warnSpy).not.toHaveBeenCalled();
        });

        it("async handler completing well under threshold does not call warn", async () => {
            const handler = timeHandler("testFastAsync", () => Promise.resolve("ok"), {
                warn: warnSpy,
                thresholdMs: 50,
            });
            const result = await handler();
            expect(result).toBe("ok");
            expect(warnSpy).not.toHaveBeenCalled();
        });
    });

    describe("above-threshold: slow handler DOES log with correct format", () => {
        it("async handler exceeding threshold logs the correct message", async () => {
            vi.useFakeTimers();
            const slowFn = (): Promise<string> =>
                new Promise((resolve) => {
                    setTimeout(() => resolve("done"), 60);
                });
            const handler = timeHandler("slowOp", slowFn, { warn: warnSpy, thresholdMs: 50 });
            const promise = handler();
            await vi.runAllTimersAsync();
            const result = await promise;
            expect(result).toBe("done");
            expect(warnSpy).toHaveBeenCalledOnce();
            const msg: string = warnSpy.mock.calls[0][0] as string;
            expect(msg).toMatch(/^\[lsp-timing\] slowOp took \d+ms$/);
        });
    });

    describe("throw: handler that throws logs elapsed time and rethrows", () => {
        it("sync handler that throws logs and rethrows the error", () => {
            const err = new Error("boom");
            const handler = timeHandler(
                "throwingOp",
                () => {
                    throw err;
                },
                { warn: warnSpy, thresholdMs: 0 },
            );
            expect(() => handler()).toThrow(err);
            expect(warnSpy).toHaveBeenCalledOnce();
            const msg: string = warnSpy.mock.calls[0][0] as string;
            expect(msg).toMatch(/^\[lsp-timing\] throwingOp threw after \d+ms$/);
        });

        it("async handler that rejects logs and rethrows the error", async () => {
            const err = new Error("async boom");
            const handler = timeHandler(
                "asyncThrow",
                async () => {
                    throw err;
                },
                { warn: warnSpy, thresholdMs: 0 },
            );
            await expect(handler()).rejects.toThrow(err);
            expect(warnSpy).toHaveBeenCalledOnce();
            const msg: string = warnSpy.mock.calls[0][0] as string;
            expect(msg).toMatch(/^\[lsp-timing\] asyncThrow threw after \d+ms$/);
        });
    });

    describe("sync handler: wrapper works with non-async handlers", () => {
        it("returns sync value directly without wrapping in a Promise", () => {
            const handler = timeHandler("syncCheck", () => 99, { warn: warnSpy, thresholdMs: 50 });
            const result = handler();
            // Must be the plain value, not a Promise
            expect(result).toBe(99);
            expect(result).not.toBeInstanceOf(Promise);
        });

        it("sync handler exceeding threshold logs the correct message", () => {
            // Use threshold -1 so elapsed >= 0ms always exceeds it on the sync path
            const handler = timeHandler("syncSlow", () => "value", { warn: warnSpy, thresholdMs: -1 });
            const result = handler();
            expect(result).toBe("value");
            expect(warnSpy).toHaveBeenCalledOnce();
            const msg: string = warnSpy.mock.calls[0][0] as string;
            expect(msg).toMatch(/^\[lsp-timing\] syncSlow took \d+ms$/);
        });
    });

    describe("makeTimingOptions", () => {
        it("routes warn through the console.warn method", () => {
            const consoleSpy = { warn: vi.fn() };
            const opts = makeTimingOptions(consoleSpy);
            opts.warn("hello");
            expect(consoleSpy.warn).toHaveBeenCalledWith("hello");
        });

        it("uses DEFAULT_THRESHOLD_MS when no threshold provided", () => {
            const opts = makeTimingOptions({ warn: vi.fn() });
            expect(opts.thresholdMs).toBe(DEFAULT_THRESHOLD_MS);
        });

        it("uses provided threshold when supplied", () => {
            const opts = makeTimingOptions({ warn: vi.fn() }, 100);
            expect(opts.thresholdMs).toBe(100);
        });
    });

    describe("drift check: architecture.md documents the current DEFAULT_THRESHOLD_MS value", () => {
        it("docs/architecture.md mentions the threshold value in the Latency Budgets section", () => {
            const archMdPath = path.resolve(__dirname, "../../../docs/architecture.md");
            const content = readFileSync(archMdPath, "utf-8");
            // Verify the docs cite the threshold value so code and docs stay in sync.
            // If DEFAULT_THRESHOLD_MS changes, update the Latency Budgets section in docs/architecture.md.
            const thresholdPattern = new RegExp(`DEFAULT_THRESHOLD_MS\\s*=\\s*${DEFAULT_THRESHOLD_MS}\\b`);
            expect(content).toMatch(thresholdPattern);
        });
    });
});
