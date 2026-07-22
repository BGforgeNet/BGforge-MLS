import zlib from "zlib";
import { type Rgba } from "../model/animation.ts";
import { PNG_SIGNATURE, writeChunk } from "./chunk.ts";

function buildIhdr(width: number, height: number): Uint8Array {
    const data = new Uint8Array(13);
    const view = new DataView(data.buffer);
    view.setUint32(0, width, false);
    view.setUint32(4, height, false);
    data[8] = 8; // bit depth
    data[9] = 3; // colour type: indexed
    data[10] = 0; // compression
    data[11] = 0; // filter
    data[12] = 0; // interlace
    return data;
}

function buildPlte(palette: Rgba[]): Uint8Array {
    const data = new Uint8Array(palette.length * 3);
    for (const [i, entry] of palette.entries()) {
        data[i * 3] = entry.r;
        data[i * 3 + 1] = entry.g;
        data[i * 3 + 2] = entry.b;
    }
    return data;
}

// Simplest correct form: opaque for every entry up to transparentIndex, with
// transparentIndex itself set fully transparent. Entries beyond it default opaque.
function buildTrns(transparentIndex: number): Uint8Array {
    const data = new Uint8Array(transparentIndex + 1).fill(255);
    data[transparentIndex] = 0;
    return data;
}

function buildIdat(width: number, height: number, pixels: Uint8Array): Uint8Array {
    const raw = new Uint8Array(height * (1 + width));
    for (let row = 0; row < height; row++) {
        const rowStart = row * (1 + width);
        raw[rowStart] = 0; // filter type: none
        const pixelRowStart = row * width;
        for (let col = 0; col < width; col++) {
            raw[rowStart + 1 + col] = pixels[pixelRowStart + col] ?? 0;
        }
    }
    return new Uint8Array(zlib.deflateSync(Buffer.from(raw)));
}

/** Hand-rolled colour-type-3 (indexed) PNG encoder: IHDR, PLTE, tRNS, one IDAT, IEND. */
export function encodeIndexedPng(
    width: number,
    height: number,
    pixels: Uint8Array,
    palette: Rgba[],
    transparentIndex: number,
): Uint8Array {
    const ihdr = writeChunk("IHDR", buildIhdr(width, height));
    const plte = writeChunk("PLTE", buildPlte(palette));
    const trns = writeChunk("tRNS", buildTrns(transparentIndex));
    const idat = writeChunk("IDAT", buildIdat(width, height, pixels));
    const iend = writeChunk("IEND", new Uint8Array(0));

    const out = new Uint8Array(
        PNG_SIGNATURE.length + ihdr.length + plte.length + trns.length + idat.length + iend.length,
    );
    let offset = 0;
    for (const part of [PNG_SIGNATURE, ihdr, plte, trns, idat, iend]) {
        out.set(part, offset);
        offset += part.length;
    }
    return out;
}
