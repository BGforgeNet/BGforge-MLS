/**
 * The grid's windowing and filtering - what keeps a game-wide gallery from decoding thousands of files to
 * show forty of them.
 */
import { describe, expect, it } from "vitest";
import { columnsFor, filterTiles, gridWindow, ladderSize, takeUnrequested } from "../src/gallery/webview/grid-window";
import { type GalleryTile } from "../src/gallery/webview/messages";

const tiles: GalleryTile[] = [
    { id: "ISW1H01.bam", label: "ISW1H01", ext: "bam" },
    { id: "ISW1H02.bam", label: "ISW1H02", ext: "bam" },
    { id: "IMOENM.bmp", label: "IMOENM", ext: "bmp" },
];

describe("filterTiles", () => {
    it("matches a case-insensitive substring of the label", () => {
        expect(filterTiles(tiles, "sw1h").map((t) => t.label)).toEqual(["ISW1H01", "ISW1H02"]);
        expect(filterTiles(tiles, "imoen").map((t) => t.label)).toEqual(["IMOENM"]);
    });

    it("returns everything for an empty or whitespace query", () => {
        expect(filterTiles(tiles, "")).toHaveLength(3);
        expect(filterTiles(tiles, "   ")).toHaveLength(3);
    });

    it("returns nothing rather than everything when nothing matches", () => {
        expect(filterTiles(tiles, "zzz")).toEqual([]);
    });
});

describe("columnsFor", () => {
    it("fits as many whole tiles as the width allows", () => {
        expect(columnsFor(400, 100)).toBe(4);
        expect(columnsFor(399, 100)).toBe(3);
    });

    // A panel dragged narrower than one tile still has to render something, and a zero column count would
    // divide by zero in the row arithmetic.
    it("never drops below one column", () => {
        expect(columnsFor(40, 100)).toBe(1);
        expect(columnsFor(0, 100)).toBe(1);
    });
});

describe("gridWindow", () => {
    const base = { total: 100, columns: 4, rowHeight: 100, viewportHeight: 300, overscan: 1 };

    it("mounts only the visible rows plus the overscan, not the whole list", () => {
        const w = gridWindow({ ...base, scrollTop: 0 });
        expect(w.firstRow).toBe(0);
        expect(w.lastRow).toBe(4); // 3 visible rows + 1 overscan
        expect(w.end - w.start).toBeLessThan(base.total);
    });

    it("moves the window as the grid scrolls", () => {
        const w = gridWindow({ ...base, scrollTop: 1000 });
        expect(w.firstRow).toBe(9); // row 10 is first visible, minus one overscan row
        expect(w.start).toBe(36);
    });

    // The scrollbar must reflect the whole grid: sizing the spacer to the mounted rows would make it jump as
    // the window moves, and the user could never reach the end.
    it("reports the full scrollable height, not the mounted height", () => {
        expect(gridWindow({ ...base, scrollTop: 0 }).totalHeight).toBe(25 * 100);
    });

    it("does not run past the end of a partly-filled last row", () => {
        const w = gridWindow({ ...base, total: 10, scrollTop: 0 });
        expect(w.end).toBeLessThanOrEqual(10);
        expect(w.totalHeight).toBe(3 * 100); // 10 items over 4 columns is 3 rows
    });

    it("handles an empty grid without producing a negative window", () => {
        const w = gridWindow({ ...base, total: 0, scrollTop: 0 });
        expect(w.start).toBe(0);
        expect(w.end).toBe(0);
        expect(w.totalHeight).toBe(0);
    });
});

describe("takeUnrequested", () => {
    // The grid re-examines its window on every reactive change, and a thumbnail arriving IS one. Filtering on
    // what has not been ANSWERED therefore re-asks for everything still outstanding, once per arrival: the
    // host answers each from its cache, and on a channel slower than the arrival rate those repeated replies
    // queue without bound. Asking once per item is what makes the window's request count O(items).
    it("returns an id once, however many times the same window is re-examined", () => {
        const asked = new Set<string>();
        expect(takeUnrequested(["a", "b"], 64, asked)).toEqual(["a", "b"]);
        expect(takeUnrequested(["a", "b"], 64, asked)).toEqual([]);
        expect(takeUnrequested(["a", "b", "c"], 64, asked)).toEqual(["c"]);
    });

    // A cached answer is per (item, size), so a size change is a genuinely different picture to ask for.
    it("asks again at a size it has not asked at", () => {
        const asked = new Set<string>();
        takeUnrequested(["a"], 64, asked);
        expect(takeUnrequested(["a"], 128, asked)).toEqual(["a"]);
        expect(takeUnrequested(["a"], 64, asked)).toEqual([]);
    });
});

describe("ladderSize", () => {
    const LADDER = [32, 64, 96, 128] as const;

    it("rounds up to the first step that covers the drawn size", () => {
        expect(ladderSize(48, 1, LADDER)).toBe(64);
        expect(ladderSize(64, 1, LADDER)).toBe(64);
        expect(ladderSize(65, 1, LADDER)).toBe(96);
    });

    it("accounts for device pixels, so a retina tile is not drawn soft", () => {
        expect(ladderSize(48, 2, LADDER)).toBe(96);
    });

    // Capped at 2: past that the picture is already denser than any shipped art, and the encode cost grows
    // with the square of the factor.
    it("caps the device-pixel factor rather than growing without bound", () => {
        expect(ladderSize(48, 4, LADDER)).toBe(ladderSize(48, 2, LADDER));
    });

    it("never exceeds the largest ladder step", () => {
        expect(ladderSize(4000, 2, LADDER)).toBe(128);
    });
});
