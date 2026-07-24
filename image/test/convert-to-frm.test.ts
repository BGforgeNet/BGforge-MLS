import { describe, expect, it } from "vitest";
import {
    convertToFrm,
    frmDirectionMode,
    serializeFrm,
    parseFrm,
    DEFAULT_FALLOUT_PALETTE,
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
    it("maps an 8-cycle source onto the 6 FRM directions (IE8 order) and drops the rest", () => {
        const source = synthBam([2, 2, 2, 2, 2, 2, 2, 2]);
        const { animation, report } = convertToFrm(source);

        expect(animation.meta.sourceFormat).toBe("frm");
        expect(animation.meta.directionLayout).toBe("frm6");
        expect(animation.sequences.map((s) => s.facing)).toEqual(["NE", "E", "SE", "SW", "W", "NW"]);

        // The two slotless cycles (N and S) aggregate into ONE counted item, not a line per cycle.
        const droppedItems = report.items.filter((i) => i.kind === "dropped-direction");
        expect(droppedItems).toHaveLength(1);
        expect(droppedItems[0]?.detail).toContain("2 cycle(s) have no FRM slot");
        expect(droppedItems[0]?.detail).toContain("facing N");
        expect(droppedItems[0]?.detail).toContain("facing S");
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

    it("pads a zero-frame direction with 1x1 transparent frames", () => {
        const source = synthBam([2, 0, 2, 2, 2, 2]); // slot 1 has no frames at all
        const { animation, report } = convertToFrm(source);
        expect(report.has("padded-sequence")).toBe(true);
        const seq = animation.sequences[1];
        if (!seq) throw new Error("missing padded sequence");
        expect(seq.frameRefs).toHaveLength(2);
        const pad = animation.frames[seq.frameRefs[0] ?? -1];
        if (!pad) throw new Error("missing padded frame");
        expect([pad.width, pad.height]).toEqual([1, 1]); // no sibling frame to size from -> minimal
        expect([...pad.pixels]).toEqual([0]);
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

    it("throws for a multi-cycle non-directional source with no chosen cycle (needs opts.singleCycle)", () => {
        const source = synthBam(Array.from({ length: 9 }, () => 1));
        expect(() => convertToFrm(source)).toThrow(
            /9-cycle animation as FRM: it has no directions - choose which cycle/,
        );
    });

    it("a directional conversion with only a lossless palette remap reports lossless (no false 'will lose')", () => {
        const source = synthBam([2, 2, 2, 2, 2, 2]); // 6 cycles, default palette, distinct frames
        const { report } = convertToFrm(source);
        expect(report.has("palette-remapped-to-default")).toBe(true); // the remap IS recorded
        expect(report.lossless).toBe(true); // but it loses nothing -> no warning modal
        expect(report.losses).toEqual([]);
    });

    it("frmDirectionMode: 6/8 cycles or facing-tagged are directional; other non-directional are single-orientation", () => {
        expect(frmDirectionMode(synthBam([2, 2, 2, 2, 2, 2]))).toBe("directional"); // 6 cycles
        expect(frmDirectionMode(synthBam([2, 2, 2, 2, 2, 2, 2, 2]))).toBe("directional"); // 8 cycles
        expect(frmDirectionMode(synthBam([2, 2], ["NE", "E"]))).toBe("directional"); // facing-tagged
        expect(frmDirectionMode(synthBam([3]))).toBe("single-orientation"); // 1 cycle
        expect(frmDirectionMode(synthBam([2, 2, 2, 2]))).toBe("single-orientation"); // 4 cycles
    });

    it("converts a single-cycle non-directional source to a shared single-orientation FRM (one copy, all 6 rotations)", () => {
        const source = synthBam([3]); // 1 cycle, 3 frames, non-directional
        const { animation } = convertToFrm(source);
        expect(animation.meta.sourceFormat).toBe("frm");
        expect(animation.sequences).toHaveLength(6);
        // All 6 rotations reference the IDENTICAL frame-ref list -> shared data_offsets, one frame copy.
        expect(new Set(animation.sequences.map((s) => s.frameRefs.join(","))).size).toBe(1);
        expect(animation.frames).toHaveLength(3); // one animation, not six copies
        // Still shared after a real FRM serialize/reparse round-trip.
        const reparsed = parseFrm(serializeFrm(animation));
        expect(reparsed.sequences).toHaveLength(6);
        expect(new Set(reparsed.sequences.map((s) => s.frameRefs.join(","))).size).toBe(1);
    });

    it("opts.singleCycle builds a single-orientation FRM from the chosen cycle and reports the dropped cycles", () => {
        const source = synthBam([2, 2, 2, 2]); // 4 non-directional cycles
        const { animation, report } = convertToFrm(source, { singleCycle: 2 });
        expect(animation.sequences).toHaveLength(6);
        expect(new Set(animation.sequences.map((s) => s.frameRefs.join(","))).size).toBe(1);
        expect(report.items.some((i) => i.detail.includes("cycle 2") && i.detail.includes("dropped"))).toBe(true);
    });

    it("produces an FRM animation that serializes and reparses with pixels intact", () => {
        const source = synthBam([2, 2, 2, 2, 2, 2, 2, 2]);
        const { animation } = convertToFrm(source);

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

    it("throws on facing tags claiming the same FRM facing twice", () => {
        // 7 cycles so the count-derived layouts don't apply and the sequences' own tags drive the mapping.
        const facings: Facing[] = ["NE", "NE", "SE", "SW", "W", "NW", "N"]; // NE claimed twice
        const src = synthBam([1, 1, 1, 1, 1, 1, 1], facings);
        expect(() => convertToFrm(src)).toThrow(/duplicate FRM facing "NE"/);
    });

    it("reuses a direction and reports empty-direction when a FRM facing is absent from the tags", () => {
        // Tags cover NE,E,SE,SW,W plus N and S (no NW); the NW slot has no source and reuses slot 0.
        const facings: Facing[] = ["NE", "E", "SE", "SW", "W", "N", "S"];
        const src = synthBam([1, 1, 1, 1, 1, 1, 1], facings);
        const { animation, report } = convertToFrm(src);
        expect(report.has("empty-direction")).toBe(true);
        expect(report.has("dropped-direction")).toBe(true); // N and S are dropped
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

    it("pads with the source's transparent index, so padding stays transparent when that index is non-zero", () => {
        const source = synthBam([2, 1, 2, 2, 2, 2]); // slot 1 is short -> padded
        source.meta.transparentIndex = 5;
        const { animation, report } = convertToFrm(source);

        // The default palette resolves losslessly, so padding must not force the sidecar path either.
        expect(report.has("palette-remapped-to-default")).toBe(true);
        expect(report.has("padded-sequence")).toBe(true);

        const padSeq = animation.sequences[1];
        if (!padSeq) throw new Error("missing padded sequence");
        const padRef = padSeq.frameRefs[1];
        if (padRef === undefined) throw new Error("missing padded frame ref");
        const padFrame = animation.frames[padRef];
        if (!padFrame) throw new Error("missing padded frame");
        // Transparent in FRM terms is index 0; a raw zero-fill would have read as the source's color 0.
        expect([...padFrame.pixels].every((p) => p === 0)).toBe(true);
    });

    it("re-indexes transparency to slot 0 on the sidecar path (0 <-> transparentIndex swap)", () => {
        const source = bespokeBam(); // bespoke palette -> sidecar path
        source.meta.transparentIndex = 5;
        // First frame mixes a transparent pixel (5) with a color pixel (9).
        const first = source.frames[0];
        if (!first) throw new Error("missing frame");
        first.pixels = Uint8Array.from([5]);
        const second = source.frames[1];
        if (!second) throw new Error("missing frame");
        second.pixels = Uint8Array.from([9]);
        const third = source.frames[2];
        if (!third) throw new Error("missing frame");
        third.pixels = Uint8Array.from([0]); // a real color at slot 0, displaced by the swap

        const { animation, report } = convertToFrm(source);
        expect(report.has("palette-sidecar-required")).toBe(true);

        const outFirst = animation.frames[animation.sequences[0]?.frameRefs[0] ?? -1];
        const outSecond = animation.frames[animation.sequences[1]?.frameRefs[0] ?? -1];
        const outThird = animation.frames[animation.sequences[2]?.frameRefs[0] ?? -1];
        if (!outFirst || !outSecond || !outThird) throw new Error("missing converted frames");
        expect([...outFirst.pixels]).toEqual([0]); // transparent pixel moved to FRM's slot 0
        expect([...outSecond.pixels]).toEqual([9]); // untouched color index
        expect([...outThird.pixels]).toEqual([5]); // the displaced slot-0 color follows its palette entry
        // Palette entries swapped alongside the pixels - the permutation is lossless.
        expect(animation.palette[0]).toEqual(source.palette[5]);
        expect(animation.palette[5]).toEqual(source.palette[0]);
    });

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

    it("tagged facings win over the count-derived order for a 6-cycle source", () => {
        // Cycle 0 is tagged SE; the positional FRM order would have read it as NE.
        const facings: Facing[] = ["SE", "SW", "W", "NW", "NE", "E"];
        const src = synthBam([1, 1, 1, 1, 1, 1], facings);
        const { animation } = convertToFrm(src);
        const seRef = animation.sequences[2]?.frameRefs[0]; // FRM slot 2 = SE
        if (seRef === undefined) throw new Error("missing SE frame ref");
        // Cycle 0's traced 2x2 frame (pixel value 1 everywhere).
        expect([...(animation.frames[seRef]?.pixels ?? [])]).toEqual([1, 1, 1, 1]);
    });

    describe("uniform rotation canvas", () => {
        it("re-composes a rotation's frames onto one anchor-aligned canvas so geometry cannot jitter", () => {
            const mk = (w: number, px: number[], cx: number): Frame => ({
                width: w,
                height: 1,
                pixels: Uint8Array.from(px),
                offsetX: cx,
                offsetY: 0,
            });
            // NE holds two frames of differing width whose BAM centre anchors align the content:
            // A (w4, anchor x3) spans anchor-relative [-3..1], B (w1, anchor x0) spans [0..1].
            const source: Animation = {
                palette: DEFAULT_FALLOUT_PALETTE.map((c) => ({ ...c })),
                sequences: [
                    { frameRefs: [0, 1], facing: "NE" },
                    { frameRefs: [2], facing: "E" },
                    { frameRefs: [3], facing: "SE" },
                    { frameRefs: [4], facing: "SW" },
                    { frameRefs: [5], facing: "W" },
                    { frameRefs: [6], facing: "NW" },
                ],
                frames: [
                    mk(4, [1, 2, 3, 4], 3),
                    mk(1, [9], 0),
                    mk(1, [5], 0),
                    mk(1, [5], 0),
                    mk(1, [5], 0),
                    mk(1, [5], 0),
                    mk(1, [5], 0),
                ],
                meta: { sourceFormat: "bam", transparentIndex: 0 },
            };
            const { animation } = convertToFrm(source);
            const [refA, refB] = animation.sequences[0]?.frameRefs ?? [];
            const frameA = refA === undefined ? undefined : animation.frames[refA];
            const frameB = refB === undefined ? undefined : animation.frames[refB];
            if (!frameA || !frameB) throw new Error("missing NE frames");
            // Both frames share the union canvas (width 4), with content blitted at its anchor spot.
            expect([frameA.width, frameA.height]).toEqual([4, 1]);
            expect([frameB.width, frameB.height]).toEqual([4, 1]);
            expect([...frameA.pixels]).toEqual([1, 2, 3, 4]);
            expect([...frameB.pixels]).toEqual([0, 0, 0, 9]); // anchor-aligned: 9 sits under A's anchor column
            // The rotation's direction offset moves the FRM bottom-centre onto the shared anchor.
            expect(animation.meta.dirOffsetsX?.[0]).toBe(-1); // round(4/2 + (-3))
            expect(animation.meta.dirOffsetsY?.[0]).toBe(0); // height 1, top 0
        });
    });

    // An IE base file: per 8-slot block, slots 0-4 (S, SW, W, NW, N) hold one traceable frame each
    // (pixel value 1 + block*16 + slot), slots 5-7 stuff the shared filler frame 0 - the shape
    // interpretIeDirections detects. Frame 0's pixel is 255 so a leaked filler is traceable too.
    function baseFileBam(blocks: number): Animation {
        const frames: Frame[] = [{ width: 1, height: 1, pixels: new Uint8Array([255]), offsetX: 0, offsetY: 0 }];
        const sequences: Sequence[] = [];
        for (let g = 0; g < blocks; g++) {
            for (let slot = 0; slot < 5; slot++) {
                frames.push({
                    width: 1,
                    height: 1,
                    pixels: new Uint8Array([1 + g * 16 + slot]),
                    offsetX: 0,
                    offsetY: 0,
                });
                sequences.push({ frameRefs: [frames.length - 1], facing: "none" });
            }
            for (let slot = 5; slot < 8; slot++) sequences.push({ frameRefs: [0, 0], facing: "none" });
        }
        return {
            palette: DEFAULT_FALLOUT_PALETTE.map((c) => ({ ...c })),
            sequences,
            frames,
            meta: { sourceFormat: "bam", transparentIndex: 0, directionLayout: "ie8" },
        };
    }

    describe("opts.ieGroup", () => {
        const slotPixel = (animation: Animation, slot: number): number => {
            const ref = animation.sequences[slot]?.frameRefs[0];
            const frame = ref === undefined ? undefined : animation.frames[ref];
            if (!frame) throw new Error(`missing frame at FRM slot ${slot}`);
            return frame.pixels[0] ?? -1;
        };

        it("converts one direction block to a directional FRM: west arc mapped, N/S dropped, east mirrored", () => {
            const { animation, report } = convertToFrm(baseFileBam(2), { ieGroup: 1 });
            expect(animation.sequences.map((s) => s.facing)).toEqual(["NE", "E", "SE", "SW", "W", "NW"]);
            // Block 1's SW/W/NW cycles land in their FRM slots, traced by pixel value.
            expect(slotPixel(animation, 3)).toBe(1 + 16 + 1); // SW
            expect(slotPixel(animation, 4)).toBe(1 + 16 + 2); // W
            expect(slotPixel(animation, 5)).toBe(1 + 16 + 3); // NW
            // The unstored east rotations mirror their west counterparts: NE<-NW, E<-W, SE<-SW.
            expect(slotPixel(animation, 0)).toBe(1 + 16 + 3); // NE = mirrored NW
            expect(slotPixel(animation, 1)).toBe(1 + 16 + 2); // E = mirrored W
            expect(slotPixel(animation, 2)).toBe(1 + 16 + 1); // SE = mirrored SW
            const dropped = report.items.filter((i) => i.kind === "dropped-direction").map((i) => i.detail);
            expect(dropped.some((d) => d.includes("block 1") && d.includes("11 other cycle(s)"))).toBe(true);
            expect(dropped.some((d) => d.includes("facing S"))).toBe(true);
            expect(dropped.some((d) => d.includes("facing N"))).toBe(true);
            expect(report.items.filter((i) => i.kind === "empty-direction")).toHaveLength(0);
            expect(report.has("mirrored-directions")).toBe(true);
            expect(report.lossless).toBe(false);
        });

        it("drops the east filler dummies instead of mapping them onto the east rotations", () => {
            const { animation } = convertToFrm(baseFileBam(1), { ieGroup: 0 });
            // Without ieGroup an 8-cycle source maps positionally, putting filler frame 255 in NE/E/SE;
            // the block extraction mirrors the west cycles there instead.
            for (const slot of [0, 1, 2]) expect(slotPixel(animation, slot)).not.toBe(255);
        });

        it("mirrors east pixels horizontally", () => {
            const source = baseFileBam(1);
            // Make W (block 0 slot 2) an asymmetric 2x1 frame so the flip is observable.
            const wRef = source.sequences[2]?.frameRefs[0];
            if (wRef === undefined) throw new Error("missing W frame ref");
            source.frames[wRef] = { width: 2, height: 1, pixels: new Uint8Array([7, 9]), offsetX: 0, offsetY: 0 };
            const { animation } = convertToFrm(source, { ieGroup: 0 });
            const eRef = animation.sequences[1]?.frameRefs[0]; // FRM slot 1 = E, mirrored from W
            const eFrame = eRef === undefined ? undefined : animation.frames[eRef];
            if (!eFrame) throw new Error("missing mirrored E frame");
            expect([...eFrame.pixels]).toEqual([9, 7]);
        });

        it("uses stored east cycles when the block has them, without mirroring", () => {
            // A combined base+E-file shape: all 8 slots real.
            const source = baseFileBam(1);
            for (const slot of [5, 6, 7]) {
                source.frames.push({
                    width: 1,
                    height: 1,
                    pixels: new Uint8Array([100 + slot]),
                    offsetX: 0,
                    offsetY: 0,
                });
                source.sequences[slot] = { frameRefs: [source.frames.length - 1], facing: "none" };
            }
            const { animation, report } = convertToFrm(source, { ieGroup: 0 });
            expect(report.has("mirrored-directions")).toBe(false);
            expect(slotPixel(animation, 0)).toBe(105); // NE from the stored cycle (slot 5)
            expect(slotPixel(animation, 1)).toBe(106); // E (slot 6)
            expect(slotPixel(animation, 2)).toBe(107); // SE (slot 7)
        });

        it("filters out-of-range sentinel refs from the extracted block's cycles", () => {
            const source = baseFileBam(1);
            // A real-world west cycle carrying a 0xFFFF "no frame" entry; unfiltered, the directional
            // builder would throw on the out-of-range ref.
            source.sequences[1]?.frameRefs.push(65535);
            const { animation } = convertToFrm(source, { ieGroup: 0 });
            expect(slotPixel(animation, 3)).toBe(2); // SW = block 0 slot 1, sentinel dropped
        });

        it("throws for a missing block or an uninterpretable source", () => {
            expect(() => convertToFrm(baseFileBam(2), { ieGroup: 2 })).toThrow(/no IE direction block 2/);
            const tagged = synthBam([1, 1], ["NE", "E"]);
            expect(() => convertToFrm(tagged, { ieGroup: 0 })).toThrow(/no IE direction block 0/);
        });

        it("rejects ieGroup combined with singleCycle", () => {
            expect(() => convertToFrm(baseFileBam(1), { ieGroup: 0, singleCycle: 0 })).toThrow(/mutually exclusive/);
        });
    });
});
