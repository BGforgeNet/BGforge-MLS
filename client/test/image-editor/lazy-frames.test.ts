/**
 * Lazy frame delivery: the open sends every frame's GEOMETRY (which the layout needs to size tiles)
 * but only the PIXELS the first paint actually shows. MAPICONS.BAM decodes to 5888 frames / 107 MB
 * of RGBA, of which the rose displays one per cycle - so shipping all of it on open spends the whole
 * budget on frames nobody is looking at.
 */
import { describe, expect, it } from "vitest";
import { serializeFrm } from "@bgforge/image";
import { ImageDocumentModel } from "../../src/image-editor/document-model";
import { framePixels } from "../../src/image-editor/webview/messages";
import { makeMiniFrm } from "./fixtures";

function model(): ImageDocumentModel {
    return ImageDocumentModel.fromBytes(serializeFrm(makeMiniFrm()), "hero.frm");
}

describe("a view built for a subset of frames", () => {
    it("carries geometry for every frame, so the layout can size tiles it has no pixels for", () => {
        const full = model().toView();

        const partial = model().toView({ include: new Set([0]) });

        expect(partial.frames.length).toBe(full.frames.length);
        expect(partial.frames.map((f) => [f.width, f.height])).toEqual(full.frames.map((f) => [f.width, f.height]));
    });

    it("packs pixels for the included frames and leaves the rest marked absent", () => {
        const view = model().toView({ include: new Set([1]) });

        const included = view.frames[1];
        const excluded = view.frames[0];
        if (!included || !excluded) throw new Error("fixture needs at least two frames");
        expect(framePixels(view.pixels, included)).toHaveLength(included.width * included.height);
        // Absent, not empty: a zero-length frame is a legal frame, so the distinction has to be explicit.
        expect(framePixels(view.pixels, excluded)).toBeUndefined();
    });

    it("allocates only the included frames' bytes", () => {
        const one = model().toView({ include: new Set([0]) });
        const first = one.frames[0];
        if (!first) throw new Error("fixture has no frames");

        expect(one.pixels.byteLength).toBe(first.width * first.height);
    });

    it("includes every frame when no subset is named, so existing callers are unchanged", () => {
        const view = model().toView();

        for (const frame of view.frames) {
            expect(framePixels(view.pixels, frame)).toHaveLength(frame.width * frame.height);
        }
    });
});
