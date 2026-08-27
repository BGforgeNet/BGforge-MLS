import { describe, expect, it } from "vitest";
import fs from "fs";
import path from "path";
import { readBamV2Structure } from "../src/bam/v2-structure.ts";
import { corpusFiles, IE_CORPUS } from "./fixtures.ts";

const v2Files = corpusFiles(IE_CORPUS, ".bam").filter(
    (f) => fs.readFileSync(f).subarray(0, 8).toString("latin1") === "BAM V2  ",
);

function byName(name: string): string | undefined {
    return v2Files.find((f) => path.basename(f).toUpperCase() === name);
}

/** A v2 header with the six counts/offsets, followed by whatever tables the caller appends. */
function v2Header(counts: {
    frames: number;
    cycles: number;
    blocks: number;
    frameOffset: number;
    cycleOffset: number;
    blockOffset: number;
}): Uint8Array {
    const header = new Uint8Array(0x20);
    header.set(new TextEncoder().encode("BAM V2  "), 0);
    const view = new DataView(header.buffer);
    view.setUint32(0x08, counts.frames, true);
    view.setUint32(0x0c, counts.cycles, true);
    view.setUint32(0x10, counts.blocks, true);
    view.setUint32(0x14, counts.frameOffset, true);
    view.setUint32(0x18, counts.cycleOffset, true);
    view.setUint32(0x1c, counts.blockOffset, true);
    return header;
}

describe("readBamV2Structure", () => {
    it("rejects a file whose header is truncated", () => {
        expect(() => readBamV2Structure(new Uint8Array(16))).toThrow(/header truncated/);
    });

    it("rejects a file that is not BAM V2", () => {
        const bytes = new Uint8Array(0x20);
        bytes.set(new TextEncoder().encode("BAM V1  "), 0);

        expect(() => readBamV2Structure(bytes)).toThrow(/not a BAM V2 file/);
    });

    it("rejects a frame entry table that runs past end of file", () => {
        const bytes = v2Header({
            frames: 100,
            cycles: 0,
            blocks: 0,
            frameOffset: 0x20,
            cycleOffset: 0x20,
            blockOffset: 0x20,
        });

        expect(() => readBamV2Structure(bytes)).toThrow(/frame entry table out of range/);
    });

    it("rejects a cycle entry table that runs past end of file", () => {
        const bytes = v2Header({
            frames: 0,
            cycles: 200,
            blocks: 0,
            frameOffset: 0x20,
            cycleOffset: 0x20,
            blockOffset: 0x20,
        });

        expect(() => readBamV2Structure(bytes)).toThrow(/cycle entry table out of range/);
    });

    it("rejects a data block table that runs past end of file", () => {
        const bytes = v2Header({
            frames: 0,
            cycles: 0,
            blocks: 50,
            frameOffset: 0x20,
            cycleOffset: 0x20,
            blockOffset: 0x20,
        });

        expect(() => readBamV2Structure(bytes)).toThrow(/data block table out of range/);
    });
});

describe.skipIf(v2Files.length === 0)("readBamV2Structure (real corpus)", () => {
    // Counts read off the shipped files themselves; they pin that the header layout is being
    // walked correctly, since a transposed offset yields wildly different numbers rather than none.
    const expected = [
        { name: "MAPICONS.BAM", frames: 5888, cycles: 183, blocks: 5888, pages: [1000, 1010] },
        { name: "TITLE.BAM", frames: 11, cycles: 1, blocks: 11, pages: [4000, 4001] },
        { name: "BIGLOGO.BAM", frames: 11, cycles: 1, blocks: 11, pages: [3000, 3002] },
        { name: "CMPGEET.BAM", frames: 11, cycles: 11, blocks: 11, pages: [5000, 5000] },
    ];

    for (const { name, frames, cycles, blocks, pages } of expected) {
        const file = byName(name);
        it.skipIf(file === undefined)(`reads ${name}'s entry tables and required pages`, () => {
            if (file === undefined) throw new Error("guarded by skipIf");
            const structure = readBamV2Structure(new Uint8Array(fs.readFileSync(file)));

            expect(structure.frames).toHaveLength(frames);
            expect(structure.cycles).toHaveLength(cycles);
            expect(structure.blocks).toHaveLength(blocks);
            expect(structure.requiredPages.at(0)).toBe(pages[0]);
            expect(structure.requiredPages.at(-1)).toBe(pages[1]);
        });
    }

    it("keeps every cycle's frame range and every block's page inside the tables it indexes", () => {
        for (const file of v2Files) {
            const structure = readBamV2Structure(new Uint8Array(fs.readFileSync(file)));
            for (const cycle of structure.cycles) {
                expect(cycle.frameStart + cycle.frameCount, file).toBeLessThanOrEqual(structure.frames.length);
            }
            for (const frame of structure.frames) {
                expect(frame.blockStart + frame.blockCount, file).toBeLessThanOrEqual(structure.blocks.length);
            }
            expect(structure.requiredPages, file).toEqual([...new Set(structure.requiredPages)].sort((a, b) => a - b));
        }
    });
});
