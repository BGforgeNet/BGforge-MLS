/**
 * The gallery worker's decision logic, driven without a worker thread.
 *
 * The message contract is pinned here too: everything crossing to the worker goes through structured clone,
 * so a field that does not survive a JSON round trip is a bug that would only surface in the live panel.
 */
import { describe, expect, it, vi } from "vitest";
import { type ResourceLocation } from "@bgforge/binary";
import { type GalleryResponse, makePageCache, runJob } from "../src/gallery/worker-core";
import { bam, bamV2WithPages, pngSize } from "./image-fixtures";

const FILE_AT: ResourceLocation = { kind: "file", path: "/game/override/GUI.BAM" };
const BIF_AT: ResourceLocation = { kind: "bif", archivePath: "/game/data/gui.bif", entry: 3, tileset: false };

describe("runJob", () => {
    /**
     * A thrown non-Error still has to reach the panel as a readable reason. Node's own IO throws Errors,
     * so only a dependency throwing a string or an object gets here - and that is exactly the case where
     * a bare `.message` read would put `undefined` in front of the reader instead of the cause.
     */
    it("reports a thrown non-Error as its own text", () => {
        const out = runJob(
            { id: 9, kind: "thumbnail", item: "ODD.BAM", at: FILE_AT, ext: "bam", size: 64 },
            {
                readBytes: () => {
                    // eslint-disable-next-line no-throw-literal -- the non-Error throw is what this pins
                    throw "the archive said no";
                },
            },
        );
        expect(out).toEqual<GalleryResponse>({
            id: 9,
            kind: "error",
            item: "ODD.BAM",
            message: "the archive said no",
        });
    });

    it("asks for pages before decoding a v2 item", () => {
        const readBytes = vi.fn().mockReturnValue(bamV2WithPages(12).bam);
        const out = runJob(
            { id: 1, kind: "thumbnail", item: "GUI.BAM", at: FILE_AT, ext: "bam", size: 64 },
            {
                readBytes,
            },
        );
        expect(out).toEqual<GalleryResponse>({
            id: 1,
            kind: "needPages",
            item: "GUI.BAM",
            pages: ["MOS0012.PVRZ"],
        });
    });

    it("decodes a v1 item in one phase", () => {
        const readBytes = vi.fn().mockReturnValue(bam(32));
        const out = runJob(
            { id: 2, kind: "thumbnail", item: "I.BAM", at: BIF_AT, ext: "bam", size: 64 },
            {
                readBytes,
            },
        );
        expect(out.kind).toBe("thumbnail");
        expect(readBytes).toHaveBeenCalledWith(BIF_AT);
        if (out.kind !== "thumbnail") return;
        expect(pngSize(out.dataUri!)).toEqual({ width: 32, height: 32 });
    });

    it("draws a v2 item once the host supplies its page locators", () => {
        const { bam: v2, pages } = bamV2WithPages(12);
        const pageAt: ResourceLocation = { kind: "file", path: "/game/override/MOS0012.PVRZ" };
        const readBytes = vi.fn((at: ResourceLocation) => (at === pageAt ? pages.get(12)! : v2));
        const out = runJob(
            {
                id: 3,
                kind: "pages",
                item: "GUI.BAM",
                at: FILE_AT,
                ext: "bam",
                size: 64,
                pages: { "MOS0012.PVRZ": pageAt },
            },
            { readBytes },
        );
        expect(out.kind).toBe("thumbnail");
        if (out.kind !== "thumbnail") return;
        expect(pngSize(out.dataUri!)).toEqual({ width: 8, height: 8 });
    });

    it("draws nothing rather than failing when a page the game lacks is reported as null", () => {
        const readBytes = vi.fn().mockReturnValue(bamV2WithPages(12).bam);
        const out = runJob(
            {
                id: 4,
                kind: "pages",
                item: "GUI.BAM",
                at: FILE_AT,
                ext: "bam",
                size: 64,
                pages: { "MOS0012.PVRZ": null },
            },
            { readBytes },
        );
        expect(out).toEqual<GalleryResponse>({ id: 4, kind: "thumbnail", item: "GUI.BAM", dataUri: undefined });
    });

    it("reports an unreadable archive as a per-item error, not a throw", () => {
        const readBytes = vi.fn(() => {
            throw new Error("ENOENT: no such file");
        });
        const out = runJob(
            { id: 5, kind: "thumbnail", item: "X.BAM", at: BIF_AT, ext: "bam", size: 64 },
            {
                readBytes,
            },
        );
        expect(out).toMatchObject({ id: 5, kind: "error", item: "X.BAM" });
        if (out.kind !== "error") return;
        expect(out.message).toMatch(/ENOENT/);
    });

    it("survives a structured-clone round trip in both directions", () => {
        const request = {
            id: 6,
            kind: "thumbnail",
            item: "I.BAM",
            at: BIF_AT,
            ext: "bam",
            size: 64,
        } as const;
        expect(structuredClone(request)).toEqual(request);
        const out = runJob(request, { readBytes: () => bam(8) });
        expect(structuredClone(out)).toEqual(out);
    });
});

describe("makePageCache", () => {
    it("loads a shared page once across items", () => {
        const load = vi.fn((name: string) => new Uint8Array([name.length]));
        const cache = makePageCache(load);
        cache.get("MOS0012.PVRZ");
        cache.get("MOS0012.PVRZ");
        expect(load).toHaveBeenCalledTimes(1);
    });

    // A page the game does not have is a miss worth remembering: without this, every frame referencing it
    // would retry the read, which is the case the cache exists to prevent.
    it("remembers a miss instead of re-reading it", () => {
        const load = vi.fn(() => undefined);
        const cache = makePageCache(load);
        expect(cache.get("MISSING.PVRZ")).toBeUndefined();
        expect(cache.get("MISSING.PVRZ")).toBeUndefined();
        expect(load).toHaveBeenCalledTimes(1);
    });
});
