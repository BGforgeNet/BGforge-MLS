import { describe, expect, it } from "vitest";
import fs from "fs";
import path from "path";
import { decodeBamV2, pvrzResourceName } from "../src/bam/v2-parse.ts";
import { readBamV2Structure } from "../src/bam/v2-structure.ts";
import { serializeBamV2 } from "../src/bam/v2-serialize.ts";
import { decodePvrz } from "../src/pvrz/container.ts";
import { corpusFiles, IE_CORPUS } from "./fixtures.ts";

const v2Files = corpusFiles(IE_CORPUS, ".bam").filter(
    (f) => fs.readFileSync(f).subarray(0, 8).toString("latin1") === "BAM V2  ",
);

function readWithPages(file: string, keepSourceBytes = true): ReturnType<typeof decodeBamV2> {
    const dir = path.dirname(file);
    const bytes = new Uint8Array(fs.readFileSync(file));
    return decodeBamV2(
        readBamV2Structure(bytes),
        (page) => {
            const candidate = path.join(dir, pvrzResourceName(page));
            return fs.existsSync(candidate) ? new Uint8Array(fs.readFileSync(candidate)) : undefined;
        },
        keepSourceBytes ? bytes : undefined,
    );
}

describe.skipIf(v2Files.length === 0)("serializeBamV2 (verbatim preservation)", () => {
    it("re-emits an unmodified animation byte-identically and rewrites no pages", () => {
        // The contract the whole write path rests on. Block compression is lossy, so re-encoding an
        // untouched file would degrade it a little on every save, cumulatively. Asserting the .bam
        // bytes alone is not enough: that would pass even if every page were silently recompressed,
        // so the zero-page assertion is the one that actually pins it.
        for (const file of v2Files) {
            const original = new Uint8Array(fs.readFileSync(file));

            const saved = serializeBamV2(readWithPages(file));

            expect(saved.pages, `${file} rewrote pages`).toEqual([]);
            expect(saved.bam, `${file} bytes differ`).toEqual(original);
        }
    });

    it("hands back the untouched pages verbatim when the caller says it is writing them too", () => {
        // What a Save As needs: the .bam names its pages by number, and the folder it is being
        // written to has no MOSxxxx.PVRZ of its own, so the pages travel with it. Verbatim, not
        // re-encoded - the whole point of retaining the source bytes.
        for (const file of v2Files) {
            const dir = path.dirname(file);

            const saved = serializeBamV2(readWithPages(file), { emitUnchangedPages: true });

            expect(saved.pages.length, `${file} emitted no pages`).toBeGreaterThan(0);
            for (const page of saved.pages) {
                const original = new Uint8Array(fs.readFileSync(path.join(dir, pvrzResourceName(page.page))));
                expect(page.bytes, `${file} page ${page.page} was re-encoded`).toEqual(original);
            }
        }
    });

    it("rebuilds an equivalent file from the block table when the source bytes are not held", () => {
        // Without sourceBytes the tables are rebuilt rather than copied. That still rewrites no
        // pages - the contract that matters - but it is not byte-identical: a cycle with zero
        // frames carries a start index in the file that the model does not keep, since a cycle
        // referencing no frames has no meaningful start. Data-faithful, not byte-faithful.
        for (const file of v2Files) {
            const animation = readWithPages(file, false);

            const saved = serializeBamV2(animation);

            expect(saved.pages, file).toEqual([]);
            const reparsed = readBamV2Structure(saved.bam);
            expect(reparsed.frames.length, file).toBe(animation.frames.length);
            expect(reparsed.cycles.length, file).toBe(animation.sequences.length);
            expect(
                reparsed.cycles.map((c) => c.frameCount),
                file,
            ).toEqual(animation.sequences.map((s) => s.frameRefs.length));
            expect(reparsed.requiredPages, file).toEqual(
                readBamV2Structure(new Uint8Array(fs.readFileSync(file))).requiredPages,
            );
        }
    });
});

describe("serializeBamV2 (repacking)", () => {
    /** An animation with no provenance, as an upward conversion or an edit would produce. */
    function synthesized(): Parameters<typeof serializeBamV2>[0] {
        const pixels = new Uint8Array(4 * 4 * 4);
        for (let i = 0; i < 16; i++) pixels.set([255, 0, 0, 255], i * 4);
        return {
            colorModel: "rgba",
            frames: [{ width: 4, height: 4, pixels, offsetX: 2, offsetY: 2 }],
            sequences: [{ frameRefs: [0], facing: "none" }],
            meta: { sourceFormat: "bamv2", fps: 15 },
        };
    }

    it("packs frames into a fresh page at the base page number it is given", () => {
        const saved = serializeBamV2(synthesized(), { basePage: 4200 });

        expect(saved.pages.map((p) => p.page)).toEqual([4200]);
        const structure = readBamV2Structure(saved.bam);
        expect(structure.requiredPages).toEqual([4200]);
        expect(structure.frames).toHaveLength(1);
    });

    it("refuses to invent a page number when it has no provenance and none was given", () => {
        // Guessing risks colliding with a page inside a BIF, which surfaces only as corrupted
        // graphics at runtime - so the caller must say, and the library never picks.
        expect(() => serializeBamV2(synthesized())).toThrow(/basePage/);
    });

    it("round-trips the pixels it packed", () => {
        const saved = serializeBamV2(synthesized(), { basePage: 4200 });
        const page = saved.pages[0];
        if (page === undefined) throw new Error("expected one page");

        const structure = readBamV2Structure(saved.bam);
        const decoded = decodeBamV2(structure, () => page.bytes);

        const frame = decoded.frames[0];
        if (frame === undefined) throw new Error("expected one frame");
        expect([...frame.pixels.subarray(0, 4)]).toEqual([255, 0, 0, 255]);
        expect(frame.offsetX).toBe(2);
        expect(frame.offsetY).toBe(2);
    });

    it("keeps the page it wrote decodable on its own", () => {
        const saved = serializeBamV2(synthesized(), { basePage: 4200 });
        const page = saved.pages[0];
        if (page === undefined) throw new Error("expected one page");

        expect(decodePvrz(page.bytes).format).toBe("bc3");
    });
});
