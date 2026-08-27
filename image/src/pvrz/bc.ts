/**
 * Block-compression codecs for the two formats the desktop Infinity Engine ships inside PVRZ:
 * DXT1/BC1 and DXT5/BC3. Both address the image as 4x4 blocks in row-major order, differing only
 * in block size and in how each block resolves a pixel - which is what `decodeBlocked` factors out.
 *
 * Colours are passed as fixed-length tuples rather than `number[]` throughout: under
 * `noUncheckedIndexedAccess` an array read is `number | undefined`, and the `?? 0` that silences it
 * at every channel is an unreachable branch that no test can ever cover.
 */

type Rgba4 = readonly [number, number, number, number];

const TRANSPARENT: Rgba4 = [0, 0, 0, 0];

/** Expand an RGB565 endpoint to 8 bits per channel, replicating high bits into the low ones. */
function rgb565(value: number): { r: number; g: number; b: number } {
    const r = (value >> 11) & 0x1f;
    const g = (value >> 5) & 0x3f;
    const b = value & 0x1f;
    return { r: (r << 3) | (r >> 2), g: (g << 2) | (g >> 4), b: (b << 3) | (b >> 2) };
}

/**
 * The four colours a BC1-style colour block addresses. The endpoint ordering is the mode selector:
 * c0 > c1 interpolates four opaque colours, otherwise three plus a transparent slot. BC3's colour
 * block always takes the four-colour rule regardless of ordering, since its alpha lives elsewhere.
 */
function colourPalette(c0: number, c1: number, fourColourOnly: boolean): readonly [Rgba4, Rgba4, Rgba4, Rgba4] {
    const a = rgb565(c0);
    const b = rgb565(c1);
    const mix = (wa: number, wb: number, den: number): Rgba4 => [
        Math.round((a.r * wa + b.r * wb) / den),
        Math.round((a.g * wa + b.g * wb) / den),
        Math.round((a.b * wa + b.b * wb) / den),
        255,
    ];
    const c0Colour = mix(1, 0, 1);
    const c1Colour = mix(0, 1, 1);
    return fourColourOnly || c0 > c1
        ? [c0Colour, c1Colour, mix(2, 1, 3), mix(1, 2, 3)]
        : [c0Colour, c1Colour, mix(1, 1, 2), TRANSPARENT];
}

/**
 * The eight alpha values a BC3 alpha block addresses. Endpoint ordering selects the ramp exactly as
 * it selects the colour mode: a0 > a1 interpolates six steps between the endpoints, otherwise four
 * steps plus a pinned fully-transparent and fully-opaque pair.
 */
function alphaRamp(a0: number, a1: number): number[] {
    const ramp = [a0, a1];
    const steps = a0 > a1 ? 7 : 5;
    for (let i = 1; i < steps; i++) ramp.push(Math.round((a0 * (steps - i) + a1 * i) / steps));
    if (steps === 5) ramp.push(0, 255);
    return ramp;
}

/**
 * Read one of the 16 two-bit colour indices packed four-per-byte from `base` and resolve it against
 * the block's palette. The switch is what keeps this cast-free: masking to 0..3 proves the range to
 * a reader but not to the checker, and `as 0 | 1 | 2 | 3` would assert exactly what it cannot see.
 */
function paletteAt(
    view: DataView,
    base: number,
    px: number,
    py: number,
    palette: readonly [Rgba4, Rgba4, Rgba4, Rgba4],
): Rgba4 {
    switch ((view.getUint8(base + py) >> (px * 2)) & 0x3) {
        case 0:
            return palette[0];
        case 1:
            return palette[1];
        case 2:
            return palette[2];
        default:
            return palette[3];
    }
}

/** Resolves a pixel of one block, by its position within the 4x4 grid, to RGBA. */
type BlockSampler = (px: number, py: number) => Rgba4;

/**
 * Walk a block-compressed texture and write RGBA8. A texture whose dimensions are not multiples of
 * four still stores whole blocks; the pixels past the edge are decoded and dropped here, which is
 * how the format pads.
 */
