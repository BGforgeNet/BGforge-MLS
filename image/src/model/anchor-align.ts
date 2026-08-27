// Node-free on purpose (like frame-anchor.ts): pure geometry shared by the FRM converter and the
// APNG exporter. Aligning frames of differing size on a common canvas by their ANCHOR (instead of
// centring each frame on its own geometry) is what keeps an animation steady when the target format
// or viewer has no per-frame anchor of its own.
import { type Frame, type RgbaFrame } from "./animation.ts";

/** A frame plus the pixel (from its top-left) that must land on the shared reference point. */
export interface PlacedFrame {
    frame: Frame;
    ax: number;
    ay: number;
}

/** The true-colour counterpart of PlacedFrame - same geometry, four bytes per pixel. */
export interface PlacedRgbaFrame {
    frame: RgbaFrame;
    ax: number;
    ay: number;
}

/** Union of placed frames' boxes relative to their anchors, in integer pixels (an FRM anchor can sit
 *  on a half pixel; floor/ceil keeps every rounded blit inside the canvas). */
export interface AnchorBox {
    left: number;
    top: number;
    right: number;
    bottom: number;
}

export function unionAnchorBox(placed: (PlacedFrame | PlacedRgbaFrame)[]): AnchorBox | undefined {
    if (placed.length === 0) return undefined;
    let left = Infinity;
    let top = Infinity;
    let right = -Infinity;
    let bottom = -Infinity;
    for (const { frame, ax, ay } of placed) {
        left = Math.min(left, -ax);
        top = Math.min(top, -ay);
        right = Math.max(right, frame.width - ax);
        bottom = Math.max(bottom, frame.height - ay);
    }
    return { left: Math.floor(left), top: Math.floor(top), right: Math.ceil(right), bottom: Math.ceil(bottom) };
}

/** Shared geometry for both colour models: the placement maths is identical, only the stride differs. */
function blitBytes(
    placed: PlacedFrame | PlacedRgbaFrame,
    box: AnchorBox,
    bytesPerPixel: number,
    fill: readonly number[],
): { width: number; height: number; pixels: Uint8Array } {
    const width = box.right - box.left;
    const height = box.bottom - box.top;
    const { frame, ax, ay } = placed;
    const pixels = new Uint8Array(width * height * bytesPerPixel);
    // Skipped for an all-zero fill, which the allocation already gives - the true-colour case, where
    // transparent IS zero.
    if (fill.some((byte) => byte !== 0)) {
        for (let p = 0; p < width * height; p++) pixels.set(fill, p * bytesPerPixel);
    }
    const dx = Math.round(-ax - box.left);
    const dy = Math.round(-ay - box.top);
    const rowBytes = frame.width * bytesPerPixel;
    for (let y = 0; y < frame.height; y++) {
        pixels.set(frame.pixels.subarray(y * rowBytes, (y + 1) * rowBytes), ((dy + y) * width + dx) * bytesPerPixel);
    }
    return { width, height, pixels };
}

/** The placed frame re-blitted onto the box-sized canvas (transparent fill), its content at its
 *  anchor-aligned position. The result carries no anchor of its own (offsets 0). */
export function blitToBox(placed: PlacedFrame, box: AnchorBox, fill: number): Frame {
    return { ...blitBytes(placed, box, 1, [fill]), offsetX: 0, offsetY: 0 };
}

/** True-colour counterpart of blitToBox; the fill is a fully transparent pixel. */
export function blitRgbaToBox(placed: PlacedRgbaFrame, box: AnchorBox): RgbaFrame {
    return { ...blitBytes(placed, box, 4, [0, 0, 0, 0]), offsetX: 0, offsetY: 0 };
}
