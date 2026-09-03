/**
 * Turning a game resource into an inline picture. Pins the two halves that must agree - which types claim to be
 * drawable, and which ones actually produce an image - because the row reserves its slot off the first and the
 * bytes arrive from the second.
 */
import { describe, expect, it } from "vitest";
import { decodeIndexedPng, serializeBamV1, type IndexedAnimation, type Rgba } from "@bgforge/image";
import { canThumbnail, composeCells, thumbnailDataUri } from "../src/ie-resources/thumbnails";

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

/** A BAM of `count` cycles, cycle i starting on a frame filled with palette index i+1 - so a composed tile's
 *  quadrants can be told apart by the index they carry. */
function multiCycle(edge: number, count: number): Uint8Array {
    const palette: Rgba[] = Array.from({ length: 256 }, () => ({ r: 0, g: 0, b: 0, a: 255 }));
    for (let i = 1; i <= count; i++) palette[i] = { r: i * 50, g: 255 - i * 50, b: i * 20, a: 255 };
    const animation: IndexedAnimation = {
        palette,
        frames: Array.from({ length: count }, (_, i) => ({
            width: edge,
            height: edge,
            pixels: new Uint8Array(edge * edge).fill(i + 1),
            offsetX: 0,
            offsetY: 0,
        })),
        sequences: Array.from({ length: count }, (_, i) => ({ frameRefs: [i], facing: "none" as const })),
        meta: { sourceFormat: "bam", transparentIndex: 0 },
    };
    return serializeBamV1(animation);
}

/** The palette index at one pixel of a decoded indexed PNG. */
function indexAt(dataUri: string, x: number, y: number): number {
    const base64 = dataUri.slice(dataUri.indexOf(",") + 1);
    const png = decodeIndexedPng(Uint8Array.from(Buffer.from(base64, "base64")));
    return png.pixels[y * png.width + x]!;
}

/** A 2x2 BAM of four distinct palette indices, for asserting which sample a downscale keeps. */
function fourColour2x2(): Uint8Array {
    const palette: Rgba[] = Array.from({ length: 256 }, () => ({ r: 0, g: 0, b: 0, a: 255 }));
    for (const i of [1, 2, 3, 4]) palette[i] = { r: i * 40, g: 255 - i * 40, b: i * 10, a: 255 };
    const animation: IndexedAnimation = {
        palette,
        frames: [{ width: 2, height: 2, pixels: Uint8Array.from([1, 2, 3, 4]), offsetX: 0, offsetY: 0 }],
        sequences: [{ frameRefs: [0], facing: "none" }],
        meta: { sourceFormat: "bam", transparentIndex: 0 },
    };
    return serializeBamV1(animation);
}

/** Pad a serialized BAM out to a byte length. The zeros sit past every offset the header declares, so the
 *  file still parses - which is the point: this grows the SOURCE size without changing the picture. */
function padded(bytes: Uint8Array, toBytes: number): Uint8Array {
    const out = new Uint8Array(toBytes);
    out.set(bytes);
    return out;
}

/** The palette index of a 1x1 result - the property a blend cannot preserve, where size alone cannot tell a
 *  nearest-neighbour pick from an average. */
function soleIndexOf(dataUri: string): number {
    const base64 = dataUri.slice(dataUri.indexOf(",") + 1);
    return decodeIndexedPng(Uint8Array.from(Buffer.from(base64, "base64"))).pixels[0]!;
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
        const uri = thumbnailDataUri(bam(32), "BAM", 64);
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
        const uri = thumbnailDataUri(bytes, "bmp", 64);
        expect(uri).toBe(`data:image/bmp;base64,${Buffer.from(bytes).toString("base64")}`);
    });

    // The one place the two halves could drift: a type this refuses must be one `canThumbnail` never claimed,
    // or a row reserves a slot that stays empty forever.
    it("draws nothing for a type it does not claim", () => {
        expect(thumbnailDataUri(bam(32), "ITM", 64)).toBeUndefined();
        expect(canThumbnail("ITM")).toBe(false);
    });

    /**
     * A mod archive is exactly where a malformed icon turns up, and the field beside it is still perfectly
     * editable - so a bad decode is a missing picture, never a thrown error that would take the row with it.
     */
    it("returns nothing rather than throwing on bytes that are not a BAM", () => {
        expect(thumbnailDataUri(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]), "BAM", 64)).toBeUndefined();
    });

    // The source cap is about what crosses the message boundary base64-encoded; a real icon is tens of KB.
    it("declines a source larger than the cap", () => {
        expect(thumbnailDataUri(new Uint8Array(9 * 1024 * 1024), "BMP", 64)).toBeUndefined();
    });

    /**
     * The gallery reads whole game archives, where a mod's full-screen art is ordinary. 3 MB sat above the old
     * 2 MiB bound and below the 8 MiB one, so this is the case that moved when the cap was raised.
     */
    it("accepts a source between the old cap and the new one", () => {
        expect(thumbnailDataUri(padded(bam(64), 3 * 1024 * 1024), "BAM", 64)).toBeDefined();
    });
});

