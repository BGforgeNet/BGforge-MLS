/**
 * Block-compression codecs for the two formats the desktop Infinity Engine ships inside PVRZ:
 * DXT1/BC1 and DXT5/BC3. Both address the image as 4x4 blocks in row-major order, differing only
 * in block size and in how each block resolves a pixel - which is what `decodeBlocked` factors out.
 *
 * Pixels the caller supplies are carried as fixed-length tuples rather than `number[]`: under
 * `noUncheckedIndexedAccess` an array read is `number | undefined`, and the `?? 0` that silences it
 * at every channel is an unreachable branch that no test can ever cover.
 *
 * Palettes, ramps and per-block pixels are the exception: a tuple per palette entry plus a closure
 * per block is an allocation on every one of the tens of thousands of 4x4 blocks in a texture, so
 * those are caller-owned `Uint8Array` scratch buffers reused across blocks. Their indices are
 * computed from block geometry, never read from input, so reads assert with `!` - which keeps the
 * unreachable branch out rather than trading one uncoverable form for another.
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
 * The four colours a BC1-style colour block addresses, written into `palette` as four RGBA
 * quadruples. The endpoint ordering is the mode selector: c0 > c1 interpolates four opaque colours,
 * otherwise three plus a transparent slot. BC3's colour block always takes the four-colour rule
 * regardless of ordering, since its alpha lives elsewhere.
 *
 * Fills a caller-owned buffer rather than returning tuples: this runs once per 4x4 block, so
 * allocating a palette per call put six short-lived objects per block on a decode path that handles
 * tens of thousands of them per texture.
 */
function colourPalette(palette: Uint8Array, c0: number, c1: number, fourColourOnly: boolean): void {
    const a = rgb565(c0);
    const b = rgb565(c1);
    palette[0] = a.r;
    palette[1] = a.g;
    palette[2] = a.b;
    palette[3] = 255;
    palette[4] = b.r;
    palette[5] = b.g;
    palette[6] = b.b;
    palette[7] = 255;
    if (fourColourOnly || c0 > c1) {
        palette[8] = Math.round((a.r * 2 + b.r) / 3);
        palette[9] = Math.round((a.g * 2 + b.g) / 3);
        palette[10] = Math.round((a.b * 2 + b.b) / 3);
        palette[11] = 255;
        palette[12] = Math.round((a.r + b.r * 2) / 3);
        palette[13] = Math.round((a.g + b.g * 2) / 3);
        palette[14] = Math.round((a.b + b.b * 2) / 3);
        palette[15] = 255;
    } else {
        palette[8] = Math.round((a.r + b.r) / 2);
        palette[9] = Math.round((a.g + b.g) / 2);
        palette[10] = Math.round((a.b + b.b) / 2);
        palette[11] = 255;
        palette[12] = 0;
        palette[13] = 0;
        palette[14] = 0;
        palette[15] = 0;
    }
}

/**
 * The eight alpha values a BC3 alpha block addresses, written into `ramp`. Endpoint ordering selects
 * the ramp exactly as it selects the colour mode: a0 > a1 interpolates six steps between the
 * endpoints, otherwise four steps plus a pinned fully-transparent and fully-opaque pair.
 */
function alphaRamp(ramp: Uint8Array, a0: number, a1: number): void {
    ramp[0] = a0;
    ramp[1] = a1;
    const steps = a0 > a1 ? 7 : 5;
    for (let i = 1; i < steps; i++) ramp[i + 1] = Math.round((a0 * (steps - i) + a1 * i) / steps);
    if (steps === 5) {
        ramp[6] = 0;
        ramp[7] = 255;
    }
}

/**
 * Resolve one block's 16 pixels into `pixels` as RGBA quadruples in row-major order. Called once per
 * block with a buffer the walk reuses, so a decoder allocates nothing per block.
 */
type BlockDecoder = (view: DataView, base: number, pixels: Uint8Array) => void;

/**
 * Write a BC1-shaped colour block's 16 two-bit indices, packed four per byte from `base`, into
 * `pixels` as RGB. Alpha is left to the caller: BC1 takes it from the palette, BC3 from its own
 * alpha block.
 */
