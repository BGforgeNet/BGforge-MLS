import { describe, expect, it } from "vitest";
import {
    type IndexedAnimation,
    type Frame,
    type RgbaAnimation,
    emptyPalette,
    exportPngDirectory,
    importPngDirectory,
} from "@bgforge/image";
import { encodeIndexedPng } from "../src/png/encode.ts";
import { decodeTruecolourPng } from "../src/png/decode.ts";

// Six sequences (one per FRM facing), with distinct frame counts, pixel content,
// and offsets, so the round-trip test can distinguish a mixed-up ordering from a
// correct one. transparentIndex is left undefined on purpose to exercise the
// `anim.meta.transparentIndex ?? 0` fallback in exportPngDirectory. Every palette
// entry stays opaque (a: 255) per the IR convention - transparency is carried only
// via the (implicit, here index 0) transparentIndex, never via palette alpha.
function makeAnimation(): IndexedAnimation {
    const palette = emptyPalette();
    palette[0] = { r: 0, g: 0, b: 0, a: 255 };
    palette[5] = { r: 10, g: 20, b: 30, a: 255 };
    palette[10] = { r: 40, g: 50, b: 60, a: 255 };
    palette[20] = { r: 70, g: 80, b: 90, a: 255 };

    const frames: Frame[] = [];
    function pushFrame(pixelValue: number, offsetX: number, offsetY: number): number {
        frames.push({ width: 2, height: 2, pixels: new Uint8Array([pixelValue, 0, 0, pixelValue]), offsetX, offsetY });
        return frames.length - 1;
    }

    const facings = ["NE", "E", "SE", "SW", "W", "NW"] as const;
    const framesPerSequence = [1, 2, 3, 1, 2, 3];
    const sequences = facings.map((facing, s) => {
        const count = framesPerSequence[s] ?? 1;
        const frameRefs: number[] = [];
        for (let f = 0; f < count; f++) {
            const pixelValue = [5, 10, 20][(s + f) % 3] ?? 5;
            frameRefs.push(pushFrame(pixelValue, s + 1, -(f + 1)));
        }
        return { frameRefs, facing };
    });

    return {
        palette,
        frames,
        sequences,
        meta: { sourceFormat: "frm", fps: 12, actionFrame: 1, directionLayout: "frm6", frmVersion: 4 },
    };
}

function frameAt(anim: IndexedAnimation, seqIndex: number, frameIndex: number): Frame {
    const seq = anim.sequences[seqIndex];
    if (!seq) throw new Error(`test setup: missing sequence ${seqIndex}`);
    const ref = seq.frameRefs[frameIndex];
    if (ref === undefined) throw new Error(`test setup: missing frameRef ${frameIndex} in sequence ${seqIndex}`);
    const frame = anim.frames[ref];
    if (!frame) throw new Error(`test setup: missing frame ${ref} referenced by sequence ${seqIndex}`);
    return frame;
}

describe("exportPngDirectory", () => {
    it("emits manifest.json plus one <id>/NNN.png per frame", () => {
        const anim = makeAnimation();
        const files = exportPngDirectory(anim);

        const manifestBytes = files.get("manifest.json");
        if (!manifestBytes) throw new Error("expected manifest.json to be exported");
        const manifest: unknown = JSON.parse(new TextDecoder().decode(manifestBytes));
        expect(manifest).toMatchObject({ manifestVersion: 1, kind: "bgforge-animation" });

        const pngPaths = [...files.keys()].filter((path) => path !== "manifest.json");
        expect(pngPaths.length).toBe(anim.frames.length);
        for (const path of pngPaths) {
            expect(path).toMatch(/^[^/]+\/\d{3}\.png$/);
        }
    });

    it("throws a clear error when a sequence references an out-of-range frame index", () => {
        const anim: IndexedAnimation = {
            palette: emptyPalette(),
            frames: [],
            sequences: [{ frameRefs: [0], facing: "none" }],
            meta: { sourceFormat: "frm" },
        };
        expect(() => exportPngDirectory(anim)).toThrow(/out-of-range frame index 0/);
    });
});

