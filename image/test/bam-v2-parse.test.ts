import { describe, expect, it } from "vitest";
import fs from "fs";
import path from "path";
import { decodeBamV2, pvrzResourceName } from "../src/bam/v2-parse.ts";
import { type BamV2Structure, readBamV2Structure } from "../src/bam/v2-structure.ts";
import { encodePvrz } from "../src/pvrz/container.ts";
import { corpusFiles, IE_CORPUS } from "./fixtures.ts";

const v2Files = corpusFiles(IE_CORPUS, ".bam").filter(
    (f) => fs.readFileSync(f).subarray(0, 8).toString("latin1") === "BAM V2  ",
);

/** A 4x4 page of one flat colour, as the PVRZ bytes a resolver would hand back. */
function solidPage(r: number, g: number, b: number, a = 255, size = 4): Uint8Array {
    const rgba = new Uint8Array(size * size * 4);
    for (let i = 0; i < size * size; i++) rgba.set([r, g, b, a], i * 4);
    return encodePvrz({ width: size, height: size, format: "bc3", rgba });
}

/** One frame, one block copying the whole of page 7 into it. */
function oneBlockStructure(overrides: Partial<BamV2Structure["blocks"][number]> = {}): BamV2Structure {
    return {
        frames: [{ width: 4, height: 4, centerX: 2, centerY: 3, blockStart: 0, blockCount: 1 }],
        cycles: [{ frameStart: 0, frameCount: 1 }],
        blocks: [{ page: 7, sourceX: 0, sourceY: 0, width: 4, height: 4, targetX: 0, targetY: 0, ...overrides }],
        requiredPages: [7],
    };
}

function pixelAt(frame: { width: number; pixels: Uint8Array }, x: number, y: number): number[] {
    const o = (y * frame.width + x) * 4;
    return [...frame.pixels.subarray(o, o + 4)];
}

describe("pvrzResourceName", () => {
    it("zero-pads a page number to the four-digit MOS resource the block refers to", () => {
        expect(pvrzResourceName(7)).toBe("MOS0007.PVRZ");
        expect(pvrzResourceName(1010)).toBe("MOS1010.PVRZ");
    });
});

describe("decodeBamV2", () => {
    it("composes a frame from its data block", () => {
        // Channels chosen to be exact in RGB565 (multiples of 8, and of 4 for green), so the
        // assertion pins the composition rather than the block codec's rounding.
        const animation = decodeBamV2(oneBlockStructure(), () => solidPage(16, 20, 24));

        expect(animation.colorModel).toBe("rgba");
        expect(animation.meta.sourceFormat).toBe("bamv2");
        const frame = animation.frames[0];
        if (frame === undefined) throw new Error("expected one frame");
        expect(frame.pixels).toHaveLength(4 * 4 * 4);
        expect(pixelAt(frame, 0, 0)).toEqual([16, 20, 24, 255]);
        expect(frame.offsetX).toBe(2);
        expect(frame.offsetY).toBe(3);
    });

    it("leaves frame regions no block covers fully transparent", () => {
        // One 2x2 block landing at the origin of a 4x4 frame: the rest must stay transparent
        // rather than inheriting whatever the buffer happened to hold.
        const structure = oneBlockStructure({ width: 2, height: 2 });

        const animation = decodeBamV2(structure, () => solidPage(255, 0, 0));

        const frame = animation.frames[0];
        if (frame === undefined) throw new Error("expected one frame");
        expect(pixelAt(frame, 0, 0)).toEqual([255, 0, 0, 255]);
        expect(pixelAt(frame, 3, 3)).toEqual([0, 0, 0, 0]);
    });

    it("places a block at its target coordinate, not at the frame origin", () => {
        const structure = oneBlockStructure({ width: 2, height: 2, targetX: 2, targetY: 2 });

        const animation = decodeBamV2(structure, () => solidPage(0, 255, 0));

        const frame = animation.frames[0];
        if (frame === undefined) throw new Error("expected one frame");
        expect(pixelAt(frame, 0, 0)).toEqual([0, 0, 0, 0]);
        expect(pixelAt(frame, 2, 2)).toEqual([0, 255, 0, 255]);
    });

    it("turns each cycle into a sequence over its contiguous frame range", () => {
        const structure: BamV2Structure = {
            frames: Array.from({ length: 3 }, () => ({
                width: 4,
                height: 4,
                centerX: 0,
                centerY: 0,
                blockStart: 0,
                blockCount: 1,
            })),
            cycles: [
                { frameStart: 0, frameCount: 2 },
                { frameStart: 2, frameCount: 1 },
            ],
            blocks: [{ page: 7, sourceX: 0, sourceY: 0, width: 4, height: 4, targetX: 0, targetY: 0 }],
            requiredPages: [7],
        };

        const animation = decodeBamV2(structure, () => solidPage(1, 2, 3));

        expect(animation.sequences.map((s) => s.frameRefs)).toEqual([[0, 1], [2]]);
    });

    it("names the page and its resource when the resolver cannot supply one", () => {
        // A silently blank frame would be indistinguishable from a legitimately transparent one.
        expect(() => decodeBamV2(oneBlockStructure(), () => undefined)).toThrow(/page 7 .*MOS0007\.PVRZ|MOS0007\.PVRZ/);
    });

    it("rejects a frame whose declared size is implausible for a sprite", () => {
        // A crafted header claiming a huge frame would otherwise allocate before anything checks it.
        const structure = oneBlockStructure();
        structure.frames = [{ width: 40000, height: 40000, centerX: 0, centerY: 0, blockStart: 0, blockCount: 0 }];

        expect(() => decodeBamV2(structure, () => solidPage(0, 0, 0))).toThrow(/implausibly large/);
    });

    it("rejects a block naming a page the structure never listed as required", () => {
        // requiredPages drives which pages get resolved, so a block outside it would otherwise read
        // an undefined page. Reachable only for a hand-built structure, which is exactly this case.
        const structure = oneBlockStructure({ page: 99 });

        expect(() => decodeBamV2(structure, () => solidPage(0, 0, 0))).toThrow(/unlisted PVRZ page 99/);
    });

    it("rejects a block whose source rectangle runs outside its page", () => {
        const structure = oneBlockStructure({ sourceX: 3, width: 4 });

        expect(() => decodeBamV2(structure, () => solidPage(0, 0, 255))).toThrow(/outside page/);
    });
});

describe.skipIf(v2Files.length === 0)("decodeBamV2 (real corpus)", () => {
    it("decodes every corpus v2 BAM against its sibling PVRZ files", () => {
        for (const file of v2Files) {
            const structure = readBamV2Structure(new Uint8Array(fs.readFileSync(file)));
            const dir = path.dirname(file);
            const animation = decodeBamV2(structure, (page) => {
                const candidate = path.join(dir, pvrzResourceName(page));
                return fs.existsSync(candidate) ? new Uint8Array(fs.readFileSync(candidate)) : undefined;
            });

            expect(animation.frames, file).toHaveLength(structure.frames.length);
            for (const frame of animation.frames) {
                expect(frame.pixels.length, file).toBe(frame.width * frame.height * 4);
            }
            expect(animation.sequences, file).toHaveLength(structure.cycles.length);
        }
    });
});
