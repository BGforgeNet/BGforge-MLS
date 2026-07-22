import { describe, expect, it } from "vitest";
import { type Animation, type Frame, emptyPalette, exportPngDirectory, importPngDirectory } from "@bgforge/image";

// Six sequences (one per FRM facing), with distinct frame counts, pixel content,
// and offsets, so the round-trip test can distinguish a mixed-up ordering from a
// correct one. transparentIndex is left undefined on purpose to exercise the
// `anim.meta.transparentIndex ?? 0` fallback in exportPngDirectory. Every palette
// entry stays opaque (a: 255) per the IR convention - transparency is carried only
// via the (implicit, here index 0) transparentIndex, never via palette alpha.
function makeAnimation(): Animation {
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

function frameAt(anim: Animation, seqIndex: number, frameIndex: number): Frame {
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
        const anim: Animation = {
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

        expect(() => importPngDirectory(files)).toThrow(new RegExp(framePath.replaceAll(/[/.]/g, "\\$&")));
    });

    it("throws a clear error when manifest.json is missing", () => {
        expect(() => importPngDirectory(new Map())).toThrow(/manifest\.json/);
    });

    it("falls back to an empty palette when the manifest has no sequences to decode a PNG from", () => {
        const anim: Animation = { palette: emptyPalette(), frames: [], sequences: [], meta: { sourceFormat: "frm" } };
        const roundTripped = importPngDirectory(exportPngDirectory(anim));
        expect(roundTripped.palette).toEqual(emptyPalette());
        expect(roundTripped.sequences).toEqual([]);
        expect(roundTripped.frames).toEqual([]);
    });
});
