/**
 * The host's thumbnail routing. These are the performance guarantees the design rests on - that the host
 * resolves and posts rather than decoding, and that a re-scroll costs nothing - expressed as counts, which is
 * the only form of them a CI run can check.
 */
import { describe, expect, it, vi } from "vitest";
import { type GalleryRequest, type GalleryResponse } from "../src/gallery/worker-core";
import { type GallerySource, type Locator } from "../src/gallery/source";
import { ThumbnailPump } from "../src/gallery/panel-core";
import { type HostToWebview } from "../src/gallery/webview/messages";

const AT: Locator = { kind: "bif", archivePath: "/game/data/gui.bif", entry: 1, tileset: false };

function harness(overrides: Partial<GallerySource> = {}) {
    const posted: HostToWebview[] = [];
    const sent: GalleryRequest[] = [];
    const stamps = new Map<string, string>([
        ["ICON.bam", "bif:/game/data/gui.bif#1"],
        ["OTHER.bam", "bif:/game/data/gui.bif#2"],
    ]);
    const source: GallerySource = {
        kind: "game",
        list: () => [],
        locate: vi.fn(() => AT),
        stamp: vi.fn((id: string) => stamps.get(id)),
        locateAux: vi.fn(() => ({ kind: "file", path: "/game/override/MOS0012.PVRZ" }) as Locator),
        reveal: vi.fn(async () => {}),
        ...overrides,
    };
    const pump = new ThumbnailPump({
        source,
        post: (m) => posted.push(m),
        send: (r) => sent.push(r),
    });
    return { pump, posted, sent, source, stamps };
}

