// Node-free on purpose (like frame-anchor.ts): pure geometry shared by the FRM converter and the
// APNG exporter. Aligning frames of differing size on a common canvas by their ANCHOR (instead of
// centring each frame on its own geometry) is what keeps an animation steady when the target format
// or viewer has no per-frame anchor of its own.
import { type Frame } from "./animation.ts";

/** A frame plus the pixel (from its top-left) that must land on the shared reference point. */
export interface PlacedFrame {
    frame: Frame;
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

export function unionAnchorBox(placed: PlacedFrame[]): AnchorBox | undefined {
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

/** The placed frame re-blitted onto the box-sized canvas (transparent fill), its content at its
 *  anchor-aligned position. The result carries no anchor of its own (offsets 0). */
export function blitToBox(placed: PlacedFrame, box: AnchorBox, fill: number): Frame {
    const width = box.right - box.left;
    const height = box.bottom - box.top;
    const { frame, ax, ay } = placed;
    const pixels = new Uint8Array(width * height).fill(fill);
    const dx = Math.round(-ax - box.left);
    const dy = Math.round(-ay - box.top);
    for (let y = 0; y < frame.height; y++) {
        pixels.set(frame.pixels.subarray(y * frame.width, (y + 1) * frame.width), (dy + y) * width + dx);
    }
    return { width, height, pixels, offsetX: 0, offsetY: 0 };
}