function decodeBlocked(
    blocks: Uint8Array,
    width: number,
    height: number,
    blockBytes: number,
    sampler: (view: DataView, base: number) => BlockSampler,
): Uint8Array {
    const out = new Uint8Array(width * height * 4);
    const view = new DataView(blocks.buffer, blocks.byteOffset, blocks.byteLength);
    const blocksPerRow = Math.ceil(width / 4);

    for (let by = 0; by < Math.ceil(height / 4); by++) {
        for (let bx = 0; bx < blocksPerRow; bx++) {
            const sample = sampler(view, (by * blocksPerRow + bx) * blockBytes);
            for (let py = 0; py < 4; py++) {
                for (let px = 0; px < 4; px++) {
                    const x = bx * 4 + px;
                    const y = by * 4 + py;
                    if (x >= width || y >= height) continue;
                    out.set(sample(px, py), (y * width + x) * 4);
                }
            }
        }
    }
    return out;
}

/** Decode a BC1 (DXT1) texture to RGBA8. `width`/`height` are the texture's pixel dimensions. */
export function decodeBc1(blocks: Uint8Array, width: number, height: number): Uint8Array {
    return decodeBlocked(blocks, width, height, 8, (view, base) => {
        const palette = colourPalette(view.getUint16(base, true), view.getUint16(base + 2, true), false);
        return (px, py) => paletteAt(view, base + 4, px, py, palette);
    });
}

/** Decode a BC3 (DXT5) texture to RGBA8. `width`/`height` are the texture's pixel dimensions. */
export function decodeBc3(blocks: Uint8Array, width: number, height: number): Uint8Array {
    return decodeBlocked(blocks, width, height, 16, (view, base) => {
        const ramp = alphaRamp(view.getUint8(base), view.getUint8(base + 1));
        // 16 three-bit indices packed little-endian across the six bytes at base+2.
        let alphaBits = 0n;
        for (let k = 0; k < 6; k++) alphaBits |= BigInt(view.getUint8(base + 2 + k)) << BigInt(k * 8);
        // BC3's colour block always takes the four-colour rule; its alpha lives in the block above.
        const palette = colourPalette(view.getUint16(base + 8, true), view.getUint16(base + 10, true), true);
        return (px, py) => {
            const colour = paletteAt(view, base + 12, px, py, palette);
            const level = ramp[Number((alphaBits >> BigInt((py * 4 + px) * 3)) & 0x7n)];
            return [colour[0], colour[1], colour[2], level ?? 0];
        };
    });
}

/** Quantize an 8-bit-per-channel colour to the packed RGB565 an endpoint is stored as. */
function toRgb565(colour: Rgba4): number {
    return ((colour[0] >> 3) << 11) | ((colour[1] >> 2) << 5) | (colour[2] >> 3);
}

/**
 * Gather one block as four rows of four pixels, clamping reads at the texture edge. Rows rather
 * than a flat 16 so both the encoder's index packing and its pixel walk stay index-free.
 */
function blockRows(rgba: Uint8Array, width: number, height: number, bx: number, by: number): Rgba4[][] {
    const rows: Rgba4[][] = [];
    for (let py = 0; py < 4; py++) {
        const row: Rgba4[] = [];
        for (let px = 0; px < 4; px++) {
            const x = Math.min(bx * 4 + px, width - 1);
            const y = Math.min(by * 4 + py, height - 1);
            const o = (y * width + x) * 4;
            row.push([rgba[o] ?? 0, rgba[o + 1] ?? 0, rgba[o + 2] ?? 0, rgba[o + 3] ?? 255]);
        }
        rows.push(row);
    }
    return rows;
}

/** Squared RGB distance, the metric both endpoint selection and index assignment use. */
function distance(a: Rgba4, b: Rgba4): number {
    const dr = a[0] - b[0];
    const dg = a[1] - b[1];
    const db = a[2] - b[2];
    return dr * dr + dg * dg + db * db;
}

/**
 * Endpoints for a block: the two pixels furthest apart in RGB.
 *
 * Chosen over a per-channel bounding box, which picks corners no pixel occupies and wrecks the
 * common two-tone block - for a block of pure (200,30,40) and (20,180,90) the box corners are
 * (200,180,90) and (20,30,40), and every pixel then lands on an interpolated colour ~60 off. The
 * furthest-apart pair is exact for any block of at most two distinct colours, which sprite art is
 * full of, and 120 comparisons per block is nothing beside the surrounding zlib work.
 */
