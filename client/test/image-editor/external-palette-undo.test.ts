import { expect, test } from "vitest";
import { serializeFrm, serializePal, type Rgba } from "@bgforge/image";
import { ImageDocumentModel } from "../../src/image-editor/document-model";
import { makeMiniFrm, asIndexedView } from "./fixtures";

// A sidecar .pal makes externalEnabled auto-on, so a toggle is observable via externalPaletteActive.
function sidecarBytes(): Uint8Array {
    const pal: Rgba[] = Array.from({ length: 256 }, () => ({ r: 10, g: 20, b: 30, a: 255 }));
    return serializePal(pal);
}

// externalEnabled lives outside the Animation IR; if undo snapshots only the animation, a palette
// toggle silently does not revert (and burns a no-op undo step). This guards that regression.
test("undo/redo revert the external-palette toggle, not just the animation", () => {
    const model = ImageDocumentModel.fromBytes(serializeFrm(makeMiniFrm()), "hero.frm", sidecarBytes());
    expect(asIndexedView(model.toView()).externalPaletteActive).toBe(true); // auto-on when a sidecar is present

    model.setExternalPalette(false);
    expect(asIndexedView(model.toView()).externalPaletteActive).toBe(false);

    model.undo();
    expect(asIndexedView(model.toView()).externalPaletteActive).toBe(true); // reverted (pre-fix: stayed false)

    model.redo();
    expect(asIndexedView(model.toView()).externalPaletteActive).toBe(false);
});
