/**
 * The webview's side of lazy frame delivery: which frames it already holds after an init, and which
 * it must ask for at a given playback position.
 */
import { describe, expect, it } from "vitest";
import {
    createFrameFallback,
    framesNeededFor,
    seedLoadedPixels,
} from "../../src/image-editor/webview/render/frame-loading";
import { packFramePixels } from "../../src/image-editor/webview/messages";

function view(include?: ReadonlySet<number>) {
    const sources = Array.from({ length: 4 }, (_, i) => ({
        width: 2,
        height: 1,
        offsetX: 0,
        offsetY: 0,
        pixels: Uint8Array.from([i, i + 10]),
    }));
    return packFramePixels(sources, include);
}

describe("seedLoadedPixels", () => {
    it("takes the frames the init actually carried, and only those", () => {
        const packed = view(new Set([1, 3]));

        const loaded = seedLoadedPixels(packed);

        expect([...loaded.keys()].sort((a, b) => a - b)).toEqual([1, 3]);
        expect(loaded.get(1)).toEqual(Uint8Array.from([1, 11]));
        expect(loaded.get(3)).toEqual(Uint8Array.from([3, 13]));
    });

    it("is empty when the init carried no pixels at all", () => {
        expect(seedLoadedPixels(view(new Set())).size).toBe(0);
    });
});

describe("createFrameFallback", () => {
    const bytesA = Uint8Array.from([1]);
    const bytesB = Uint8Array.from([2]);
    const frameA = { width: 1, height: 1, offsetX: 0, offsetY: 0 };
    const frameB = { width: 2, height: 2, offsetX: 0, offsetY: 0 };
    const doc = {};
    const otherDoc = {};

    it("holds the last drawn frame so a tile never blanks mid-playback", () => {
        const fallback = createFrameFallback();

        fallback(doc, frameA, bytesA);

        // The next frame's pixels have not arrived: keep drawing what is already on screen.
        expect(fallback(doc, frameB, undefined)).toEqual({ frame: frameA, bytes: bytesA });
    });

    it("drops the held frame when the document changes, rather than showing the old one's pixels", () => {
        // A refresh (edit, revert, replace-import) rebuilds the view while the keyed tile component
        // survives; carrying the previous document's pixels across would render stale content as
        // current.
        const fallback = createFrameFallback();
        fallback(doc, frameA, bytesA);

        expect(fallback(otherDoc, frameB, undefined)).toBeUndefined();
    });

    it("takes the fresh frame whenever its pixels are present", () => {
        const fallback = createFrameFallback();
        fallback(doc, frameA, bytesA);

        expect(fallback(doc, frameB, bytesB)).toEqual({ frame: frameB, bytes: bytesB });
    });
});

describe("framesNeededFor", () => {
    it("asks for the frame being shown and the one after it, so playback does not stutter", () => {
        expect(framesNeededFor([10, 11, 12, 13], 1)).toEqual([11, 12]);
    });

    it("clamps to the sequence's own last frame, which a shorter cycle sits on", () => {
        // Playback holds ONE shared index across cycles of differing length; a short cycle repeats
        // its last frame rather than running off the end.
        expect(framesNeededFor([10, 11], 5)).toEqual([11]);
    });

    it("returns nothing for an empty sequence", () => {
        expect(framesNeededFor([], 0)).toEqual([]);
    });

    it("does not repeat a frame the sequence shows twice in a row", () => {
        expect(framesNeededFor([10, 10, 10], 0)).toEqual([10]);
    });
});
