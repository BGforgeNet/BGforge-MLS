import type { Rgba } from "@bgforge/image";

export type Background = "transparent" | "checkered" | "green";

// The classic transparent-green used by Infinity Engine BAM editors, offered as a background choice.
export const GREEN = "#00ff00";

const BLACK: Rgba = { r: 0, g: 0, b: 0, a: 0 };

/**
 * Maps an indexed frame to RGBA via the palette; the transparent index gets alpha 0, every other
 * pixel is opaque. Background compositing (checkerboard/green) is a view-layer CSS concern, never baked in.
 */
export function frameToRgba(
    pixels: Uint8Array,
    width: number,
    height: number,
    palette: Rgba[],
    transparentIndex: number,
): Uint8ClampedArray {
    const out = new Uint8ClampedArray(width * height * 4);
    for (let i = 0; i < width * height; i++) {
        const index = pixels[i] ?? 0;
        const color = palette[index] ?? BLACK;
        const o = i * 4;
        out[o] = color.r;
        out[o + 1] = color.g;
        out[o + 2] = color.b;
        out[o + 3] = index === transparentIndex ? 0 : 255;
    }
    return out;
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
