import { expect, test } from "vitest";
import { serializeFrm } from "@bgforge/image";
import { ImageDocumentModel } from "../../src/image-editor/document-model";
import { framePixels } from "../../src/image-editor/webview/messages";
import { makeMiniFrm, asIndexedView } from "./fixtures";

/**
 * Guards the host->webview wire contract for the packed pixel buffer.
 *
 * The transport is NOT JSON: `Webview.postMessage` recreates an `ArrayBuffer` on the far side for
 * any extension targeting VS Code 1.57+ (this one targets ^1.91.0), which is why the pixels cross
 * as one buffer instead of base64. `structuredClone` is the right proxy for that - JSON, the old
 * proxy here, would destroy the very type the contract now depends on.
 */
test("AnimationView survives the real transport so the webview canvas still gets usable pixels", () => {
    const model = ImageDocumentModel.fromBytes(serializeFrm(makeMiniFrm()), "hero.frm");
    const view = asIndexedView(model.toView());

    const wire = structuredClone(view);

    expect(wire.frames.length).toBe(view.frames.length);
    expect(wire.pixels).toBeInstanceOf(ArrayBuffer);
    for (const frame of wire.frames) {
        expect(framePixels(wire.pixels, frame)).toHaveLength(frame.width * frame.height);
    }

    // palette (plain array of plain objects) and meta must survive too.
    expect(wire.palette.length).toBe(256);
    expect(wire.meta.sourceFormat).toBe("frm");
});

/**
 * The invariant `structuredClone` CANNOT catch, and the reason the pixels are one buffer rather than
 * one per frame: a message carrying an array of ArrayBuffers is recreated faithfully by
 * structuredClone but NOT by the real webview transport. Driving 5888 separate buffers through
 * code-server delivered 5888 empty objects and zero bytes, with no error on either side - so the
 * shape is asserted directly rather than through a proxy that is more permissive than production.
 */
test("the view carries exactly one ArrayBuffer, never an array of them", () => {
    const model = ImageDocumentModel.fromBytes(serializeFrm(makeMiniFrm()), "hero.frm");
    const view = model.toView();

    const buffers = Object.values(view).filter((value) => value instanceof ArrayBuffer);
    expect(buffers).toEqual([view.pixels]);
    // No frame may carry bytes of its own: a per-frame buffer is the shape that silently arrives empty.
    for (const frame of view.frames) {
        expect(Object.values(frame).some((value) => value instanceof ArrayBuffer)).toBe(false);
    }
});