function writeColours(view: DataView, base: number, palette: Uint8Array, pixels: Uint8Array): void {
    for (let py = 0; py < 4; py++) {
        const row = view.getUint8(base + py);
        for (let px = 0; px < 4; px++) {
            // Asserted, not `?? 0`: a two-bit index times four is 0, 4, 8 or 12 into a 16-byte
            // palette this module allocates, so the fallback is unreachable - and an unreachable
            // branch on the hottest line of the decoder is one no test can ever cover.
            const entry = ((row >> (px * 2)) & 0x3) * 4;
            const out = (py * 4 + px) * 4;
            pixels[out] = palette[entry]!;
            pixels[out + 1] = palette[entry + 1]!;
            pixels[out + 2] = palette[entry + 2]!;
            pixels[out + 3] = palette[entry + 3]!;
        }
    }
}

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
    decodeBlock: BlockDecoder,
): Uint8Array {
    const out = new Uint8Array(width * height * 4);
    const view = new DataView(blocks.buffer, blocks.byteOffset, blocks.byteLength);
    const blocksPerRow = Math.ceil(width / 4);
    const pixels = new Uint8Array(64);

    for (let by = 0; by < Math.ceil(height / 4); by++) {
        for (let bx = 0; bx < blocksPerRow; bx++) {
            decodeBlock(view, (by * blocksPerRow + bx) * blockBytes, pixels);
            for (let py = 0; py < 4; py++) {
                const y = by * 4 + py;
                if (y >= height) break;
                for (let px = 0; px < 4; px++) {
                    const x = bx * 4 + px;
                    if (x >= width) break;
                    // `src` is at most 63 into the 64-byte scratch buffer, so as above the
                    // undefined case cannot arise and must not become an uncoverable branch.
                    const src = (py * 4 + px) * 4;
                    const dst = (y * width + x) * 4;
                    out[dst] = pixels[src]!;
                    out[dst + 1] = pixels[src + 1]!;
                    out[dst + 2] = pixels[src + 2]!;
                    out[dst + 3] = pixels[src + 3]!;
                }
            }
        }
    }
    return out;
}

/** Decode a BC1 (DXT1) texture to RGBA8. `width`/`height` are the texture's pixel dimensions. */
export function decodeBc1(blocks: Uint8Array, width: number, height: number): Uint8Array {
    const palette = new Uint8Array(16);
    return decodeBlocked(blocks, width, height, 8, (view, base, pixels) => {
        colourPalette(palette, view.getUint16(base, true), view.getUint16(base + 2, true), false);
        writeColours(view, base + 4, palette, pixels);
    });
}

