import { describe, expect, it, vi } from "vitest";
import { locateEntry } from "../../../src/binary-editor/webview/state/list-window";

const row = (id: string) => ({ id, kind: "group", name: id }) as any;

describe("locateEntry", () => {
    it("finds a target within the bounded window without a full fetch", async () => {
        const windowRows = Array.from({ length: 256 }, (_, i) => row(`n${i}`));
        const fetch = vi.fn();
        const { index } = await locateEntry(fetch, windowRows, 256, "n100");
        expect(index).toBe(100);
        expect(fetch).not.toHaveBeenCalled();
    });

    it("fetches the full list to find a target beyond the window (the cross-record jump case)", async () => {
        const windowRows = Array.from({ length: 256 }, (_, i) => row(`n${i}`));
        const all = Array.from({ length: 4000 }, (_, i) => row(`n${i}`));
        const fetch = vi.fn(async () => ({ rows: all, total: 4000 }));
        const { rows, index } = await locateEntry(fetch, windowRows, 4000, "n3000");
        expect(index).toBe(3000);
        expect(rows).toBe(all);
        expect(fetch).toHaveBeenCalledWith(0, 4000);
    });

    it("returns -1 for an id absent from the full list", async () => {
        const windowRows = Array.from({ length: 256 }, (_, i) => row(`n${i}`));
        const all = Array.from({ length: 4000 }, (_, i) => row(`n${i}`));
        const fetch = vi.fn(async () => ({ rows: all, total: 4000 }));
        const { index } = await locateEntry(fetch, windowRows, 4000, "zzz");
        expect(index).toBe(-1);
    });

    it("does not fetch when the whole list is within the window, even if the id is absent", async () => {
        const windowRows = Array.from({ length: 10 }, (_, i) => row(`n${i}`));
        const fetch = vi.fn();
        const { index } = await locateEntry(fetch, windowRows, 10, "missing");
        expect(index).toBe(-1);
        expect(fetch).not.toHaveBeenCalled();
    });
});
