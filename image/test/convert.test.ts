import { describe, expect, it } from "vitest";
import fs from "fs";
import path from "path";
import { convert, parseFrm, serializeFrm, parseBamV1, serializeBamV1, type Frame } from "@bgforge/image";
import { corpusFiles, FALLOUT_ART } from "./fixtures.ts";

// Frame content trimmed to its non-transparent bounding box (index 0), as a shape-tagged hex string.
// The BAM->FRM leg re-composes each rotation onto a uniform anchor-aligned canvas, so raw frame bytes
// gain transparent padding; the trimmed content is what a round-trip must preserve.
function trimmedHex(f: Frame): string {
    let minX = f.width;
    let minY = f.height;
    let maxX = -1;
    let maxY = -1;
    for (let y = 0; y < f.height; y++) {
        for (let x = 0; x < f.width; x++) {
            if ((f.pixels[y * f.width + x] ?? 0) === 0) continue;
            minX = Math.min(minX, x);
            minY = Math.min(minY, y);
            maxX = Math.max(maxX, x);
            maxY = Math.max(maxY, y);
        }
    }
    if (maxX < 0) return "";
    const out: number[] = [];
    for (let y = minY; y <= maxY; y++) {
        for (let x = minX; x <= maxX; x++) out.push(f.pixels[y * f.width + x] ?? 0);
    }
    return `${maxX - minX + 1}w:${Buffer.from(out).toString("hex")}`;
}

const frms = corpusFiles(FALLOUT_ART, ".frm");
const hanpwroeFrm = frms.find((f) => path.basename(f) === "hanpwroe.frm");

describe.skipIf(frms.length === 0)("convert", () => {
    it("round-trips a real FRM's pixel data through convert(->bam) and convert(->frm)", () => {
        const file = hanpwroeFrm;
        if (!file) throw new Error("expected hanpwroe.frm in the FRM corpus");
        const source = parseFrm(new Uint8Array(fs.readFileSync(file)));

        // parseFrm's placeholder palette is all-black, so convertToFrm's remap step would collapse every
        // non-transparent index onto one output index. Pinning one used index to a color absent from
        // DEFAULT_FALLOUT_PALETTE (see convert-to-frm.test.ts's sidecar fixture) forces the sidecar path instead,
        // which preserves indices verbatim.
        const usedIndices = new Set<number>();
        for (const f of source.frames) for (const v of f.pixels) usedIndices.add(v);
        const nonTransparentUsed = [...usedIndices].find((v) => v !== 0);
        if (nonTransparentUsed === undefined) throw new Error("expected a non-transparent pixel index");
        source.palette[nonTransparentUsed] = { r: 1, g: 2, b: 3, a: 255 };

        const origHexSet = new Set(source.frames.map(trimmedHex));

        const { animation: bamAnim, report: toBamReport } = convert(source, "bam");
        expect(bamAnim.meta.sourceFormat).toBe("bam");
        // fps/action-frame drops are deliberately unreported (BAM has no field for either).
        expect(toBamReport.lossless).toBe(true);
        expect(toBamReport.has("embedded-palette")).toBe(true);

        const bamReparsed = parseBamV1(serializeBamV1(bamAnim));

        const { animation: frmAnim2, report: toFrmReport } = convert(bamReparsed, "frm");
        expect(frmAnim2.meta.sourceFormat).toBe("frm");
        expect(toFrmReport.has("palette-sidecar-required")).toBe(true);
        expect(toFrmReport.has("duplicated-shared-frames")).toBe(false);
        expect(toFrmReport.has("padded-sequence")).toBe(false);

        const frmReparsed2 = parseFrm(serializeFrm(frmAnim2));
        const finalHexSet = new Set(frmReparsed2.frames.map(trimmedHex));

        expect(finalHexSet).toEqual(origHexSet);
    });
});