/** Decode a BC3 (DXT5) texture to RGBA8. `width`/`height` are the texture's pixel dimensions. */
export function decodeBc3(blocks: Uint8Array, width: number, height: number): Uint8Array {
    const palette = new Uint8Array(16);
    const ramp = new Uint8Array(8);
    return decodeBlocked(blocks, width, height, 16, (view, base, pixels) => {
        alphaRamp(ramp, view.getUint8(base), view.getUint8(base + 1));
        // 16 three-bit indices packed little-endian across the six bytes at base+2, read as two
        // words rather than a BigInt: the field is 48 bits, but no index needs more than three of
        // them at a time, and a BigInt shift per pixel allocates on every one of them.
        const alphaLo = view.getUint32(base + 2, true); // bits 0..31
        const alphaHi = view.getUint16(base + 6, true); // bits 32..47
        // BC3's colour block always takes the four-colour rule; its alpha lives in the block above.
        colourPalette(palette, view.getUint16(base + 8, true), view.getUint16(base + 10, true), true);
        writeColours(view, base + 12, palette, pixels);
        for (let i = 0; i < 16; i++) {
            const bit = i * 3;
            // Indices sit at bit offsets 0, 3, ... 45, so 30 is the only one straddling the split.
            const index =
                bit < 30
                    ? (alphaLo >>> bit) & 0x7
                    : bit === 30
                      ? ((alphaLo >>> 30) | (alphaHi << 2)) & 0x7
                      : (alphaHi >>> (bit - 32)) & 0x7;
            pixels[i * 4 + 3] = ramp[index]!; // three-bit index into an 8-byte ramp
        }
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

/** Index of the entry closest to `colour` in a flat four-RGBA-quadruple palette. */
function nearestColour(palette: Uint8Array, colour: Rgba4): number {
    let bestIndex = 0;
    let best = Infinity;
    for (let i = 0; i < 4; i++) {
        const dr = palette[i * 4]! - colour[0];
        const dg = palette[i * 4 + 1]! - colour[1];
        const db = palette[i * 4 + 2]! - colour[2];
        const dist = dr * dr + dg * dg + db * db;
        if (dist < best) {
            best = dist;
            bestIndex = i;
        }
    }
    return bestIndex;
}

/** Write a block's colour endpoints and its 16 two-bit indices at `base`. */
function writeColourBlock(out: Uint8Array, base: number, rows: readonly Rgba4[][], palette: Uint8Array): void {
    const [hi, lo] = farthestPair(rows.flat());
    let c0 = toRgb565(hi);
    let c1 = toRgb565(lo);
    // c0 > c1 is what selects the four-colour mode on the way back in. Equal endpoints cannot
    // express it, but a block that uniform only needs index 0, which decodes the same either way.
    if (c0 < c1) [c0, c1] = [c1, c0];

    const view = new DataView(out.buffer, out.byteOffset, out.byteLength);
    view.setUint16(base, c0, true);
    view.setUint16(base + 2, c1, true);
    colourPalette(palette, c0, c1, true);
    for (const [py, row] of rows.entries()) {
        let packed = 0;
        for (const [px, pixel] of row.entries()) packed |= nearestColour(palette, pixel) << (px * 2);
        out[base + 4 + py] = packed;
    }
}

// No BC1 encoder: BC1 carries at most one bit of alpha, and the only texture this module encodes is
// a repacked sprite page that needs per-pixel alpha. Decoding stays symmetric - most shipped pages
// are BC1 - so the missing direction is deliberate. See encodePvrz.

/** Encode an RGBA8 texture as BC3 (DXT5). */
export function encodeBc3(rgba: Uint8Array, width: number, height: number): Uint8Array {
    const blocksPerRow = Math.ceil(width / 4);
    const blockRowCount = Math.ceil(height / 4);
    const out = new Uint8Array(blocksPerRow * blockRowCount * 16);
    const palette = new Uint8Array(16);
    const ramp = new Uint8Array(8);

    for (let by = 0; by < blockRowCount; by++) {
        for (let bx = 0; bx < blocksPerRow; bx++) {
            const base = (by * blocksPerRow + bx) * 16;
            const rows = blockRows(rgba, width, height, bx, by);
            const alphas = rows.flat().map((pixel) => pixel[3]);

            const a0 = Math.max(...alphas);
            const a1 = Math.min(...alphas);
            out[base] = a0;
            out[base + 1] = a1;
            alphaRamp(ramp, a0, a1);
            // The 48-bit index field as two words, mirroring the decoder's split at bit 32.
            let alphaLo = 0;
            let alphaHi = 0;
            for (const [i, alpha] of alphas.entries()) {
                let bestIndex = 0;
                let best = Infinity;
                for (let k = 0; k < 8; k++) {
                    const dist = Math.abs(ramp[k]! - alpha);
                    if (dist < best) {
                        best = dist;
                        bestIndex = k;
                    }
                }
                const bit = i * 3;
                if (bit < 30) alphaLo |= bestIndex << bit;
                else if (bit === 30) {
                    alphaLo |= (bestIndex & 0x3) << 30;
                    alphaHi |= bestIndex >>> 2;
                } else alphaHi |= bestIndex << (bit - 32);
            }
            for (let k = 0; k < 4; k++) out[base + 2 + k] = (alphaLo >>> (k * 8)) & 0xff;
            out[base + 6] = alphaHi & 0xff;
            out[base + 7] = (alphaHi >>> 8) & 0xff;

            writeColourBlock(out, base + 8, rows, palette);
        }
    }
    return out;
}
