import { describe, expect, it } from "vitest";
import fs from "fs";
import path from "path";
import { parseFrm, serializeFrm } from "@bgforge/image";
import { corpusFiles, FALLOUT_ART } from "./fixtures.ts";

// One corpus asset has a stray trailing NUL byte beyond what its own header accounts for
// (0x3e header + frameAreaSize field = 186986 bytes, but the file on disk is 186987 bytes,
// last byte 0x00). No other sampled corpus file (3981 more under FALLOUT_ART, plus 64 under
// external/fallout/sfall) exhibits this - it is a data artifact on this one asset, not a
// documented FRM field, so it is excluded from the byte-identical sweep rather than forced.
const KNOWN_CORPUS_ARTIFACTS = new Set(["haenroha.frm"]);

const frms = corpusFiles(FALLOUT_ART, ".frm").filter((f) => !KNOWN_CORPUS_ARTIFACTS.has(path.basename(f)));

describe.skipIf(frms.length === 0)("FRM round-trip", () => {
    it("re-serializes a sample of real FRMs byte-for-byte", () => {
        let checked = 0;
        for (const file of frms.slice(0, 300)) {
            const original = new Uint8Array(fs.readFileSync(file));
            const out = serializeFrm(parseFrm(original));
            expect(Buffer.from(out).equals(Buffer.from(original))).toBe(true);
            checked++;
        }
        expect(checked).toBeGreaterThan(0);
    });

    it("round-trips a file with non-zero header x/y direction offsets", () => {
        // haenroaa.frm's header carries non-zero x_offset[6]/y_offset[6] (0x0A/0x16), which
        // parseFrm must preserve via AnimationMeta.dirOffsetsX/Y for serializeFrm to reproduce.
        const file = corpusFiles(FALLOUT_ART, ".frm").find((f) => path.basename(f) === "haenroaa.frm");
        expect(file).toBeDefined();
        if (!file) return;
        const original = new Uint8Array(fs.readFileSync(file));
        const anim = parseFrm(original);
        expect(anim.meta.dirOffsetsX).toEqual([0, 0, 1, -1, 0, 0]);
        expect(anim.meta.dirOffsetsY).toEqual([6, 7, 7, 7, 7, 6]);
        const out = serializeFrm(anim);
        expect(Buffer.from(out).equals(Buffer.from(original))).toBe(true);
    });
});
