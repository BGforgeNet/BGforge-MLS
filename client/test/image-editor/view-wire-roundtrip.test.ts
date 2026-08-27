import { expect, test } from "vitest";
import { serializeFrm } from "@bgforge/image";
import { ImageDocumentModel } from "../../src/image-editor/document-model";
import { decodeFramePixels } from "../../src/image-editor/webview/messages";
import { makeMiniFrm, asIndexedView } from "./fixtures";

// Guards the whole host->webview wire contract against the silent-drop class: a non-JSON-safe
// payload type (a raw Uint8Array, Map, Date, class instance) can survive in memory and on desktop
// (structured clone) yet arrive mangled over the web webview postMessage, blanking the render with
// no error. JSON is the lossiest realistic transport - if a field survives JSON.stringify it survives
// any real transport - so round-trip toView() through JSON and confirm the CONSUMER (the pixel bytes
// the canvas decodes) still gets what it needs. A raw-Uint8Array regression makes `pixels` a non-string
// object here, so `typeof === "string"` + a correct decode length catch it deterministically.
test("AnimationView survives a JSON round-trip so the webview canvas still gets usable pixels", () => {
    const model = ImageDocumentModel.fromBytes(serializeFrm(makeMiniFrm()), "hero.frm");
    const view = asIndexedView(model.toView());
    // JSON is the DELIBERATE lossy-transport proxy here: structuredClone would preserve the very
    // types (Uint8Array etc.) the web webview drops, defeating this guard. The annotation (not a
    // cast) types JSON.parse's `any`.
    // oxlint-disable-next-line unicorn/prefer-structured-clone -- JSON is the intended lossy proxy
    const wire: typeof view = JSON.parse(JSON.stringify(view));

    expect(wire.frames.length).toBe(view.frames.length);
    for (const frame of wire.frames) {
        // base64 crosses JSON as a string; a raw Uint8Array would become an object and fail this.
        expect(typeof frame.pixels).toBe("string");
        const bytes = decodeFramePixels(frame.pixels);
        expect(bytes.length).toBe(frame.width * frame.height);
    }

    // palette (plain array of plain objects) and meta must survive too.
    expect(wire.palette.length).toBe(256);
    expect(wire.meta.sourceFormat).toBe("frm");
});
