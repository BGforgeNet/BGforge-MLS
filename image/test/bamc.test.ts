import { describe, expect, it } from "vitest";
import fs from "fs";
import { isBamc, decodeBamc, encodeBamc, parseBamV1 } from "@bgforge/image";
import { corpusFiles, IE_CORPUS } from "./fixtures.ts";

const all = corpusFiles(IE_CORPUS, ".bam");
const bamcs = all.filter((f) => fs.readFileSync(f).subarray(0, 4).toString("latin1") === "BAMC");

describe("BAMC", () => {
    it("round-trips inner BAM data through encode/decode", () => {
        const inner = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);
        expect(Buffer.from(decodeBamc(encodeBamc(inner))).equals(Buffer.from(inner))).toBe(true);
    });
});

describe("decodeBamc hostile input", () => {
    it("isBamc is false for short or non-BAMC input", () => {
        expect(isBamc(new Uint8Array(0))).toBe(false);
        expect(isBamc(new TextEncoder().encode("BA"))).toBe(false);
        expect(isBamc(new TextEncoder().encode("BAMX"))).toBe(false);
    });

    it("rejects a truncated header", () => {
        expect(() => decodeBamc(new Uint8Array(8))).toThrow(/header truncated/);
    });

    it("rejects an unsupported BAMC version", () => {
        const bytes = encodeBamc(new Uint8Array([1, 2, 3]));
        bytes.set(new TextEncoder().encode("V2  "), 0x04);
        expect(() => decodeBamc(bytes)).toThrow(/unsupported BAMC version "V2"/);
    });

    it("rejects an implausibly large declared uncompressed size before inflating", () => {
        const bytes = encodeBamc(new Uint8Array([1, 2, 3]));
        new DataView(bytes.buffer).setUint32(0x08, 0xffffffff, true);
        expect(() => decodeBamc(bytes)).toThrow(/exceeds/);
    });

    it("surfaces a corrupt zlib stream as a clear decompression error", () => {
        const bytes = encodeBamc(new Uint8Array([1, 2, 3]));
        bytes.fill(0xff, 12);
        expect(() => decodeBamc(bytes)).toThrow(/decompression failed/);
    });

    it("stops inflating once the output exceeds the declared size (zlib-bomb guard)", () => {
        const bytes = encodeBamc(new Uint8Array(1000));
        new DataView(bytes.buffer).setUint32(0x08, 10, true); // claims 10 bytes, stream holds 1000
        expect(() => decodeBamc(bytes)).toThrow(/decompression failed/);
    });
});

describe.skipIf(bamcs.length === 0)("BAMC corpus", () => {
    it("detects and decodes real BAMC files to parseable BAM v1", () => {
        const first = bamcs[0];
        if (!first) throw new Error("expected at least one corpus fixture");
        const bytes = new Uint8Array(fs.readFileSync(first));
        expect(isBamc(bytes)).toBe(true);
        const inner = decodeBamc(bytes);
        expect(String.fromCodePoint(inner[0] ?? 0, inner[1] ?? 0, inner[2] ?? 0, inner[3] ?? 0)).toBe("BAM ");
        const anim = parseBamV1(inner);
        expect(anim.frames.length).toBeGreaterThan(0);
    });
});
