/**
 * Synthetic AnimationView fixtures for the FRM/BAM render-harness drivers. Built entirely in-memory -
 * never gated on the gitignored `external/fallout` corpus - so the harness renders deterministically in
 * any environment. Each sequence gets its own bright palette index so every compass/grid tile is a
 * visibly distinct color, and every frame carries a marker block (position flips between frame indices)
 * so no rendered tile is ever a flat single color - the zoom-redraw check in render-frm.mts relies on
 * that variance to tell "redrawn" from "blank".
 */
import { emptyPalette, FRM_FACINGS } from "../../../image/src/model/animation";
import type { Rgba } from "../../../image/src/model/animation";
import {
    encodeFramePixels,
    type AnimationView,
    type FrameView,
    type SequenceView,
} from "../../../client/src/image-editor/webview/messages";

export const TILE_SIZE = 24;
const MARKER_SIZE = 6;
const MARKER_INDEX = 7;

function setColor(palette: Rgba[], index: number, r: number, g: number, b: number): void {
    palette[index] = { r, g, b, a: 255 };
}

function colorAt(colors: [number, number, number][], i: number): [number, number, number] {
    const color = colors[i];
    if (!color) throw new Error(`missing fixture color at index ${i}`);
    return color;
}

/** frameIndex flips the marker corner (top-left on even frames, bottom-right on odd) so consecutive
 *  frames in a sequence are visibly different without ever rendering a uniform, un-marked tile. */
function makeFrame(baseIndex: number, frameIndex: number): FrameView {
    const pixels = new Uint8Array(TILE_SIZE * TILE_SIZE).fill(baseIndex);
    const start = frameIndex % 2 === 1 ? TILE_SIZE - MARKER_SIZE : 0;
    for (let y = 0; y < MARKER_SIZE; y++) {
        for (let x = 0; x < MARKER_SIZE; x++) {
            pixels[(start + y) * TILE_SIZE + (start + x)] = MARKER_INDEX;
        }
    }
    return { width: TILE_SIZE, height: TILE_SIZE, pixels: encodeFramePixels(pixels), offsetX: 0, offsetY: 0 };
}

const FRM_COLORS: [number, number, number][] = [
    [255, 0, 0], // NE - red
    [255, 140, 0], // E - orange
    [255, 215, 0], // SE - yellow
    [0, 200, 0], // SW - green
    [30, 144, 255], // W - blue
    [160, 32, 240], // NW - purple
];

/** 6 sequences at FRM's compass facings, 2 frames each - renders as the 3x3 compass rose. */
export function buildFrmFixture(): AnimationView {
    const palette = emptyPalette();
    setColor(palette, MARKER_INDEX, 255, 255, 255);
    const frames: FrameView[] = [];
    const sequences: SequenceView[] = FRM_FACINGS.map((facing, i) => {
        const baseIndex = i + 1;
        const [r, g, b] = colorAt(FRM_COLORS, i);
        setColor(palette, baseIndex, r, g, b);
        const frameRefs = [0, 1].map((frameIndex) => {
            frames.push(makeFrame(baseIndex, frameIndex));
            return frames.length - 1;
        });
        return { frameRefs, facing, dirOffsetX: 0, dirOffsetY: 0 };
    });

    return {
        palette,
        frames,
        sequences,
        meta: { sourceFormat: "frm", fps: 10 },
        basename: "harness-fixture",
        sourceFormat: "frm",
        hasSidecarPal: false,
        externalPaletteActive: false,
        dirty: false,
    };
}

const BAM_COLORS: [number, number, number][] = [
    [0, 255, 255], // cyan
    [255, 0, 255], // magenta
    [160, 160, 160], // gray
    [255, 105, 180], // pink
];

/** Several sequences, all facing "none" - not a compass direction, so compass-layout falls back to the
 *  cycle grid. Exercises that fallback path rather than duplicating the FRM compass coverage. */
/** 12 cycles, all facing "none" - past the >8 multi-sequence threshold, so CycleLayoutControls mounts
 *  and the grid seeds its column count from the heuristic (12 % 6 === 0 -> 6). */