describe("ThumbnailPump", () => {
    it("dispatches one job per item and posts nothing until the worker answers", () => {
        const { pump, sent, posted } = harness();
        pump.request(["ICON.bam"], 64);
        expect(sent).toEqual([{ id: 1, kind: "thumbnail", item: "ICON.bam", at: AT, ext: "bam", size: 64 }]);
        expect(posted).toEqual([]);
    });

    /**
     * The host reads no bytes and decodes nothing - that is the whole reason the worker exists. Expressed as
     * "the source was asked to locate, and never to read", because a host that quietly decoded would still
     * produce correct pictures and would only show up as a frozen window.
     */
    it("resolves and posts only - it never reads or decodes", () => {
        const { pump, source } = harness();
        pump.request(["ICON.bam"], 64);
        expect(source.locate).toHaveBeenCalledWith("ICON.bam");
        expect(source.stamp).toHaveBeenCalled();
        expect(Object.keys(source)).not.toContain("read");
    });

    it("sends one job for the same item asked for twice before the first answers", () => {
        const { pump, sent } = harness();
        pump.request(["ICON.bam"], 64);
        pump.request(["ICON.bam"], 64);
        expect(sent).toHaveLength(1);
    });

    it("answers a re-scroll from cache without dispatching again", () => {
        const { pump, sent, posted } = harness();
        pump.request(["ICON.bam"], 64);
        pump.handle({ id: 1, kind: "thumbnail", item: "ICON.bam", dataUri: "data:image/png;base64,AAA" });
        posted.length = 0;
        pump.request(["ICON.bam"], 64);
        expect(sent).toHaveLength(1);
        expect(posted).toEqual([{ type: "thumbnail", id: "ICON.bam", dataUri: "data:image/png;base64,AAA" }]);
    });

    // The ladder exists so the cache keys on a few sizes; a different size is genuinely different art and
    // must not be served from the smaller one's entry.
    it("treats a different size as a different picture", () => {
        const { pump, sent } = harness();
        pump.request(["ICON.bam"], 64);
        pump.handle({ id: 1, kind: "thumbnail", item: "ICON.bam", dataUri: "x" });
        pump.request(["ICON.bam"], 128);
        expect(sent).toHaveLength(2);
    });

    // A workspace file edited while the gallery is open must redraw - the stamp is what carries that.
    it("re-dispatches when the item's stamp changes", () => {
        const { pump, sent, stamps } = harness();
        pump.request(["ICON.bam"], 64);
        pump.handle({ id: 1, kind: "thumbnail", item: "ICON.bam", dataUri: "x" });
        stamps.set("ICON.bam", "file:999:12");
        pump.request(["ICON.bam"], 64);
        expect(sent).toHaveLength(2);
    });

    it("answers a vanished item once rather than retrying it on every scroll", () => {
        const { pump, sent, posted } = harness({ stamp: vi.fn(() => undefined) });
        pump.request(["GONE.bam"], 64);
        pump.request(["GONE.bam"], 64);
        expect(sent).toEqual([]);
        expect(posted).toEqual([
            { type: "thumbnail", id: "GONE.bam" },
            { type: "thumbnail", id: "GONE.bam" },
        ]);
    });

    it("resolves a v2's pages and sends them back without reading any", () => {
        const { pump, sent, source } = harness();
        pump.request(["ICON.bam"], 64);
        pump.handle({ id: 1, kind: "needPages", item: "ICON.bam", pages: ["MOS0012.PVRZ"] });
        expect(source.locateAux).toHaveBeenCalledWith("MOS0012.PVRZ", "ICON.bam");
        expect(sent[1]).toMatchObject({
            kind: "pages",
            item: "ICON.bam",
            size: 64,
            pages: { "MOS0012.PVRZ": { kind: "file", path: "/game/override/MOS0012.PVRZ" } },
        });
    });

    // A page the game does not have is reported as null, not omitted: the worker must be able to tell "no
    // such page" from "the host forgot to answer for it".
    it("reports a page it cannot find as null", () => {
        const { pump, sent } = harness({ locateAux: vi.fn(() => undefined) });
        pump.request(["ICON.bam"], 64);
        pump.handle({ id: 1, kind: "needPages", item: "ICON.bam", pages: ["MOS0012.PVRZ"] });
        expect(sent[1]).toMatchObject({ pages: { "MOS0012.PVRZ": null } });
    });

    it("completes the two-phase exchange and caches the result", () => {
        const { pump, sent, posted } = harness();
        pump.request(["ICON.bam"], 64);
        pump.handle({ id: 1, kind: "needPages", item: "ICON.bam", pages: ["MOS0012.PVRZ"] });
        pump.handle({ id: 2, kind: "thumbnail", item: "ICON.bam", dataUri: "data:image/png;base64,BBB" });
        expect(posted).toEqual([{ type: "thumbnail", id: "ICON.bam", dataUri: "data:image/png;base64,BBB" }]);
        pump.request(["ICON.bam"], 64);
        expect(sent).toHaveLength(2); // nothing new dispatched
    });

    it("turns a worker error into an empty tile rather than a stuck one", () => {
        const { pump, posted } = harness();
        pump.request(["ICON.bam"], 64);
        pump.handle({ id: 1, kind: "error", item: "ICON.bam", message: "ENOENT" });
        expect(posted).toEqual([{ type: "thumbnail", id: "ICON.bam", dataUri: undefined }]);
    });

    // Distinct from a vanished STAMP: the source still knows the item but can no longer say where it is - an
    // uninstalled archive, say. Answered once and cached, so the tile stops asking.
    it("answers an item it cannot locate once, and caches that answer", () => {
        const { pump, sent, posted } = harness({ locate: vi.fn(() => undefined) });
        pump.request(["ICON.bam"], 64);
        pump.request(["ICON.bam"], 64);
        expect(sent).toEqual([]);
        expect(posted).toHaveLength(2);
        expect(posted[0]).toEqual({ type: "thumbnail", id: "ICON.bam" });
    });

    it("gives up cleanly if the item stops being locatable between the two v2 phases", () => {
        const locate = vi.fn(() => AT as Locator | undefined);
        const { pump, posted } = harness({ locate });
        pump.request(["ICON.bam"], 64);
        locate.mockReturnValue(undefined); // the game was closed while the worker was reading
        pump.handle({ id: 1, kind: "needPages", item: "ICON.bam", pages: ["MOS0012.PVRZ"] });
        expect(posted).toEqual([{ type: "thumbnail", id: "ICON.bam", dataUri: undefined }]);
    });

    describe("scheduling", () => {
        const items = (...names: string[]) => names.map((n) => `${n}.bam`);
        const stampEach = { stamp: vi.fn((id: string) => `s:${id}`) };
        /** The worker answers, and the webview takes it off the channel straight away. */
        const answer = (pump: ThumbnailPump, request: GalleryRequest) => {
            pump.handle({ id: request.id, kind: "thumbnail", item: request.item, dataUri: `d:${request.item}` });
            pump.seen();
        };
        /** The worker answers everything it is given, and the webview confirms none of it. */
        const answerUnseen = (pump: ThumbnailPump, sent: GalleryRequest[]) => {
            // `sent` grows as each answer frees a slot, so answer until the pump has nothing left to send.
            let answered = 0;
            while (answered < sent.length) {
                const request = sent[answered++]!;
                pump.handle({ id: request.id, kind: "thumbnail", item: request.item, dataUri: "d" });
            }
        };
        const twelve = items(..."ABCDEFGHIJKL");

        it("holds a few jobs at the worker and sends the next as each is answered", () => {
            const { pump, sent } = harness(stampEach);
            pump.request(items("A", "B", "C", "D", "E", "F"), 64);
            expect(sent.map((r) => r.item)).toEqual(items("A", "B", "C", "D"));
            answer(pump, sent[0]!);
            expect(sent.map((r) => r.item)).toEqual(items("A", "B", "C", "D", "E"));
        });

        // A fast scroll: the rows passed on the way are asked for first, the rows where it stopped last.
        it("serves the newest request ahead of an older backlog, then draws the backlog too", () => {
            const { pump, sent, posted } = harness(stampEach);
            pump.request(items("A", "B", "C", "D", "E", "F"), 64);
            pump.request(items("Y", "Z"), 64);
            // `sent` grows as each answer frees a slot, so answer until the pump has nothing left to send.
            let answered = 0;
            while (answered < sent.length) answer(pump, sent[answered++]!);
            expect(sent.map((r) => r.item)).toEqual(items("A", "B", "C", "D", "Y", "Z", "E", "F"));
            expect(posted.map((m) => m.type === "thumbnail" && m.id)).toEqual(sent.map((r) => r.item));
        });

        // A two-phase v2 keeps the slot it already holds: its page round trip is not sent to the back.
        it("sends a v2's pages job straight away rather than queueing it", () => {
            const { pump, sent } = harness(stampEach);
            pump.request(items("A", "B", "C", "D", "E"), 64);
            pump.handle({ id: 1, kind: "needPages", item: "A.bam", pages: ["MOS0012.PVRZ"] });
            expect(sent.slice(4).map((r) => [r.kind, r.item])).toEqual([["pages", "A.bam"]]);
        });

        // The channel to the webview is in order: whatever is posted ahead of the tiles where a scroll stopped
        // is drawn first, so answers the webview has not taken yet hold the rest back here.
        it("holds work back while the webview has not taken its answers, and sends one more per confirmation", () => {
            const { pump, sent, posted } = harness(stampEach);
            pump.request(twelve, 64);
            answerUnseen(pump, sent);
            const held = sent.length;
            expect(held).toBeGreaterThan(4); // past the worker's own slots
            expect(held).toBeLessThan(twelve.length);
            expect(posted).toHaveLength(held);
            pump.seen();
            expect(sent).toHaveLength(held + 1);
        });

        it("drops what a reloaded webview never confirmed", () => {
            const { pump, sent } = harness(stampEach);
            pump.request(twelve, 64);
            answerUnseen(pump, sent);
            const held = sent.length;
            pump.webviewReady();
            expect(sent.length).toBeGreaterThan(held);
        });

        // A pump replacing another on a game change hears confirmations for answers it never posted.
        it("does not bank confirmations for answers it never posted", () => {
            const plain = harness(stampEach);
            plain.pump.request(twelve, 64);
            answerUnseen(plain.pump, plain.sent);

            const banked = harness(stampEach);
            for (let i = 0; i < 5; i++) banked.pump.seen();
            banked.pump.request(twelve, 64);
            answerUnseen(banked.pump, banked.sent);
            expect(banked.sent).toHaveLength(plain.sent.length);
        });
    });

    // A pump replaced on a game change starts its ids from 1 again, so the old worker's late reply can carry
    // an id the new pump holds for a different item.
    it("ignores a reply whose id it holds for a different item", () => {
        const { pump, posted, sent } = harness();
        pump.request(["ICON.bam"], 64);
        pump.handle({ id: 1, kind: "thumbnail", item: "OTHER.bam", dataUri: "stale" });
        expect(posted).toEqual([]);
        pump.handle({ id: sent[0]!.id, kind: "thumbnail", item: "ICON.bam", dataUri: "x" });
        expect(posted).toEqual([{ type: "thumbnail", id: "ICON.bam", dataUri: "x" }]);
    });

    it("ignores a reply whose job it no longer has", () => {
        const { pump, posted } = harness();
        pump.handle({ id: 99, kind: "thumbnail", item: "GHOST.bam", dataUri: "x" } satisfies GalleryResponse);
        expect(posted).toEqual([]);
    });
});
