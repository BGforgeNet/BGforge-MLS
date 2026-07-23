import { describe, expect, it } from "vitest";
import fs from "fs";
import { type Animation, emptyPalette, parseBamV1, serializeBamV1 } from "@bgforge/image";
import { corpusFiles, IE_CORPUS } from "./fixtures.ts";

// Uncompressed 'BAM ' files only here; BAMC is Task 8.
const bams = corpusFiles(IE_CORPUS, ".bam").filter((f) => {
    const sig = fs.readFileSync(f).subarray(0, 4).toString("latin1");
    return sig === "BAM ";
});

// A minimal valid BAM V1 built by the real serializer, then corrupted per test. The last pixel is
// the transparent index so the RLE-truncation case ends mid-run at end-of-file.
function synthBamBytes(): Uint8Array {
    const anim: Animation = {
        palette: emptyPalette(),
        frames: [{ width: 2, height: 2, pixels: Uint8Array.from([1, 2, 3, 0]), offsetX: 0, offsetY: 0 }],
        sequences: [{ frameRefs: [0], facing: "none" }],
        meta: { sourceFormat: "bam", transparentIndex: 0 },
    };
    return serializeBamV1(anim);
}

describe("parseBamV1 direction-layout resolution", () => {
    it("stamps ie8 when the cycle structure carries the IE base-file fingerprint", () => {
        // One stride-8 block: 5 varied west cycles over frames 1-5, 3 east slots on the frame-0 filler.
        const frames = Array.from({ length: 6 }, (_, i) => ({
            width: 1,
            height: 1,
            pixels: Uint8Array.from([i === 0 ? 0 : 1]),
            offsetX: 0,
            offsetY: 0,
        }));
        const anim: Animation = {
            palette: emptyPalette(),
            frames,
            sequences: [
                ...Array.from({ length: 5 }, (_, i) => ({ frameRefs: [i + 1], facing: "none" as const })),
                ...Array.from({ length: 3 }, () => ({ frameRefs: [0, 0], facing: "none" as const })),
            ],
            meta: { sourceFormat: "bam", transparentIndex: 0 },
        };
        expect(parseBamV1(serializeBamV1(anim)).meta.directionLayout).toBe("ie8");
    });

    it("stamps non-directional when no fingerprint matches", () => {
        expect(parseBamV1(synthBamBytes()).meta.directionLayout).toBe("non-directional");
    });
});

describe("parseBamV1 hostile input", () => {
    it("rejects a truncated header", () => {
        expect(() => parseBamV1(new Uint8Array(16))).toThrow(/header truncated/);
    });

    it("rejects a non-BAM signature", () => {
        const bytes = synthBamBytes();
        bytes.set(new TextEncoder().encode("XXXX"), 0x00);
        expect(() => parseBamV1(bytes)).toThrow(/not a BAM file \(signature "XXXX"\)/);
    });

    it("rejects a BAM V2 file with a clear unsupported-version error instead of misparsing", () => {
        const bytes = synthBamBytes();
        bytes.set(new TextEncoder().encode("V2  "), 0x04);
        expect(() => parseBamV1(bytes)).toThrow(/unsupported BAM version "V2"/);
    });

    it("rejects a frame entry claiming implausibly large dimensions before allocating", () => {
        const bytes = synthBamBytes();
        const view = new DataView(bytes.buffer);
        const entry = view.getUint32(0x0c, true);
        view.setUint16(entry + 0x00, 0xffff, true);
        view.setUint16(entry + 0x02, 0xffff, true);
        expect(() => parseBamV1(bytes)).toThrow(/implausibly large/);
    });

    it("rejects a frame entry table pointing past end-of-file", () => {
        const bytes = synthBamBytes();
        new DataView(bytes.buffer).setUint32(0x0c, bytes.length, true);
        expect(() => parseBamV1(bytes)).toThrow(/frame entry table out of range/);
    });

    it("rejects a palette region running past end-of-file", () => {
        const bytes = synthBamBytes().slice(0, 60); // cuts into the 1024-byte palette region
        expect(() => parseBamV1(bytes)).toThrow(/palette out of range/);
    });

    it("rejects a cycle entry table running past end-of-file", () => {
        const bytes = synthBamBytes().slice(0, 40);
        const view = new DataView(bytes.buffer);
        view.setUint16(0x08, 0, true); // no frames, so the cycle guard is the first to see the truncation
        bytes[0x0a] = 255;
        // Empty the palette region (paletteOffset == frameLutOffset) so its own guard stays quiet.
        view.setUint32(0x10, view.getUint32(0x14, true), true);
        expect(() => parseBamV1(bytes)).toThrow(/cycle entry table out of range/);
    });

    it("rejects a cycle whose frame lookup entries sit past end-of-file", () => {
        const bytes = synthBamBytes();
        const view = new DataView(bytes.buffer);
        const cycleEntry = view.getUint32(0x0c, true) + 1 * 12; // the cycle table follows the one frame entry
        view.setUint16(cycleEntry + 0x02, 0xffff, true);
        expect(() => parseBamV1(bytes)).toThrow(/frame lookup table out of range/);
    });

    it("rejects uncompressed pixel data running past the end of the file", () => {
        const full = synthBamBytes();
        expect(() => parseBamV1(full.subarray(0, -2))).toThrow(/pixel data out of range/);
    });

    it("reports RLE frame data that ends mid-run as truncated", () => {
        const bytes = synthBamBytes();
        const view = new DataView(bytes.buffer);
        const entry = view.getUint32(0x0c, true);
        // Clear the uncompressed bit so the raw payload is read as RLE; its trailing transparent
        // byte then demands a run count that sits past end-of-file.
        const packed = view.getUint32(entry + 0x08, true);
        view.setUint32(entry + 0x08, packed & 0x7fffffff, true);
        expect(() => parseBamV1(bytes)).toThrow(/RLE frame data truncated/);
    });
});

describe.skipIf(bams.length === 0)("parseBamV1", () => {
    it("parses frames, palette, and cycles of a real BAM", () => {
        const first = bams[0];
        if (!first) throw new Error("expected at least one corpus fixture");
        const anim = parseBamV1(new Uint8Array(fs.readFileSync(first)));
        expect(anim.meta.sourceFormat).toBe("bam");
        expect(anim.palette).toHaveLength(256);
        expect(anim.sequences.length).toBeGreaterThan(0);
        for (const f of anim.frames) expect(f.pixels).toHaveLength(f.width * f.height);
        for (const seq of anim.sequences) {
            for (const ref of seq.frameRefs) expect(anim.frames[ref]).toBeDefined();
        }
    });
});