export function buildMultiSequenceBamFixture(): AnimationView {
    const palette = emptyPalette();
    setColor(palette, MARKER_INDEX, 255, 255, 255);
    const frames: FrameView[] = [];
    const sequences: SequenceView[] = Array.from({ length: 12 }, (_, i) => {
        const colorIdx = i % BAM_COLORS.length;
        const baseIndex = colorIdx + 1;
        const [r, g, b] = colorAt(BAM_COLORS, colorIdx);
        setColor(palette, baseIndex, r, g, b);
        frames.push(makeFrame(baseIndex, 0));
        return { frameRefs: [frames.length - 1], facing: "none" as const, dirOffsetX: 0, dirOffsetY: 0 };
    });

    return {
        palette,
        frames,
        sequences,
        meta: { sourceFormat: "bam", transparentIndex: 0 },
        basename: "harness-fixture-multi",
        sourceFormat: "bam",
        hasSidecarPal: false,
        externalPaletteActive: false,
        dirty: false,
    };
}

/** 16 cycles in the IE base-file shape: two stride-8 direction blocks, slots 0-4 real per-slot-colored
 *  cycles (block 1 brighter than block 0 so a group switch is visible), slots 5-7 one shared filler
 *  frame - the fingerprint interpretIeRose detects, so the editor opens in the rose layout. */
export function buildDirectionalBamFixture(): AnimationView {
    const palette = emptyPalette();
    setColor(palette, MARKER_INDEX, 255, 255, 255);
    const frames: FrameView[] = [];
    // Frame 0 is the shared east-slot filler (dark gray).
    setColor(palette, 30, 60, 60, 60);
    frames.push(makeFrame(30, 0));
    const sequences: SequenceView[] = [];
    for (let block = 0; block < 2; block++) {
        for (let slot = 0; slot < 8; slot++) {
            if (slot >= 5) {
                sequences.push({ frameRefs: [0, 0, 0], facing: "none", dirOffsetX: 0, dirOffsetY: 0 });
                continue;
            }
            const baseIndex = 1 + block * 5 + slot;
            const [r, g, b] = colorAt(FRM_COLORS, slot); // 5 west slots reuse 5 distinct FRM colors
            const bright = block === 0 ? 0.55 : 1; // block 0 dimmed, block 1 full - distinct per block
            setColor(palette, baseIndex, Math.round(r * bright), Math.round(g * bright), Math.round(b * bright));
            const frameRefs = [0, 1].map((frameIndex) => {
                frames.push(makeFrame(baseIndex, frameIndex));
                return frames.length - 1;
            });
            sequences.push({ frameRefs, facing: "none", dirOffsetX: 0, dirOffsetY: 0 });
        }
    }

    return {
        palette,
        frames,
        sequences,
        meta: { sourceFormat: "bam", transparentIndex: 0 },
        basename: "harness-fixture-directional",
        sourceFormat: "bam",
        hasSidecarPal: false,
        externalPaletteActive: false,
        dirty: false,
    };
}

export function buildBamFixture(): AnimationView {
    const palette = emptyPalette();
    setColor(palette, MARKER_INDEX, 255, 255, 255);
    const frames: FrameView[] = [];
    const sequences: SequenceView[] = BAM_COLORS.map((_color, i) => {
        const baseIndex = i + 1;
        const [r, g, b] = colorAt(BAM_COLORS, i);
        setColor(palette, baseIndex, r, g, b);
        const frameRefs = [0, 1].map((frameIndex) => {
            frames.push(makeFrame(baseIndex, frameIndex));
            return frames.length - 1;
        });
        return { frameRefs, facing: "none", dirOffsetX: 0, dirOffsetY: 0 };
    });

    return {
        palette,
        frames,
        sequences,
        meta: { sourceFormat: "bam", transparentIndex: 0 },
        basename: "harness-fixture",
        sourceFormat: "bam",
        hasSidecarPal: false,
        externalPaletteActive: false,
        dirty: false,
    };
}
