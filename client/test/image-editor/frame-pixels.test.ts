import { expect, test } from "vitest";
import { framePixels, packFramePixels } from "../../src/image-editor/webview/messages";

/**
 * Frames cross to the webview as ONE ArrayBuffer plus a span per frame, not as N base64 strings.
 * Base64 cost 4/3 the size plus a per-frame encode and decode; the packed form is what VS Code
 * recreates natively on the far side (see the one-buffer invariant in view-wire-roundtrip).
 */
test("packFramePixels lays every frame into one buffer that framePixels reads back unchanged", () => {
    const sources = [
        { width: 2, height: 1, offsetX: 0, offsetY: 0, pixels: Uint8Array.from([0, 255]) },
        { width: 1, height: 1, offsetX: -3, offsetY: 7, pixels: Uint8Array.from([128]) },
        { width: 3, height: 1, offsetX: 0, offsetY: 0, pixels: Uint8Array.from([1, 2, 254]) },
    ];

    const packed = packFramePixels(sources);

    for (const [i, source] of sources.entries()) {
        const frame = packed.frames[i];
        if (!frame) throw new Error(`frame ${i} missing from the packed view`);
        expect(framePixels(packed.pixels, frame)).toEqual(source.pixels);
        expect(frame.width).toBe(source.width);
        expect(frame.offsetX).toBe(source.offsetX);
    }
});

test("packFramePixels allocates exactly the pixel bytes, with no per-frame buffers", () => {
    // The resource bound this whole change exists for: one allocation the size of the payload,
    // never a copy per frame (MAPICONS.BAM has 5888 of them).
    const sources = [
        { width: 2, height: 1, offsetX: 0, offsetY: 0, pixels: Uint8Array.from([0, 255]) },
        { width: 1, height: 1, offsetX: 0, offsetY: 0, pixels: Uint8Array.from([9]) },
    ];

    const packed = packFramePixels(sources);

    expect(packed.pixels.byteLength).toBe(3);
    // One field, not two co-varying optionals: a frame cannot carry an offset without a length.
    expect(packed.frames.map((f) => f.span)).toEqual([
        { start: 0, length: 2 },
        { start: 2, length: 1 },
    ]);
});

test("framePixels returns a view into the shared buffer rather than a copy", () => {
    // A copy per frame would double peak memory on exactly the files this change is for.
    const packed = packFramePixels([{ width: 2, height: 1, offsetX: 0, offsetY: 0, pixels: Uint8Array.from([4, 5]) }]);
    const frame = packed.frames[0];
    if (!frame) throw new Error("packed view has no frames");

    const view = framePixels(packed.pixels, frame);
    if (!view) throw new Error("packed frame has no pixels");

    expect(view.buffer).toBe(packed.pixels);
});

test("an empty frame list packs to an empty buffer", () => {
    const packed = packFramePixels([]);

    expect(packed.frames).toEqual([]);
    expect(packed.pixels.byteLength).toBe(0);
});
