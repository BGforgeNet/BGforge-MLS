import { describe, expect, it } from "vitest";
import { cpuTimeMs, cpuTimeMsAsync } from "@bgforge/shared/cpu-time";

/** Holds the thread for `ms` of wall time without using the CPU, as a machine busy elsewhere would. */
function stall(ms: number): void {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT)), 0, 0, ms);
}

function compute(): number {
    let sum = 0;
    for (let i = 0; i < 30_000_000; i++) sum += i % 7;
    return sum;
}

describe("cpuTimeMs", () => {
    it("counts the time the work computes", () => {
        let sum = 0;
        const elapsed = cpuTimeMs(() => {
            sum = compute();
        });

        expect(sum).toBeGreaterThan(0);
        expect(elapsed).toBeGreaterThan(10);
    });

    it("does not count the time the work spends waiting", () => {
        expect(cpuTimeMs(() => stall(300))).toBeLessThan(100);
    });
});

describe("cpuTimeMsAsync", () => {
    it("counts the time the work computes", async () => {
        expect(await cpuTimeMsAsync(() => Promise.resolve(compute()))).toBeGreaterThan(10);
    });

    it("does not count the time the work spends waiting", async () => {
        expect(
            await cpuTimeMsAsync(async () => {
                await Promise.resolve();
                stall(300);
            }),
        ).toBeLessThan(100);
    });
});