function farthestPair(pixels: readonly Rgba4[]): readonly [Rgba4, Rgba4] {
    let best = -1;
    let hi: Rgba4 = TRANSPARENT;
    let lo: Rgba4 = TRANSPARENT;
    for (const [i, a] of pixels.entries()) {
        for (const b of pixels.slice(i + 1)) {
            const dist = distance(a, b);
            if (dist > best) {
                best = dist;
                hi = a;
                lo = b;
            }
        }
    }
    return [hi, lo];
}

/** Index of the palette entry closest to `colour`. */
function nearestColour(palette: readonly Rgba4[], colour: Rgba4): number {
    let bestIndex = 0;
    let best = Infinity;
    for (const [i, entry] of palette.entries()) {
        const dist = distance(entry, colour);
        if (dist < best) {
            best = dist;
            bestIndex = i;
        }
    }
    return bestIndex;
}

/** Write a block's colour endpoints and its 16 two-bit indices at `base`. */
function writeColourBlock(out: Uint8Array, base: number, rows: readonly Rgba4[][]): void {
    const [hi, lo] = farthestPair(rows.flat());
    let c0 = toRgb565(hi);
    let c1 = toRgb565(lo);
    // c0 > c1 is what selects the four-colour mode on the way back in. Equal endpoints cannot
    // express it, but a block that uniform only needs index 0, which decodes the same either way.
    if (c0 < c1) [c0, c1] = [c1, c0];

    const view = new DataView(out.buffer, out.byteOffset, out.byteLength);
    view.setUint16(base, c0, true);
    view.setUint16(base + 2, c1, true);
    const palette = colourPalette(c0, c1, true);
    for (const [py, row] of rows.entries()) {
        let packed = 0;
        for (const [px, pixel] of row.entries()) packed |= nearestColour(palette, pixel) << (px * 2);
        out[base + 4 + py] = packed;
    }
}

/** Encode an RGBA8 texture as BC1 (DXT1). */
export function encodeBc1(rgba: Uint8Array, width: number, height: number): Uint8Array {
    const blocksPerRow = Math.ceil(width / 4);
    const blockRowCount = Math.ceil(height / 4);
    const out = new Uint8Array(blocksPerRow * blockRowCount * 8);
    for (let by = 0; by < blockRowCount; by++) {
        for (let bx = 0; bx < blocksPerRow; bx++) {
            writeColourBlock(out, (by * blocksPerRow + bx) * 8, blockRows(rgba, width, height, bx, by));
        }
    }
    return out;
}

/** Encode an RGBA8 texture as BC3 (DXT5). */
export function encodeBc3(rgba: Uint8Array, width: number, height: number): Uint8Array {
    const blocksPerRow = Math.ceil(width / 4);
    const blockRowCount = Math.ceil(height / 4);
    const out = new Uint8Array(blocksPerRow * blockRowCount * 16);

    for (let by = 0; by < blockRowCount; by++) {
        for (let bx = 0; bx < blocksPerRow; bx++) {
            const base = (by * blocksPerRow + bx) * 16;
            const rows = blockRows(rgba, width, height, bx, by);
            const alphas = rows.flat().map((pixel) => pixel[3]);

            const a0 = Math.max(...alphas);
            const a1 = Math.min(...alphas);
            out[base] = a0;
            out[base + 1] = a1;
            const ramp = alphaRamp(a0, a1);
            let alphaBits = 0n;
            for (const [i, alpha] of alphas.entries()) {
                let bestIndex = 0;
                let best = Infinity;
                for (const [k, level] of ramp.entries()) {
                    const dist = Math.abs(level - alpha);
                    if (dist < best) {
                        best = dist;
                        bestIndex = k;
                    }
                }
                alphaBits |= BigInt(bestIndex) << BigInt(i * 3);
            }
            for (let k = 0; k < 6; k++) out[base + 2 + k] = Number((alphaBits >> BigInt(k * 8)) & 0xffn);

            writeColourBlock(out, base + 8, rows);
        }
    }
    return out;
}
