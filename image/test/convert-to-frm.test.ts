import { describe, expect, it } from "vitest";
import {
    convertToFrm,
    serializeFrm,
    parseFrm,
    DEFAULT_FALLOUT_PALETTE,
    IE8_FACINGS,
    type Animation,
    type Facing,
    type Frame,
    type Rgba,
    type Sequence,
} from "@bgforge/image";

// Builds a BAM-shaped Animation with `seqLens.length` cycles, each holding `seqLens[i]` frames
// of distinct pixel content (so a specific frame can be traced through the conversion). Frames
// carry rawEncoding/rleEncoded like a real BAM parse, to exercise the FRM output's stripping.
function synthBam(seqLens: number[], facings?: Facing[]): Animation {
    const frames: Frame[] = [];
    const sequences: Sequence[] = seqLens.map((len, seqIdx) => {
        const frameRefs: number[] = [];
        for (let i = 0; i < len; i++) {
            const value = (seqIdx * 16 + i + 1) % 256;
            const pixels = new Uint8Array([value, value, value, value]);
            frames.push({
                width: 2,
                height: 2,
                pixels,
                offsetX: 0,
                offsetY: 0,
                rawEncoding: pixels,
                rleEncoded: false,
            });
            frameRefs.push(frames.length - 1);
        }
        const facing = facings?.[seqIdx] ?? "none";
        return { frameRefs, facing };
    });
    return {
        palette: DEFAULT_FALLOUT_PALETTE.map((c) => ({ ...c })),
        sequences,
        frames,
        meta: { sourceFormat: "bam", transparentIndex: 0, directionLayout: facings ? "ie8" : "non-directional" },
    };
}

