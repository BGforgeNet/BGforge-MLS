/**
 * Real images, built through `@bgforge/image`'s own writers rather than typed by hand.
 *
 * The decodes under test read what a game ships, so a hand-built header would only pin assumptions about the
 * format. Shared by the thumbnail tests and the gallery worker tests, which need the same inputs.
 */
import { expect } from "vitest";
import {
    decodeIndexedPng,
    decodeTruecolourPng,
    serializeBamV1,
    serializeBamV2,
    serializeFrm,
    type IndexedAnimation,
    type Rgba,
    type RgbaAnimation,
} from "@bgforge/image";

function greyPalette(): Rgba[] {
    return Array.from({ length: 256 }, () => ({ r: 0, g: 0, b: 0, a: 255 }));
}

/** A single-cycle BAM v1 of `frames` identical square frames. */
export function bam(edge: number, frames = 1): Uint8Array {
    const palette = greyPalette();
    palette[1] = { r: 255, g: 0, b: 255, a: 255 };
    const animation: IndexedAnimation = {
        palette,
        frames: Array.from({ length: frames }, () => ({
            width: edge,
            height: edge,
            pixels: new Uint8Array(edge * edge).fill(1),
            offsetX: 0,
            offsetY: 0,
        })),
        sequences: [{ frameRefs: [0], facing: "none" }],
        meta: { sourceFormat: "bam", transparentIndex: 0 },
    };
    return serializeBamV1(animation);
}

/** A BAM of `count` cycles, cycle i opening on a frame filled with palette index i+1 - so a composed tile's
 *  quadrants can be told apart by the index they carry. */
export function multiCycle(edge: number, count: number): Uint8Array {
    const palette = greyPalette();
    for (let i = 1; i <= count; i++) palette[i] = { r: i * 50, g: 255 - i * 50, b: i * 20, a: 255 };
    const animation: IndexedAnimation = {
        palette,
        frames: Array.from({ length: count }, (_, i) => ({
            width: edge,
            height: edge,
            pixels: new Uint8Array(edge * edge).fill(i + 1),
            offsetX: 0,
            offsetY: 0,
        })),
        sequences: Array.from({ length: count }, (_, i) => ({ frameRefs: [i], facing: "none" as const })),
        meta: { sourceFormat: "bam", transparentIndex: 0 },
    };
    return serializeBamV1(animation);
}

/** A 2x2 BAM of four distinct palette indices, for asserting which sample a downscale keeps. */
export function fourColour2x2(): Uint8Array {
    const palette = greyPalette();
    for (const i of [1, 2, 3, 4]) palette[i] = { r: i * 40, g: 255 - i * 40, b: i * 10, a: 255 };
    const animation: IndexedAnimation = {
        palette,
        frames: [{ width: 2, height: 2, pixels: Uint8Array.from([1, 2, 3, 4]), offsetX: 0, offsetY: 0 }],
        sequences: [{ frameRefs: [0], facing: "none" }],
        meta: { sourceFormat: "bam", transparentIndex: 0 },
    };
    return serializeBamV1(animation);
}

/** A BAM v2 plus the PVRZ pages it names, both produced by the library's own writer. */
export function bamV2WithPages(basePage: number): { bam: Uint8Array; pages: Map<number, Uint8Array> } {
    const pixels = new Uint8Array(8 * 8 * 4);
    for (let i = 0; i < 8 * 8; i++) pixels.set([(i * 4) % 256, 255 - ((i * 4) % 256), 128, 255], i * 4);
    const animation: RgbaAnimation = {
        colorModel: "rgba",
        frames: [{ width: 8, height: 8, pixels, offsetX: 0, offsetY: 0 }],
        sequences: [{ frameRefs: [0], facing: "none" }],
        meta: { sourceFormat: "bamv2" },
    };
    const saved = serializeBamV2(animation, { basePage });
    return { bam: saved.bam, pages: new Map(saved.pages.map((p) => [p.page, p.bytes])) };
}

