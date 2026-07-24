import { describe, expect, test } from "vitest";
import type { SourceFormat } from "../src/model/animation.ts";
import { offsetToAnchor } from "../src/model/frame-anchor.ts";

const ALL_FORMATS: SourceFormat[] = ["frm", "bam", "bamc"];

describe("offsetToAnchor", () => {
    test("BAM's stored centre IS the anchor pixel", () => {
        expect(offsetToAnchor("bam", { width: 40, height: 60, offsetX: 20, offsetY: 55 })).toEqual({ ax: 20, ay: 55 });
        expect(offsetToAnchor("bamc", { width: 40, height: 60, offsetX: 20, offsetY: 55 })).toEqual({ ax: 20, ay: 55 });
    });

    test("FRM anchor is bottom-centre (width/2, height-1), and the per-frame offset is IGNORED", () => {
        // The per-frame offset is an animation motion delta - it must NOT move the static anchor.
        expect(offsetToAnchor("frm", { width: 40, height: 60, offsetX: 99, offsetY: -99 })).toEqual({ ax: 20, ay: 59 });
    });

    test("FRM per-direction header offset shifts the anchor (per-frame offset still ignored)", () => {
        const a = offsetToAnchor("frm", {
            width: 40,
            height: 60,
            offsetX: 7,
            offsetY: 7,
            dirOffsetX: 3,
            dirOffsetY: -2,
        });
        // ax = 40/2 - 3 = 17 ; ay = (60-1) - (-2) = 61
        expect(a).toEqual({ ax: 17, ay: 61 });
    });
});

test("guard: offsetToAnchor is defined for every SourceFormat (a new format without one fails here)", () => {
    for (const format of ALL_FORMATS) {
        expect(() => offsetToAnchor(format, { width: 40, height: 60, offsetX: 6, offsetY: -8 })).not.toThrow();
    }
});
