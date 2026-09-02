import { describe, expect, it } from "vitest";
import { visibleRange } from "../src/virtual-window";

const cfg = { rowHeight: 20, viewportHeight: 200, overscan: 3, total: 10000 };

describe("virtual-window", () => {
    it("computes a [start,end) range around scrollTop", () => {
        const r = visibleRange({ ...cfg, scrollTop: 1000 }); // row 50 at top
        expect(r.start).toBe(50 - 3);
        expect(r.end).toBeLessThanOrEqual(50 + 10 + 3);
    });

    it("clamps to [0,total]", () => {
        expect(visibleRange({ ...cfg, scrollTop: 0 }).start).toBe(0);
        const end = visibleRange({ ...cfg, scrollTop: 10000 * 20 }).end;
        expect(end).toBe(10000);
    });

    it("bounds the visible row count independent of total", () => {
        // Max rows a window can hold: the rows visible in the viewport plus an overscan band on each side.
        const bound = Math.ceil(cfg.viewportHeight / cfg.rowHeight) + 2 * cfg.overscan;
        for (const total of [0, 5, 100, 10000, 100000]) {
            const r = visibleRange({ ...cfg, total, scrollTop: Math.floor(total / 2) * 20 });
            expect(r.end - r.start).toBeLessThanOrEqual(bound);
        }
    });
});
