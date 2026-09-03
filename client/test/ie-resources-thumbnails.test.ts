/**
 * Turning a game resource into an inline picture. Pins the two halves that must agree - which types claim to be
 * drawable, and which ones actually produce an image - because the row reserves its slot off the first and the
 * bytes arrive from the second.
 */
import { describe, expect, it } from "vitest";
import { type IndexedAnimation, serializeBamV1 } from "@bgforge/image";
import { canThumbnail, composeCells, requiredPvrzPages, thumbnailDataUri } from "../src/ie-resources/thumbnails";
import {
    bam,
    bamV2WithPages,
    bmpBytes,
    distinctColoursOf,
    fourColour2x2,
    frmBytes,
    indexAt,
    multiCycle,
    padded,
    pngSize,
    soleIndexOf,
} from "./image-fixtures";

describe("canThumbnail", () => {
    /**
     * BAM and BMP are what a resref field points at - every icon field on an ITM or SPL declares BAM, and a
     * CRE's portraits declare BMP. FRM joins them for the gallery, which browses Fallout art the binary
     * editor's resref fields never name.
     */
    it("claims the icon and portrait formats, case-insensitively", () => {
        for (const ext of ["bam", "BAM", "bmp", "BMP", "frm", "FRM"]) expect(canThumbnail(ext)).toBe(true);
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
     * A BMP is decoded and re-encoded at the requested size, not passed through.
     *
     * The passthrough this replaces cost the gallery its extension host: a game's screenshots are 640x480
     * BMPs, so every tile put ~900 KB on the wire and the webview held it, against ~2 KB for a real
     * thumbnail. Both halves are asserted, because a downscale that returned the source bytes under a PNG
     * media type would still be the old behaviour.
     */
    it("decodes and downscales a BMP rather than passing it through", () => {
        const bytes = bmpBytes(640, 480);
        const uri = thumbnailDataUri(bytes, "bmp", 64);
        expect(uri?.startsWith("data:image/png;base64,")).toBe(true);
        expect(pngSize(uri!)).toEqual({ width: 64, height: 48 });
        expect(uri!.length).toBeLessThan(bytes.length / 10);
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

describe("BAM v2", () => {
    it("names the pages it needs without decoding", () => {
        // pvrzResourceName(12) is "MOS0012.PVRZ" - the suffix is part of the name it returns, so a caller
        // resolving these must key on that whole string rather than rebuilding the name itself.
        expect(requiredPvrzPages(bamV2WithPages(12).bam)).toEqual(["MOS0012.PVRZ"]);
    });

    it("returns no pages for anything that is not a v2, so a caller need not sniff first", () => {
        expect(requiredPvrzPages(bam(32))).toEqual([]);
        expect(requiredPvrzPages(new Uint8Array([1, 2, 3, 4]))).toEqual([]);
    });

    it("draws a v2 BAM when the resolver supplies its pages", () => {
        const { bam: v2, pages } = bamV2WithPages(12);
        const uri = thumbnailDataUri(v2, "BAM", 64, (page) => pages.get(page));
        expect(uri?.startsWith("data:image/png;base64,")).toBe(true);
        expect(pngSize(uri!)).toEqual({ width: 8, height: 8 });
        // A v2 frame is real colour; a tile that came out flat means the pages never reached the compose.
        expect(distinctColoursOf(uri!).size).toBeGreaterThan(1);
    });

    it("returns undefined - not a throw - when a page is missing", () => {
        expect(thumbnailDataUri(bamV2WithPages(12).bam, "BAM", 64, () => undefined)).toBeUndefined();
    });

    it("returns undefined when no resolver is supplied at all", () => {
        expect(thumbnailDataUri(bamV2WithPages(12).bam, "BAM", 64)).toBeUndefined();
    });
});

describe("FRM", () => {
    it("draws an FRM by its real extension", () => {
        expect(thumbnailDataUri(frmBytes(), "FRM", 64)?.startsWith("data:image/png;base64,")).toBe(true);
    });

    /**
     * `parseFrm` returns `emptyPalette()` - 256 entries of opaque black - because an FRM carries no palette of
     * its own. Handing that to the encoder renders every FRM tile solid black, and an assertion that merely
     * checks a PNG came out cannot see it.
     */
    it("gives an FRM a real palette, not the parser's black placeholder", () => {
        expect(distinctColoursOf(thumbnailDataUri(frmBytes(), "FRM", 64)!).size).toBeGreaterThan(1);
    });
});
