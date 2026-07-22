import { describe, expect, it } from "vitest";
import { type Animation, type Frame, emptyPalette, exportApngPerDirection, importApng } from "@bgforge/image";

// Two sequences with distinct frame counts and pixel content, so the per-sequence
// split can be distinguished from a mixed-up one.
function makeAnimation(): Animation {
    const palette = emptyPalette();
    palette[0] = { r: 0, g: 0, b: 0, a: 0 };
    palette[5] = { r: 10, g: 20, b: 30, a: 255 };
    palette[10] = { r: 40, g: 50, b: 60, a: 255 };

    const frames: Frame[] = [];
    function pushFrame(pixelValue: number, offsetX: number, offsetY: number): number {
        frames.push({ width: 2, height: 2, pixels: new Uint8Array([pixelValue, 0, 0, pixelValue]), offsetX, offsetY });
        return frames.length - 1;
    }

    const facings = ["NE", "E"] as const;
    const framesPerSequence = [2, 3];
    const sequences = facings.map((facing, s) => {
        const count = framesPerSequence[s] ?? 1;
        const frameRefs: number[] = [];
        for (let f = 0; f < count; f++) {
            const pixelValue = [5, 10][(s + f) % 2] ?? 5;
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

describe("exportApngPerDirection", () => {
    it("emits one <id>.png per sequence", () => {
        const anim = makeAnimation();
        const files = exportApngPerDirection(anim);
        expect([...files.keys()].sort()).toEqual(["E.png", "NE.png"]);
    });
});

describe("importApng(exportApngPerDirection(anim).get(id))", () => {
    it("returns that sequence's frames with exact pixels and the animation's fps", () => {
        const anim = makeAnimation();
        const files = exportApngPerDirection(anim);
        const bytes = files.get("NE.png");
        if (!bytes) throw new Error("expected NE.png to be exported");
        const imported = importApng(bytes);

        expect(imported.fps).toBe(anim.meta.fps);
        const seq = anim.sequences[0];
        if (!seq) throw new Error("test setup: missing sequence 0");
        expect(imported.frames).toHaveLength(seq.frameRefs.length);
        for (const [f, ref] of seq.frameRefs.entries()) {
            const original = anim.frames[ref];
            if (!original) throw new Error(`test setup: missing frame ${ref}`);
            const importedFrame = imported.frames[f];
            if (!importedFrame) throw new Error(`missing imported frame ${f}`);
            expect(importedFrame.width).toBe(original.width);
            expect(importedFrame.height).toBe(original.height);
            expect([...importedFrame.pixels]).toEqual([...original.pixels]);
        }
    });

    it("throws a clear error when a sequence references an out-of-range frame index", () => {
        const anim: Animation = {
            palette: emptyPalette(),
            frames: [],
            sequences: [{ frameRefs: [0], facing: "none" }],
            meta: { sourceFormat: "frm" },
        };
        expect(() => exportApngPerDirection(anim)).toThrow(/out-of-range frame index 0/);
    });
});
