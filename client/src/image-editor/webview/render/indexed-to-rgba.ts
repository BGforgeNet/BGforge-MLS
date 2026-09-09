import type { Rgba } from "@bgforge/image";

export type Background = "transparent" | "checkered" | "green";

// The classic transparent-green used by Infinity Engine BAM editors, offered as a background choice.
export const GREEN = "#00ff00";

// Opaque, because the packer below now reads this entry's own alpha: a short palette's missing indices
// must stay opaque black rather than becoming invisible.
const BLACK: Rgba = { r: 0, g: 0, b: 0, a: 255 };

/**
 * One palette flattened into 256 pre-packed RGBA words, alpha already resolved for the transparent index.
 *
 * The unit the pixel loop indexes, and the reason it is a separate type: a palette is 256 objects whose
 * fields cost four property reads per PIXEL, and in the webview those objects reach the loop through a
 * Svelte reactive proxy, where each of those reads is a proxy trap and a signal read. Resolving the whole
 * palette once - per palette, not per frame and not per pixel - is what keeps playback inside its frame
 * budget; converting a nine-tile creature stance was spending most of a second in proxy traps alone.
 */
export type PaletteLut = Uint32Array;

/**
 * Pack a palette into the lookup the pixel loop reads: the transparent index gets alpha 0, every other
 * entry keeps its own alpha, and a missing entry is opaque black. Background compositing
 * (checkerboard/green) is a view-layer CSS concern, never baked in.
 *
 * Per-entry alpha is only ever other than 255 for a BAM v1 palette from an Enhanced Edition, which
 * stores transparency levels for interface art; the transparent INDEX still wins over it.
 *
 * The words are filled through a BYTE view of the same buffer, so each word carries r,g,b,a in memory
 * order on either endianness - the same order `putImageData` reads them back in.
 */
export function paletteLut(palette: readonly Rgba[], transparentIndex: number): PaletteLut {
    const lut = new Uint32Array(256);
    const bytes = new Uint8Array(lut.buffer);
    for (let i = 0; i < 256; i++) {
        const color = palette[i] ?? BLACK;
        const o = i * 4;
        bytes[o] = color.r;
        bytes[o + 1] = color.g;
        bytes[o + 2] = color.b;
        bytes[o + 3] = i === transparentIndex ? 0 : color.a;
    }
    return lut;
}

/**
 * Maps an indexed frame to RGBA through a packed palette - one load and one store per pixel.
 *
 * The result is a byte view OF the words written here, not a copy of them.
 */
export function frameToRgba(pixels: Uint8Array, width: number, height: number, lut: PaletteLut): Uint8ClampedArray {
    const count = width * height;
    const out = new Uint32Array(count);
    for (let i = 0; i < count; i++) out[i] = lut[pixels[i] ?? 0] ?? 0;
    return new Uint8ClampedArray(out.buffer);
}

/**
 * A true-colour frame's pixels are already RGBA, so this is a copy rather than a lookup. It exists
 * so both colour models resolve through one module and FrameCanvas has a single draw path.
 */
export function rgbaFrameToRgba(pixels: Uint8Array): Uint8ClampedArray {
    return new Uint8ClampedArray(pixels);
}

/** A simple checkerboard CSS background for the "checkered" transparency background option. */
export function checkerboardCss(): string {
    return "repeating-conic-gradient(#808080 0% 25%, #c0c0c0 0% 50%) 0 0 / 16px 16px";
}