/** An FRM, which carries no palette of its own - the case a black `emptyPalette()` would silently pass. */
export function frmBytes(): Uint8Array {
    const animation: IndexedAnimation = {
        palette: greyPalette(),
        frames: Array.from({ length: 6 }, () => ({
            width: 8,
            height: 8,
            pixels: Uint8Array.from({ length: 64 }, (_, i) => (i % 7) + 1),
            offsetX: 0,
            offsetY: 0,
        })),
        sequences: Array.from({ length: 6 }, (_, i) => ({ frameRefs: [i], facing: "none" as const })),
        meta: { sourceFormat: "frm", transparentIndex: 0 },
    };
    return serializeFrm(animation);
}

/**
 * A 24-bit uncompressed BMP of one solid colour - the shape a game's portraits and screenshots take, and the
 * one whose full-size bytes used to reach the webview unchanged.
 */
export function bmpBytes(width: number, height: number, rgb: [number, number, number] = [255, 0, 0]): Uint8Array {
    const stride = Math.ceil((width * 3) / 4) * 4;
    const pixelOffset = 14 + 40;
    const out = new Uint8Array(pixelOffset + stride * height);
    const view = new DataView(out.buffer);
    out[0] = 0x42;
    out[1] = 0x4d;
    view.setUint32(2, out.length, true);
    view.setUint32(10, pixelOffset, true);
    view.setUint32(14, 40, true);
    view.setInt32(18, width, true);
    view.setInt32(22, height, true);
    view.setUint16(26, 1, true);
    view.setUint16(28, 24, true);
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            out.set([rgb[2], rgb[1], rgb[0]], pixelOffset + y * stride + x * 3);
        }
    }
    return out;
}

/** Pad a serialized image out to a byte length. The zeros sit past every offset the header declares, so the
 *  file still parses - which is the point: this grows the SOURCE size without changing the picture. */
export function padded(bytes: Uint8Array, toBytes: number): Uint8Array {
    const out = new Uint8Array(toBytes);
    out.set(bytes);
    return out;
}

function pngBytes(dataUri: string): Uint8Array {
    return Uint8Array.from(Buffer.from(dataUri.slice(dataUri.indexOf(",") + 1), "base64"));
}

/** The decoded PNG's declared dimensions, read out of IHDR - the only part of a data URI that proves an image
 *  was actually produced rather than a plausible-looking string. */
export function pngSize(dataUri: string): { width: number; height: number } {
    const bytes = pngBytes(dataUri);
    expect(bytes.slice(0, 8)).toEqual(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    const view = new DataView(bytes.buffer, bytes.byteOffset);
    // IHDR is always the first chunk: 8-byte signature, 4-byte length, 4-byte type, then width and height.
    return { width: view.getUint32(16, false), height: view.getUint32(20, false) };
}

/** The palette index at one pixel of a decoded indexed PNG. */
export function indexAt(dataUri: string, x: number, y: number): number {
    const png = decodeIndexedPng(pngBytes(dataUri));
    return png.pixels[y * png.width + x]!;
}

/** The palette index of a 1x1 result - the property a blend cannot preserve, where size alone cannot tell a
 *  nearest-neighbour pick from an average. */
export function soleIndexOf(dataUri: string): number {
    return decodeIndexedPng(pngBytes(dataUri)).pixels[0]!;
}

/** How many distinct colours a rendered tile actually contains. One means it came out flat. */
export function distinctColoursOf(dataUri: string): Set<string> {
    const bytes = pngBytes(dataUri);
    const out = new Set<string>();
    try {
        const png = decodeIndexedPng(bytes);
        for (const index of png.pixels) {
            const c = png.palette[index]!;
            out.add(`${c.r},${c.g},${c.b},${c.a}`);
        }
    } catch {
        const png = decodeTruecolourPng(bytes);
        for (let i = 0; i < png.pixels.length; i += 4) out.add(png.pixels.slice(i, i + 4).join(","));
    }
    return out;
}
