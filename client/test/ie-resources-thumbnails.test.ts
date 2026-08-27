/**
 * Turning a game resource into an inline picture. Pins the two halves that must agree - which types claim to be
 * drawable, and which ones actually produce an image - because the row reserves its slot off the first and the
 * bytes arrive from the second.
 */
import { describe, expect, it } from "vitest";
import { serializeBamV1, type IndexedAnimation, type Rgba } from "@bgforge/image";
import { canThumbnail, thumbnailDataUri } from "../src/ie-resources/thumbnails";

/** A real BAM, built through the library's own serializer rather than typed by hand - the decode under test is
 *  the one that reads what a game ships, so its input has to be a genuine BAM and not a fixture of assumptions. */
function bam(edge: number, frames = 1): Uint8Array {
    const palette: Rgba[] = Array.from({ length: 256 }, () => ({ r: 0, g: 0, b: 0, a: 255 }));
    palette[1] = { r: 255, g: 0, b: 255, a: 255 };
    const animation: IndexedAnimation = {
        palette,
        frames: Array.from({ length: frames }, () => ({
            width: edge,
            height: edge,
            pixels: new Uint8Array(edge * edge).fill(1),
            offsetX: 0,
            offsetY: 0,
        })),
        sequences: [{ frameRefs: [0], facing: "none" }],
        meta: { sourceFormat: "bam", transparentIndex: 0 },
    };
    return serializeBamV1(animation);
}

/** The decoded PNG's declared dimensions, read out of IHDR - the only part of a data URI that proves an image
 *  was actually produced rather than a plausible-looking string. */
function pngSize(dataUri: string): { width: number; height: number } {
    const base64 = dataUri.slice(dataUri.indexOf(",") + 1);
    const bytes = Uint8Array.from(Buffer.from(base64, "base64"));
    expect(bytes.slice(0, 8)).toEqual(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    const view = new DataView(bytes.buffer, bytes.byteOffset);
    // IHDR is always the first chunk: 8-byte signature, 4-byte length, 4-byte type, then width and height.
    return { width: view.getUint32(16, false), height: view.getUint32(20, false) };
}

describe("canThumbnail", () => {
    /**
     * The set is these two because these are what a resref field actually points at: every icon field on an ITM
     * or SPL declares BAM, and a CRE's portraits declare BMP.
     */
    it("claims the icon and portrait formats, case-insensitively", () => {
        for (const ext of ["bam", "BAM", "bmp", "BMP"]) expect(canThumbnail(ext)).toBe(true);
    });

    // Everything else a record points at is data, not a picture - and a false claim here is worse than a missing
    // feature: the row would reserve a box that no decode ever fills.
    it("claims nothing else a record can reference", () => {
        for (const ext of ["ITM", "SPL", "CRE", "BCS", "DLG", "WAV", "PRO", "2DA", "MOS"]) {
            expect(canThumbnail(ext)).toBe(false);
        }
    });
});

describe("thumbnailDataUri", () => {
    it("re-encodes a BAM's first frame as a PNG of that frame's size", () => {
        const uri = thumbnailDataUri(bam(32), "BAM", "ISW1H01");
        expect(uri?.startsWith("data:image/png;base64,")).toBe(true);
        expect(pngSize(uri!)).toEqual({ width: 32, height: 32 });
    });

    /**
     * A BMP crosses unchanged: browsers decode BMP, so re-encoding it would be work to arrive back where we
     * started. Asserted on the payload, not just the media type - a passthrough that quietly re-encoded would
     * still announce itself as a BMP.
     */
    it("hands a BMP through as its own bytes", () => {
        const bytes = new Uint8Array([0x42, 0x4d, 1, 2, 3, 4]);
        const uri = thumbnailDataUri(bytes, "bmp", "IMOENM");
        expect(uri).toBe(`data:image/bmp;base64,${Buffer.from(bytes).toString("base64")}`);
    });

    // The one place the two halves could drift: a type this refuses must be one `canThumbnail` never claimed,
    // or a row reserves a slot that stays empty forever.
    it("draws nothing for a type it does not claim", () => {
        expect(thumbnailDataUri(bam(32), "ITM", "SW1H01")).toBeUndefined();
        expect(canThumbnail("ITM")).toBe(false);
    });

    /**
     * A mod archive is exactly where a malformed icon turns up, and the field beside it is still perfectly
     * editable - so a bad decode is a missing picture, never a thrown error that would take the row with it.
     */
    it("returns nothing rather than throwing on bytes that are not a BAM", () => {
        expect(thumbnailDataUri(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]), "BAM", "JUNK")).toBeUndefined();
    });

    // The source cap is about what crosses the message boundary base64-encoded; a real icon is tens of KB.
    it("declines a source larger than the cap", () => {
        expect(thumbnailDataUri(new Uint8Array(3 * 1024 * 1024), "BMP", "HUGE")).toBeUndefined();
    });

    /**
     * The cap the source-size one cannot enforce: a real BAM stores its frames RLE-compressed, so a small file
     * can decode to a huge picture, and a resref field is free text - an icon field really can be pointed at a
     * creature animation.
     *
     * The 1400px edge is chosen to sit BETWEEN the two caps (its ~1.96 MB of pixels clears the 2 MiB source
     * bound while its edge exceeds 1024), so this fails if the frame cap goes and cannot pass on the source
     * cap's behalf - which is exactly what an earlier 2048px fixture did, silently.
     */
    it("declines a BAM whose frame is far larger than any icon, on the frame and not the file", () => {
        expect(bam(1400).length).toBeLessThan(2 * 1024 * 1024);
        expect(thumbnailDataUri(bam(1400), "BAM", "MBEHOLD")).toBeUndefined();
        // ...and the bound really is at the edge length: the same BAM at the limit still draws.
        expect(thumbnailDataUri(bam(1024), "BAM", "MBEHOLD")).toBeDefined();
    });
});
