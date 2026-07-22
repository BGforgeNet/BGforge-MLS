import { describe, expect, it } from "vitest";
import { crc32, writeChunk, readChunks, PNG_SIGNATURE } from "@bgforge/image";

describe("png chunk primitives", () => {
    it("crc32 matches the known PNG IEND CRC", () => {
        // The IEND chunk's CRC over the type "IEND" with empty data is 0xAE426082.
        // `>>> 0` re-asserts the unsigned coercion crc32 already applies; Math.trunc is not equivalent.
        // eslint-disable-next-line unicorn/prefer-math-trunc
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
