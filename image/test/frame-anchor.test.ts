import { describe, expect, test } from "vitest";
import type { SourceFormat } from "../src/model/animation.ts";
import { anchorToOffset, offsetToAnchor, translateFrameOffset } from "../src/model/frame-anchor.ts";

const ALL_FORMATS: SourceFormat[] = ["frm", "bam", "bamc"];

describe("offsetToAnchor", () => {
    test("BAM's stored offset IS the anchor pixel", () => {
        expect(offsetToAnchor("bam", { width: 40, height: 60, offsetX: 20, offsetY: 55 })).toEqual({ ax: 20, ay: 55 });
        expect(offsetToAnchor("bamc", { width: 40, height: 60, offsetX: 20, offsetY: 55 })).toEqual({ ax: 20, ay: 55 });
    });

    test("FRM's default (zero offset) anchor is feet: horizontally centered, bottom edge", () => {
        expect(offsetToAnchor("frm", { width: 40, height: 60, offsetX: 0, offsetY: 0 })).toEqual({ ax: 20, ay: 60 });
    });

    test("FRM per-frame and per-direction offsets both shift the anchor", () => {
        const a = offsetToAnchor("frm", {
            width: 40,
            height: 60,
            offsetX: 3,
            offsetY: -4,
            dirOffsetX: 1,
            dirOffsetY: 2,
        });
        // ax = 40/2 - 1 - 3 = 16 ; ay = 60 - 2 - (-4) = 62
        expect(a).toEqual({ ax: 16, ay: 62 });
    });
});

describe("anchorToOffset is the inverse of offsetToAnchor (target dirOffset 0)", () => {
    for (const format of ALL_FORMATS) {
        test(`${format} round-trips offset -> anchor -> offset for even and odd widths`, () => {
            const cases: [number, number, number, number][] = [
                [40, 60, 5, -7],
                [63, 74, -8, 11],
                [1, 1, 0, 0],
            ];
            for (const [width, height, offsetX, offsetY] of cases) {
                const anchor = offsetToAnchor(format, { width, height, offsetX, offsetY });
                const back = anchorToOffset(format, { ...anchor, width, height });
                expect(back).toEqual({ offsetX, offsetY });
            }
        });
    }
});

describe("translateFrameOffset preserves the on-screen anchor across a format change", () => {
    test("the reported BAM->FRM case: a 63x74 frame centered at (39,67) becomes feet-relative (-7,7)", () => {
        const out = translateFrameOffset("bam", "frm", { width: 63, height: 74, offsetX: 39, offsetY: 67 });
        expect(out).toEqual({ offsetX: -7, offsetY: 7 });
    });

    test("every source->target pair keeps the anchor within the <=0.5px integer-rounding bound", () => {
        const frames = [
            { width: 64, height: 96, offsetX: 4, offsetY: -3 },
            { width: 63, height: 74, offsetX: 39, offsetY: 67 },
            { width: 17, height: 33, offsetX: -5, offsetY: 12 },
        ];
        for (const source of ALL_FORMATS) {
            for (const target of ALL_FORMATS) {
                for (const f of frames) {
                    const before = offsetToAnchor(source, f);
                    const translated = translateFrameOffset(source, target, f);
                    const after = offsetToAnchor(target, { ...f, ...translated });
                    expect(Math.abs(after.ax - before.ax)).toBeLessThanOrEqual(0.5);
                    expect(Math.abs(after.ay - before.ay)).toBeLessThanOrEqual(0.5);
                }
            }
        }
    });

    test("same-format translate is a no-op for even width (used only cross-format, but must not corrupt)", () => {
        const f = { width: 64, height: 96, offsetX: 7, offsetY: -2 };
        expect(translateFrameOffset("bam", "bam", f)).toEqual({ offsetX: 7, offsetY: -2 });
        expect(translateFrameOffset("frm", "frm", f)).toEqual({ offsetX: 7, offsetY: -2 });
    });
});

test("guard: every SourceFormat has a defined offset<->anchor mapping (a new format without one fails here)", () => {
    for (const format of ALL_FORMATS) {
        // Even dims so integer rounding cannot mask a missing/wrong mapping.
        const f = { width: 40, height: 60, offsetX: 6, offsetY: -8 };
        const anchor = offsetToAnchor(format, f);
        expect(anchorToOffset(format, { ...anchor, width: f.width, height: f.height })).toEqual({
            offsetX: 6,
            offsetY: -8,
        });
    }
});
