import { describe, expect, it } from "vitest";
import { emptyPalette } from "@bgforge/image";
import { crc32 } from "../src/png/crc.ts";
import { PNG_SIGNATURE, readChunks, writeChunk } from "../src/png/chunk.ts";
import { encodeIndexedPng } from "../src/png/encode.ts";

describe("png chunk primitives", () => {
    it("crc32 matches the known PNG IEND CRC", () => {
        // The IEND chunk's CRC over the type "IEND" with empty data is 0xAE426082.
        // `>>> 0` re-asserts the unsigned coercion crc32 already applies; Math.trunc is not equivalent.
        expect(crc32(new TextEncoder().encode("IEND")) >>> 0).toBe(0xae426082);
    });
    it("round-trips a chunk through write then read", () => {
        const data = new Uint8Array([1, 2, 3, 4]);
        const bytes = new Uint8Array([...PNG_SIGNATURE, ...writeChunk("IHDR", data)]);
        const chunks = readChunks(bytes);
        expect(chunks).toHaveLength(1);
        expect(chunks[0]?.type).toBe("IHDR");
        expect([...(chunks[0]?.data ?? [])]).toEqual([1, 2, 3, 4]);
    });
});

describe("readChunks error paths", () => {
    it("throws when the data is shorter than the PNG signature", () => {
        expect(() => readChunks(new Uint8Array([0x89, 0x50]))).toThrow(/shorter than the signature/);
    });

    it("throws on a bad signature", () => {
        const bytes = new Uint8Array(PNG_SIGNATURE.length).fill(0);
        expect(() => readChunks(bytes)).toThrow(/signature mismatch/);
    });

    it("throws on a truncated chunk header", () => {
        // Signature plus 4 bytes: not enough for a length+type header (needs 8).
        const bytes = new Uint8Array([...PNG_SIGNATURE, 0, 0, 0, 0]);
        expect(() => readChunks(bytes)).toThrow(/Truncated PNG chunk header/);
    });

    it("throws on truncated chunk data or CRC", () => {
        // Declares a 4-byte payload but only supplies the type, no data or CRC.
        const view = new DataView(new ArrayBuffer(4));
        view.setUint32(0, 4, false);
        const bytes = new Uint8Array([
            ...PNG_SIGNATURE,
            ...new Uint8Array(view.buffer),
            ...new TextEncoder().encode("IHDR"),
        ]);
        expect(() => readChunks(bytes)).toThrow(/Truncated PNG chunk data or CRC/);
    });

    it("throws on a CRC mismatch", () => {
        const pal = emptyPalette();
        const png = encodeIndexedPng(1, 1, new Uint8Array([0]), pal, 0);
        const corrupted = Uint8Array.from(png);
        // Signature(8) + length(4) + type(4) = 16: first byte of the IHDR chunk's data.
        const flipOffset = PNG_SIGNATURE.length + 8;
        const original = corrupted[flipOffset];
        if (original === undefined) throw new Error("test setup: offset out of range");
        corrupted[flipOffset] = original ^ 0xff;
        expect(() => readChunks(corrupted)).toThrow(/CRC mismatch/);
    });
});
