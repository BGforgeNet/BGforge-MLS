import { type RgbaAnimation, type RgbaFrame, type Sequence } from "../model/animation.ts";
import { interpretIeDirections } from "../model/ie-direction.ts";
import { MAX_FRAME_PIXELS } from "../limits.ts";
import { decodePvrz } from "../pvrz/container.ts";
import { type PvrTexture } from "../pvrz/texture.ts";
import { type BamV2Structure } from "./v2-structure.ts";

/**
 * Supplies the raw bytes of a PVRZ page, or undefined when it cannot be found.
 *
 * Injected rather than resolved here: `@bgforge/image` has no runtime dependencies and no
 * filesystem access, and reaching the game archive would mean depending on `@bgforge/binary`,
 * inverting the layering (the client already depends on both).
 */
export type PvrzResolver = (page: number) => Uint8Array | undefined;

/** The resource a data block's page number refers to: a zero-padded four-digit MOS name. */
export function pvrzResourceName(page: number): string {
    return `MOS${String(page).padStart(4, "0")}.PVRZ`;
}

/**
 * Compose an animation from its structure plus the pages its blocks reference.
 *
 * Pages are decoded once each and reused across every block that names them: a single BAM can carry
 * thousands of blocks over a handful of 1024x1024 pages, and decoding per block would repeat the
 * zlib inflate and the whole-texture BC decode for each one.
 */
export function decodeBamV2(structure: BamV2Structure, resolve: PvrzResolver): RgbaAnimation {
    const pages = new Map<number, PvrTexture>();
    for (const page of structure.requiredPages) {
        const bytes = resolve(page);
        if (bytes === undefined) {
            throw new Error(
                `decodeBamV2: cannot resolve PVRZ page ${page} (${pvrzResourceName(page)}) - the file is incomplete`,
            );
        }
        pages.set(page, decodePvrz(bytes));
    }

    const frames: RgbaFrame[] = structure.frames.map((entry, index) => {
        if (entry.width * entry.height > MAX_FRAME_PIXELS) {
            throw new Error(
                `decodeBamV2: frame ${index} claims ${entry.width}x${entry.height} pixels - implausibly large for a sprite`,
            );
        }
        // Zero-filled, so any region no block covers stays fully transparent.
        const pixels = new Uint8Array(entry.width * entry.height * 4);

        for (const block of structure.blocks.slice(entry.blockStart, entry.blockStart + entry.blockCount)) {
            const page = pages.get(block.page);
            if (page === undefined) {
                throw new Error(`decodeBamV2: frame ${index} references unlisted PVRZ page ${block.page}`);
            }
            if (block.sourceX + block.width > page.width || block.sourceY + block.height > page.height) {
                throw new Error(
                    `decodeBamV2: frame ${index} block at ${block.sourceX},${block.sourceY} ` +
                        `(${block.width}x${block.height}) falls outside page ${block.page} ` +
                        `(${page.width}x${page.height})`,
                );
            }
            for (let row = 0; row < block.height; row++) {
                const y = block.targetY + row;
                if (y >= entry.height) break;
                const copyWidth = Math.min(block.width, entry.width - block.targetX);
                if (copyWidth <= 0) break;
                const from = ((block.sourceY + row) * page.width + block.sourceX) * 4;
                pixels.set(page.rgba.subarray(from, from + copyWidth * 4), (y * entry.width + block.targetX) * 4);
            }
        }

        return {
            width: entry.width,
            height: entry.height,
            pixels,
            offsetX: entry.centerX,
            offsetY: entry.centerY,
        };
    });

    // A cycle is a contiguous run of frame entries, unlike v1's indirection through a lookup table.
    const sequences: Sequence[] = structure.cycles.map((cycle) => ({
        frameRefs: Array.from({ length: cycle.frameCount }, (_, k) => cycle.frameStart + k),
        facing: "none",
    }));

    return {
        colorModel: "rgba",
        frames,
        sequences,
        // Same direction-layout resolution and fixed engine frame rate as v1: the container carries
        // neither, and both formats are played by the same engine at 15 fps.
        meta: {
            sourceFormat: "bamv2",
            fps: 15,
            directionLayout: interpretIeDirections(sequences, frames.length)?.detected ? "ie8" : "non-directional",
        },
    };
}
