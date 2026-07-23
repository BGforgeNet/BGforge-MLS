import { describe, expect, it } from "vitest";
import zlib from "zlib";
import { emptyPalette } from "@bgforge/image";
import { readChunks } from "../src/png/chunk.ts";
import { encodeIndexedPng } from "../src/png/encode.ts";

describe("encodeIndexedPng", () => {
    it("writes a valid colour-type-3 PNG whose IDAT unfilters to the pixels", () => {
        const pal = emptyPalette();
        pal[1] = { r: 10, g: 20, b: 30, a: 255 };
        const pixels = new Uint8Array([0, 1, 1, 0]); // 2x2
        const png = encodeIndexedPng(2, 2, pixels, pal, 0);
        const chunks = readChunks(png);
        const ihdr = chunks.find((c) => c.type === "IHDR");
        if (!ihdr) throw new Error("no IHDR");
        expect(ihdr.data[8]).toBe(8); // bit depth
        expect(ihdr.data[9]).toBe(3); // colour type 3 = indexed
        const idat = chunks.find((c) => c.type === "IDAT");
        if (!idat) throw new Error("no IDAT");
        const raw = new Uint8Array(zlib.inflateSync(Buffer.from(idat.data)));
        // Two rows, each: filter byte 0 then two index bytes.
        expect([...raw]).toEqual([0, 0, 1, 0, 1, 0]);
        expect(chunks.some((c) => c.type === "PLTE")).toBe(true);
        expect(chunks.some((c) => c.type === "tRNS")).toBe(true);
    });
});
