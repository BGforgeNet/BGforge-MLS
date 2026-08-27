import { describe, expect, it } from "vitest";
import fs from "fs";
import zlib from "zlib";
import { decodePvrz, encodePvrz } from "../src/pvrz/container.ts";
import { corpusFiles, IE_CORPUS } from "./fixtures.ts";

const pvrzFiles = corpusFiles(IE_CORPUS, ".pvrz");

/** A PVRZ wrapping an arbitrary PVR v3 payload: u32 LE inflated length, then the zlib stream. */
function wrap(payload: Uint8Array): Uint8Array {
    const compressed = zlib.deflateSync(Buffer.from(payload));
    const out = new Uint8Array(4 + compressed.length);
    new DataView(out.buffer).setUint32(0, payload.length, true);
    out.set(compressed, 4);
    return out;
}

/** A minimal PVR v3 header: 52 bytes, magic 0x03525650, pixel format in the low dword at 0x08. */
function pvrHeader(pixelFormat: number, width: number, height: number): Uint8Array {
    const header = new Uint8Array(52);
    const view = new DataView(header.buffer);
    view.setUint32(0x00, 0x03525650, true);
    view.setUint32(0x08, pixelFormat, true);
    view.setUint32(0x18, height, true);
    view.setUint32(0x1c, width, true);
    view.setUint32(0x20, 1, true); // depth
    view.setUint32(0x24, 1, true); // surfaces
    view.setUint32(0x28, 1, true); // faces
    view.setUint32(0x2c, 1, true); // mip levels
    return header;
}

describe("decodePvrz", () => {
    it("decodes a BC3 texture to RGBA sized by the header dimensions", () => {
        // 4x4 BC3 is exactly one 16-byte block.
        const bytes = wrap(new Uint8Array([...pvrHeader(11, 4, 4), ...new Uint8Array(16)]));

        const texture = decodePvrz(bytes);

        expect(texture.width).toBe(4);
        expect(texture.height).toBe(4);
        expect(texture.format).toBe("bc3");
        expect(texture.rgba).toHaveLength(4 * 4 * 4);
    });

    it("decodes a BC1 texture, whose blocks are half the size", () => {
        const bytes = wrap(new Uint8Array([...pvrHeader(7, 4, 4), ...new Uint8Array(8)]));

        const texture = decodePvrz(bytes);

        expect(texture.format).toBe("bc1");
        expect(texture.rgba).toHaveLength(4 * 4 * 4);
    });

    it("rejects a payload whose PVR magic is wrong", () => {
        const header = pvrHeader(11, 4, 4);
        new DataView(header.buffer).setUint32(0x00, 0xdeadbeef, true);

        expect(() => decodePvrz(wrap(new Uint8Array([...header, ...new Uint8Array(16)])))).toThrow(
            /not a PVR v3 texture/,
        );
    });

    it("rejects a pixel format that is neither BC1 nor BC3", () => {
        // 6 is ETC1 - a mobile-only format the desktop games never ship.
        expect(() => decodePvrz(wrap(new Uint8Array([...pvrHeader(6, 4, 4), ...new Uint8Array(16)])))).toThrow(
            /unsupported PVR pixel format 6/,
        );
    });

    it("rejects a declared inflated length beyond the cap instead of inflating it", () => {
        const bytes = wrap(new Uint8Array([...pvrHeader(11, 4, 4), ...new Uint8Array(16)]));
        new DataView(bytes.buffer).setUint32(0, (1 << 28) + 1, true);

        expect(() => decodePvrz(bytes)).toThrow(/exceeds the .* cap/);
    });

    it("rejects a file too short to hold the length prefix", () => {
        expect(() => decodePvrz(new Uint8Array([1, 2]))).toThrow(/truncated/);
    });

    it("names decompression as the failure when the zlib stream is corrupt", () => {
        // A raw zlib error names neither the file nor the stage, so a caller seeing it in a log
        // cannot tell a corrupt PVRZ from a bug in the caller's own byte slicing.
        const bytes = wrap(new Uint8Array([...pvrHeader(11, 4, 4), ...new Uint8Array(16)]));
        bytes[8] = (bytes[8] ?? 0) ^ 0xff;

        expect(() => decodePvrz(bytes)).toThrow(/decodePvrz: decompression failed/);
    });

    it("reports the block data being short of what the dimensions require", () => {
        // 8x8 BC3 needs four blocks (64 bytes); supply one.
        expect(() => decodePvrz(wrap(new Uint8Array([...pvrHeader(11, 8, 8), ...new Uint8Array(16)])))).toThrow(
            /texture data truncated/,
        );
    });
});

describe.skipIf(pvrzFiles.length === 0)("decodePvrz (real corpus)", () => {
    it("decodes every corpus PVRZ to RGBA matching its own header dimensions", () => {
        let bc1 = 0;
        let bc3 = 0;
        for (const file of pvrzFiles) {
            const texture = decodePvrz(new Uint8Array(fs.readFileSync(file)));
            expect(texture.rgba, file).toHaveLength(texture.width * texture.height * 4);
            if (texture.format === "bc1") bc1++;
            else bc3++;
        }
        // Both codec halves must actually be exercised by the corpus, not just one of them.
        expect(bc1).toBeGreaterThan(0);
        expect(bc3).toBeGreaterThan(0);
    });
});

describe("encodePvrz", () => {
    it("produces a container decodePvrz reads back with the same dimensions and format", () => {
        const rgba = new Uint8Array(8 * 8 * 4).fill(0);
        for (let i = 0; i < 64; i++) rgba.set([255, 0, 0, 255], i * 4);

        const roundTripped = decodePvrz(encodePvrz({ width: 8, height: 8, rgba }));

        expect(roundTripped.width).toBe(8);
        expect(roundTripped.height).toBe(8);
        expect(roundTripped.format).toBe("bc3");
        expect(roundTripped.rgba).toEqual(rgba);
    });

    it("writes a length prefix matching the inflated payload", () => {
        const rgba = new Uint8Array(4 * 4 * 4).fill(255);

        const bytes = encodePvrz({ width: 4, height: 4, rgba });

        const declared = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(0, true);
        expect(zlib.inflateSync(Buffer.from(bytes.subarray(4)))).toHaveLength(declared);
    });

    it("writes BC3 even for a fully opaque texture, since only a repack ever encodes", () => {
        // Encoding is not a re-encode of some page that arrived: the only writer is the repack, which
        // composes one fresh canvas out of frames from several source pages, so there is no arrival
        // format to keep. BC1 decoding stays covered by the corpus sweep above, which asserts both
        // halves of the codec are exercised by real files.
        const rgba = new Uint8Array(4 * 4 * 4).fill(200);

        expect(decodePvrz(encodePvrz({ width: 4, height: 4, rgba })).format).toBe("bc3");
    });
});