describe("convertToFrm", () => {
    it("uses an explicit 8-facing layout to select the 6 FRM directions and drop the rest", () => {
        const source = synthBam([2, 2, 2, 2, 2, 2, 2, 2]);
        const { animation, report } = convertToFrm(source, { layout: [...IE8_FACINGS] });

        expect(animation.meta.sourceFormat).toBe("frm");
        expect(animation.meta.directionLayout).toBe("frm6");
        expect(animation.sequences.map((s) => s.facing)).toEqual(["NE", "E", "SE", "SW", "W", "NW"]);

        const droppedItems = report.items.filter((i) => i.kind === "dropped-direction");
        expect(droppedItems).toHaveLength(2);
        // synthBam's palette is the default, so the lossless remap branch (not sidecar) is taken.
        expect(report.has("palette-remapped-to-default")).toBe(true);
    });

    it("pads unequal-length sequences to the max frame count and reports it", () => {
        const lens = [2, 3, 1, 4, 2, 3];
        const source = synthBam(lens);
        const { animation, report } = convertToFrm(source);

        const maxLen = Math.max(...lens);
        expect(animation.sequences.every((s) => s.frameRefs.length === maxLen)).toBe(true);

        const paddedItems = report.items.filter((i) => i.kind === "padded-sequence");
        expect(paddedItems).toHaveLength(lens.filter((n) => n !== maxLen).length);
    });

    it("duplicates a frame shared across directions and reports it", () => {
        // A 6-cycle source (positional -> FRM order) where two directions reference the same frame;
        // FRM cannot share a frame across directions, so it must be duplicated into two entries.
        const mk = (v: number): Frame => ({ width: 1, height: 1, pixels: new Uint8Array([v]), offsetX: 0, offsetY: 0 });
        const source: Animation = {
            palette: DEFAULT_FALLOUT_PALETTE.map((c) => ({ ...c })),
            sequences: [
                { frameRefs: [0], facing: "none" }, // NE
                { frameRefs: [0], facing: "none" }, // E - shares frame 0 with NE
                { frameRefs: [1], facing: "none" },
                { frameRefs: [2], facing: "none" },
                { frameRefs: [3], facing: "none" },
                { frameRefs: [4], facing: "none" },
            ],
            frames: [mk(1), mk(2), mk(3), mk(4), mk(5)],
            meta: { sourceFormat: "bam", transparentIndex: 0, directionLayout: "non-directional" },
        };
        const { animation, report } = convertToFrm(source);
        expect(report.has("duplicated-shared-frames")).toBe(true);
        const neRef = animation.sequences[0]?.frameRefs[0];
        const eRef = animation.sequences[1]?.frameRefs[0];
        if (neRef === undefined || eRef === undefined) throw new Error("missing frame refs");
        expect(neRef).not.toBe(eRef); // two distinct pool entries, not one shared frame
        const neFrame = animation.frames[neRef];
        const eFrame = animation.frames[eRef];
        if (!neFrame || !eFrame) throw new Error("missing frames");
        expect([...neFrame.pixels]).toEqual([...eFrame.pixels]); // same pixel data, independent entries
    });

    it("throws for a non-standard cycle count with no layout and no real source facings", () => {
        const source = synthBam(Array.from({ length: 9 }, () => 1));
        expect(() => convertToFrm(source)).toThrow(
            /convertToFrm: 9-cycle BAM has no standard direction mapping; pass opts\.layout/,
        );
    });

    it("produces an FRM animation that serializes and reparses with pixels intact", () => {
        const source = synthBam([2, 2, 2, 2, 2, 2, 2, 2]);
        const { animation } = convertToFrm(source, { layout: [...IE8_FACINGS] });

        const bytes = serializeFrm(animation);
        const reparsed = parseFrm(bytes);

        expect(reparsed.sequences).toHaveLength(6);
        for (let slot = 0; slot < 6; slot++) {
            const origSeq = animation.sequences[slot];
            const newSeq = reparsed.sequences[slot];
            if (!origSeq || !newSeq) throw new Error(`missing sequence at slot ${slot}`);
            expect(newSeq.frameRefs).toHaveLength(origSeq.frameRefs.length);
            for (let i = 0; i < origSeq.frameRefs.length; i++) {
                const origIdx = origSeq.frameRefs[i];
                const newIdx = newSeq.frameRefs[i];
                if (origIdx === undefined || newIdx === undefined) throw new Error("frame ref index out of range");
                const origFrame = animation.frames[origIdx];
                const newFrame = reparsed.frames[newIdx];
                if (!origFrame || !newFrame) throw new Error("frame out of range");
                expect(Buffer.from(newFrame.pixels).toString("hex")).toBe(
                    Buffer.from(origFrame.pixels).toString("hex"),
                );
            }
        }
    });

    it("keeps the source palette and strips rawEncoding when the palette cannot losslessly remap (sidecar path)", () => {
        const source = synthBam([2, 2, 2, 2, 2, 2]);
        // Color absent from DEFAULT_FALLOUT_PALETTE (verified via a preceding grep of the file).
        const oddColor = { r: 1, g: 2, b: 3, a: 255 };
        const p1 = source.palette[1];
        if (!p1) throw new Error("expected palette index 1");
        source.palette[1] = oddColor; // index 1 is the pixel value of the first synthesized frame

        const { animation, report } = convertToFrm(source);

        expect(report.has("palette-sidecar-required")).toBe(true);
        expect(animation.palette).toEqual(source.palette);
        expect(animation.frames.length).toBeGreaterThan(0);
        expect(animation.frames.every((f) => f.rawEncoding === undefined)).toBe(true);
        expect(animation.frames.every((f) => f.rleEncoded === undefined)).toBe(true);
    });

    it("is a no-op for an already-FRM source", () => {
        const facings: Facing[] = ["NE", "E", "SE", "SW", "W", "NW"];
        const src: Animation = {
            palette: DEFAULT_FALLOUT_PALETTE.map((c) => ({ ...c })),
            sequences: facings.map((facing) => ({ frameRefs: [0], facing })),
            frames: [{ width: 1, height: 1, pixels: new Uint8Array([0]), offsetX: 0, offsetY: 0 }],
            meta: { sourceFormat: "frm", directionLayout: "frm6" },
        };
        const { animation, report } = convertToFrm(src);
        expect(report.lossless).toBe(true);
        expect(animation.meta.sourceFormat).toBe("frm");
        expect(animation).not.toBe(src); // a fresh object, per the clone contract
    });

    it("throws when opts.layout length does not match the sequence count", () => {
        const src = synthBam([1, 1, 1, 1, 1, 1, 1, 1]); // 8 sequences
        expect(() => convertToFrm(src, { layout: [...IE8_FACINGS].slice(0, 5) })).toThrow(
            /opts\.layout has 5 entries, expected 8/,
        );
    });

    it("throws on a layout with a duplicate FRM facing", () => {
        const src = synthBam([1, 1, 1, 1, 1, 1]);
        const layout: Facing[] = ["NE", "NE", "SE", "SW", "W", "NW"]; // NE claimed twice
        expect(() => convertToFrm(src, { layout })).toThrow(/duplicate FRM facing "NE"/);
    });

    it("reuses a direction and reports empty-direction when a FRM facing is absent from the layout", () => {
        // Layout covers NE,E,SE,SW,W and N (no NW); the NW slot has no source and reuses slot 0.
        const src = synthBam([1, 1, 1, 1, 1, 1]);
        const layout: Facing[] = ["NE", "E", "SE", "SW", "W", "N"];
        const { animation, report } = convertToFrm(src, { layout });
        expect(report.has("empty-direction")).toBe(true);
        expect(report.has("dropped-direction")).toBe(true); // N is dropped
        expect(animation.sequences.map((s) => s.facing)).toEqual(["NE", "E", "SE", "SW", "W", "NW"]);
    });

    it("uses the sequences' own facings when the cycle count is non-standard", () => {
        // 7 sequences with real facings -> facingsForCycleCount(7) is null, so own facings drive the mapping.
        const facings: Facing[] = ["NE", "E", "SE", "SW", "W", "NW", "N"];
        const src = synthBam([1, 1, 1, 1, 1, 1, 1], facings);
        const { animation, report } = convertToFrm(src);
        expect(animation.sequences).toHaveLength(6);
        const dropped = report.items.find((item) => item.kind === "dropped-direction");
        expect(dropped?.detail).toContain("facing N"); // specifically the extra N is dropped
    });

    // A palette whose colors are absent from DEFAULT_FALLOUT_PALETTE, forcing the sidecar path
    // under the default paletteMode (mirrors the oddColor fixture above, but every slot is bespoke).
    function bespokeBam(): Animation {
        const palette: Rgba[] = Array.from({ length: 256 }, (_, i) => ({
            r: (i * 7) % 256,
            g: (i * 13) % 256,
            b: (i * 29) % 256,
            a: 255,
        }));
        palette[0] = { r: 0, g: 0, b: 0, a: 255 };
        const facings: Facing[] = ["NE", "E", "SE", "SW", "W", "NW"];
        const frames: Frame[] = facings.map(() => ({
            width: 1,
            height: 1,
            pixels: Uint8Array.from([5]),
            offsetX: 0,
            offsetY: 0,
        }));
        return {
            palette,
            frames,
            sequences: facings.map((facing, i) => ({ frameRefs: [i], facing })),
            meta: { sourceFormat: "bam", transparentIndex: 0 },
        };
    }

    it("paletteMode 'nearest' remaps to the default palette and reports it instead of a sidecar", () => {
        const { animation, report } = convertToFrm(bespokeBam(), { paletteMode: "nearest" });
        expect(report.has("palette-nearest-remapped")).toBe(true);
        expect(report.has("palette-sidecar-required")).toBe(false);
        expect(animation.palette).toEqual(DEFAULT_FALLOUT_PALETTE);
    });

    it("default paletteMode still requires a sidecar for a bespoke palette", () => {
        const { report } = convertToFrm(bespokeBam());
        expect(report.has("palette-sidecar-required")).toBe(true);
        expect(report.has("palette-nearest-remapped")).toBe(false);
    });
});
