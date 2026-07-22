import type { Rgba } from "@bgforge/image";
import type { FrameView } from "../messages";

export type Background = "transparent" | "checkered" | "green";

// The classic transparent-green used by Infinity Engine BAM editors, offered as a background choice.
export const GREEN = "#00ff00";

const BLACK: Rgba = { r: 0, g: 0, b: 0, a: 0 };

/**
 * Maps an indexed frame to RGBA pixel data via the palette. The transparent index gets alpha 0
 * (real transparency); every other pixel is opaque. Background compositing (checkerboard/green) is
 * a separate view-layer concern applied via canvas/CSS, not baked into these pixels.
 */
export function frameToRgba(frame: FrameView, palette: Rgba[], transparentIndex: number): Uint8ClampedArray {
    const out = new Uint8ClampedArray(frame.width * frame.height * 4);
    for (let i = 0; i < frame.pixels.length; i++) {
        const index = frame.pixels[i] ?? 0;
        const color = palette[index] ?? BLACK;
        const o = i * 4;
        out[o] = color.r;
        out[o + 1] = color.g;
        out[o + 2] = color.b;
        out[o + 3] = index === transparentIndex ? 0 : 255;
    }
    return out;
}

/** A simple checkerboard CSS background for the "checkered" transparency background option. */
export function checkerboardCss(): string {
    return "repeating-conic-gradient(#808080 0% 25%, #c0c0c0 0% 50%) 0 0 / 16px 16px";
}
