import { expect, test } from "vitest";
import { decodeFramePixels, encodeFramePixels } from "../../src/image-editor/webview/messages";

test("decodeFramePixels(encodeFramePixels(bytes)) round-trips for a range of byte patterns", () => {
    const cases = [
        Uint8Array.from([]),
        Uint8Array.from([0]),
        Uint8Array.from([255]),
        Uint8Array.from([0, 255, 128, 1, 254]),
        Uint8Array.from(Array.from({ length: 300 }, (_, i) => i % 256)),
    ];
    for (const bytes of cases) {
        expect(decodeFramePixels(encodeFramePixels(bytes))).toEqual(bytes);
    }
});