/**
 * A frame is re-encoded at the size it will be DRAWN at, not its native size. This replaces the old
 * `MAX_FRAME_EDGE` guard, which refused an oversized frame outright: the encode is now bounded by the
 * requested tile whatever the source dimensions, so a large frame draws instead of vanishing.
 *
 * Note the aggregate bound added to `parseBamV1` does NOT stand in for that guard - it is 67.1M pixels and one
 * 1400x1400 frame is 1.96M, so it never fires here. The downscale is what makes the encode cheap.
 */
describe("downscaling", () => {
    it("emits at the requested size when the source is larger", () => {
        expect(pngSize(thumbnailDataUri(bam(256), "BAM", 64)!)).toEqual({ width: 64, height: 64 });
    });

    it("draws a frame that the old edge guard refused outright", () => {
        expect(pngSize(thumbnailDataUri(bam(1400), "BAM", 64)!)).toEqual({ width: 64, height: 64 });
    });

    it("never upscales a small source", () => {
        expect(pngSize(thumbnailDataUri(bam(16), "BAM", 128)!)).toEqual({ width: 16, height: 16 });
    });

    it("picks nearest-neighbour samples, not averages", () => {
        // Size alone does not discriminate - an averaging filter emits 1x1 too. The emitted palette INDEX is
        // what a blend cannot preserve, because averaging leaves the palette entirely.
        const uri = thumbnailDataUri(fourColour2x2(), "BAM", 1)!;
        expect(pngSize(uri)).toEqual({ width: 1, height: 1 });
        expect([1, 2, 3, 4]).toContain(soleIndexOf(uri));
    });
});

describe("composeCells", () => {
    it("collapses identical cycle art to a single picture", () => {
        expect(composeCells([7, 7, 7, 7])).toEqual([{ index: 7, cell: 0 }]);
    });

    it("places two distinct frames on the TL/BR diagonal", () => {
        expect(composeCells([1, 2])).toEqual([
            { index: 1, cell: 0 },
            { index: 2, cell: 3 },
        ]);
    });

    it("places three in reading order, leaving BR empty", () => {
        expect(composeCells([1, 2, 3])).toEqual([
            { index: 1, cell: 0 },
            { index: 2, cell: 1 },
            { index: 3, cell: 2 },
        ]);
    });

    it("fills the quadrants from the first four cycles", () => {
        expect(composeCells([1, 2, 3, 4, 5])).toHaveLength(4);
    });

    it("treats a repeat among four as fewer cells", () => {
        expect(composeCells([1, 1, 2, 2])).toEqual([
            { index: 1, cell: 0 },
            { index: 2, cell: 3 },
        ]);
    });
});

/**
 * The composition the cell chooser feeds, asserted on the emitted picture rather than the chooser's return -
 * a correct layout that never reaches the encoder is the failure this catches.
 */
describe("composed tiles", () => {
    it("puts each of four cycles in its own quadrant", () => {
        const uri = thumbnailDataUri(multiCycle(32, 4), "BAM", 64)!;
        expect(pngSize(uri)).toEqual({ width: 64, height: 64 });
        expect(indexAt(uri, 16, 16)).toBe(1); // TL - cycle 0's first frame
        expect(indexAt(uri, 48, 16)).toBe(2); // TR
        expect(indexAt(uri, 16, 48)).toBe(3); // BL
        expect(indexAt(uri, 48, 48)).toBe(4); // BR
    });

    it("leaves the other diagonal transparent when there are two cycles", () => {
        const uri = thumbnailDataUri(multiCycle(32, 2), "BAM", 64)!;
        expect(indexAt(uri, 16, 16)).toBe(1); // TL
        expect(indexAt(uri, 48, 48)).toBe(2); // BR
        expect(indexAt(uri, 48, 16)).toBe(0); // TR - transparent index
        expect(indexAt(uri, 16, 48)).toBe(0); // BL
    });

    it("draws a single-cycle BAM whole, not shrunk into one quadrant", () => {
        const uri = thumbnailDataUri(multiCycle(32, 1), "BAM", 64)!;
        expect(pngSize(uri)).toEqual({ width: 32, height: 32 });
    });

    // Cells come from the cycle table, but a BAM with no usable cycles still has frames to show - drawing
    // nothing there would be a blank tile for a picture that exists.
    it("falls back to frame 0 when the cycle table is empty", () => {
        const animation: IndexedAnimation = {
            palette: Array.from({ length: 256 }, () => ({ r: 0, g: 0, b: 0, a: 255 })),
            frames: [{ width: 8, height: 8, pixels: new Uint8Array(64).fill(1), offsetX: 0, offsetY: 0 }],
            sequences: [],
            meta: { sourceFormat: "bam", transparentIndex: 0 },
        };
        const uri = thumbnailDataUri(serializeBamV1(animation), "BAM", 64)!;
        expect(pngSize(uri)).toEqual({ width: 8, height: 8 });
        expect(indexAt(uri, 4, 4)).toBe(1);
    });
});