describe("importPngDirectory(exportPngDirectory(anim))", () => {
    it("round-trips meta, facings, frame counts, offsets, pixels, and palette", () => {
        const anim = makeAnimation();
        const roundTripped = importPngDirectory(exportPngDirectory(anim));
        if (roundTripped.colorModel === "rgba") throw new Error("indexed PNGs must import as indexed");

        expect(roundTripped.meta).toEqual(anim.meta);
        expect(roundTripped.palette).toEqual(anim.palette);
        expect(roundTripped.sequences.length).toBe(anim.sequences.length);

        for (const [s, seq] of anim.sequences.entries()) {
            const importedSeq = roundTripped.sequences[s];
            if (!importedSeq) throw new Error(`missing imported sequence ${s}`);
            expect(importedSeq.facing).toBe(seq.facing);
            expect(importedSeq.frameRefs.length).toBe(seq.frameRefs.length);

            for (let f = 0; f < seq.frameRefs.length; f++) {
                const original = frameAt(anim, s, f);
                const imported = frameAt(roundTripped, s, f);
                expect(imported.width).toBe(original.width);
                expect(imported.height).toBe(original.height);
                expect([...imported.pixels]).toEqual([...original.pixels]);
                expect([imported.offsetX, imported.offsetY]).toEqual([original.offsetX, original.offsetY]);
            }
        }
    });

    it("throws a clear error when a manifest-referenced PNG is missing", () => {
        const anim = makeAnimation();
        const files = exportPngDirectory(anim);
        const framePath = [...files.keys()].find((path) => path !== "manifest.json");
        if (!framePath) throw new Error("test setup: expected at least one frame PNG");
        files.delete(framePath);

        // toThrow(string) does a substring match on the message, which carries the path
        // verbatim ("...missing referenced PNG at <path>") - no regex escaping needed.
        expect(() => importPngDirectory(files)).toThrow(framePath);
    });

    it("rejects a frame PNG whose palette differs from the first frame's", () => {
        const anim = makeAnimation();
        const files = exportPngDirectory(anim);
        const pngPaths = [...files.keys()].filter((path) => path !== "manifest.json");
        const last = pngPaths[pngPaths.length - 1];
        if (!last) throw new Error("test setup: expected frame PNGs");
        // Simulates an external tool re-saving one frame with a reordered/altered palette.
        const other = emptyPalette();
        other[5] = { r: 99, g: 98, b: 97, a: 255 };
        files.set(last, encodeIndexedPng(2, 2, new Uint8Array([5, 0, 0, 5]), other, 0));
        expect(() => importPngDirectory(files)).toThrow(/different palette/);
    });

    it("throws a clear error when manifest.json is missing", () => {
        expect(() => importPngDirectory(new Map())).toThrow(/manifest\.json/);
    });

    it("falls back to an empty palette when the manifest has no sequences to decode a PNG from", () => {
        const anim: IndexedAnimation = {
            palette: emptyPalette(),
            frames: [],
            sequences: [],
            meta: { sourceFormat: "frm" },
        };
        const roundTripped = importPngDirectory(exportPngDirectory(anim));
        if (roundTripped.colorModel === "rgba") throw new Error("indexed PNGs must import as indexed");
        expect(roundTripped.palette).toEqual(emptyPalette());
        expect(roundTripped.sequences).toEqual([]);
        expect(roundTripped.frames).toEqual([]);
    });
});

describe("a true-colour PNG directory", () => {
    /** Two sequences of a 2x2 true-colour frame, with alpha no indexed PNG could carry. */
    function makeRgbaAnimation(): RgbaAnimation {
        const frames = [0, 1].map((n) => {
            const pixels = new Uint8Array(2 * 2 * 4);
            pixels.set([255, n, 0, 255], 0);
            pixels.set([0, 128, 255, 90], 4);
            pixels.set([1, 2, 3, 0], 8);
            pixels.set([200, 210, 220, 255], 12);
            return { width: 2, height: 2, pixels, offsetX: n + 1, offsetY: -(n + 1) };
        });
        return {
            colorModel: "rgba",
            frames,
            sequences: [
                { frameRefs: [0], facing: "NE" as const },
                { frameRefs: [1, 0], facing: "E" as const },
            ],
            meta: { sourceFormat: "bamv2", fps: 15 },
        };
    }

    it("round-trips a true-colour animation exactly, per-pixel alpha included", () => {
        // The whole reason this path exists: routing a v2 through the indexed exporter would flatten
        // every soft edge, and a directory is meant to be the LOSSLESS export.
        const anim = makeRgbaAnimation();

        const roundTripped = importPngDirectory(exportPngDirectory(anim));

        if (roundTripped.colorModel !== "rgba") throw new Error("true-colour PNGs must import as true colour");
        expect(roundTripped.meta.sourceFormat).toBe("bamv2");
        expect(roundTripped.sequences.map((s) => s.facing)).toEqual(["NE", "E"]);
        expect(roundTripped.sequences.map((s) => s.frameRefs.length)).toEqual([1, 2]);
        const first = roundTripped.frames[0];
        if (first === undefined) throw new Error("expected frames");
        expect([...first.pixels]).toEqual([...(anim.frames[0]?.pixels ?? [])]);
        expect([first.offsetX, first.offsetY]).toEqual([1, -1]);
    });

    it("reads indexed PNGs as indexed even when the manifest claims BAM v2", () => {
        // A hand-edited or downgraded directory: the PNGs are the authority on the colour model,
        // and calling the result a v2 would hand 1-byte-per-pixel frames to a 4-byte reader.
        const files = exportPngDirectory(makeAnimation());
        const manifest: unknown = JSON.parse(new TextDecoder().decode(files.get("manifest.json") ?? new Uint8Array()));
        if (typeof manifest !== "object" || manifest === null) throw new Error("expected a manifest object");
        const claimed = { ...manifest, meta: { ...(manifest as { meta: object }).meta, sourceFormat: "bamv2" } };
        files.set("manifest.json", new TextEncoder().encode(JSON.stringify(claimed)));

        const imported = importPngDirectory(files);

        expect(imported.colorModel).toBeUndefined();
        expect(imported.meta.sourceFormat).toBe("bam");
    });

    it("writes PNGs a true-colour reader can open, alpha intact", () => {
        // Asserting the decoded pixel rather than the file count: a directory of the right shape
        // holding indexed PNGs would pass any structural check and lose the alpha silently.
        const files = exportPngDirectory(makeRgbaAnimation());

        const png = files.get("NE/000.png");
        if (png === undefined) throw new Error("expected NE/000.png");
        const decoded = decodeTruecolourPng(png);
        expect([decoded.width, decoded.height]).toEqual([2, 2]);
        expect([...decoded.pixels.subarray(4, 8)]).toEqual([0, 128, 255, 90]);
    });
});
