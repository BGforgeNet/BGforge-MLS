import { type IndexedAnimation, type Frame } from "../model/animation.ts";

function payload(f: Frame): Uint8Array {
    return f.rawEncoding ?? f.pixels;
}

export function serializeBamV1(anim: IndexedAnimation): Uint8Array {
    const le = true;
    const frameCount = anim.frames.length;
    const cycleCount = anim.sequences.length;
    const transparent = anim.meta.transparentIndex ?? 0;

    // Build the LUT as concatenated cycle frameRefs.
    const lut: number[] = [];
    const cycleRanges: { start: number; count: number }[] = [];
    for (const seq of anim.sequences) {
        cycleRanges.push({ start: lut.length, count: seq.frameRefs.length });
        lut.push(...seq.frameRefs);
    }

    // Layout: header(0x18) | frame entries(12*n) | cycle entries(4*c) | palette(1024) | LUT(2*l) |
    // frame data.
    //
    // Four ways this deliberately differs from some files on disk. Measured across the three installs
    // (bg2ee, bgee, tob), none of them loses a frame, a cycle, a colour or a pixel:
    //
    // - PALETTE LENGTH. Always 256 entries, because the model pads a short on-disk palette to 256.
    //   163 files store fewer and grow here, gaining black entries no valid pixel index reaches.
    // - REGION ORDER. Fixed as above. Some files order theirs differently (one common producer writes
    //   the frame entries LAST), so the offsets in the header differ even where the content matches.
    // - FRAME-DATA SHARING. Two frame entries may point at ONE data block on disk; each frame is
    //   written its own copy here. 7343 files share, 85% of their frame entries do, and expanding all
    //   of it costs 0.24% of the corpus - the shared blocks are almost all single-byte transparent
    //   runs. Preserving sharing would mean keying frames by payload identity, which the model, whose
    //   frames are independently editable, does not express.
    // - TRAILING BYTES. Output ends at the last frame's data; ~700 files carry slack past it that no
    //   header field addresses.
    const headerSize = 0x18;
    const frameEntryOffset = headerSize;
    const cycleEntryOffset = frameEntryOffset + frameCount * 12;
    const paletteOffset = cycleEntryOffset + cycleCount * 4;
    const lutOffset = paletteOffset + 1024;
    const dataStart = lutOffset + lut.length * 2;

    const payloads = anim.frames.map(payload);
    const dataOffsets: number[] = [];
    let cursor = dataStart;
    for (const p of payloads) {
        dataOffsets.push(cursor);
        cursor += p.length;
    }
    const total = cursor;
    // Data offsets pack into 31 bits (bit 31 is the uncompressed flag); past 2 GiB the mask below
    // would silently truncate them.
    /* v8 ignore next -- a >2 GiB fixture is not practically constructible in a test */
    if (total > 0x7fffffff) throw new Error("serializeBamV1: output exceeds the 2 GiB BAM offset limit");

    const out = new Uint8Array(total);
    const view = new DataView(out.buffer);
    out.set(new TextEncoder().encode("BAM "), 0x00);
    out.set(new TextEncoder().encode("V1  "), 0x04);
    view.setUint16(0x08, frameCount, le);
    view.setUint8(0x0a, cycleCount);
    view.setUint8(0x0b, transparent);
    view.setUint32(0x0c, frameEntryOffset, le);
    view.setUint32(0x10, paletteOffset, le);
    view.setUint32(0x14, lutOffset, le);

    anim.frames.forEach((f, i) => {
        const e = frameEntryOffset + i * 12;
        view.setUint16(e + 0x00, f.width, le);
        view.setUint16(e + 0x02, f.height, le);
        view.setInt16(e + 0x04, f.offsetX, le);
        view.setInt16(e + 0x06, f.offsetY, le);
        const dataOffset = dataOffsets[i] ?? 0;
        // Explicit rleEncoded flag, not a byte-length heuristic: an RLE stream can happen to
        // equal width*height, which a length-based inference would misread as uncompressed.
        const uncompressed = !f.rleEncoded;
        // setUint32 applies ToUint32 to its value, so the signed bitwise-OR result (bit 31 set
        // makes it negative in JS) still writes the correct unsigned bits without extra coercion.
        const packed = (dataOffset & 0x7fffffff) | (uncompressed ? 0x80000000 : 0);
        view.setUint32(e + 0x08, packed, le);
    });

    cycleRanges.forEach((r, c) => {
        const e = cycleEntryOffset + c * 4;
        view.setUint16(e + 0x00, r.count, le);
        view.setUint16(e + 0x02, r.start, le);
    });

    // Always write all 256 palette entries; the model pads short on-disk palettes to 256.
    anim.palette.forEach((c, i) => {
        const p = paletteOffset + i * 4;
        out[p] = c.b;
        out[p + 1] = c.g;
        out[p + 2] = c.r;
        // Opaque is stored as 00h, which both engine families read as opaque and which is what nearly
        // every file on disk holds. A file that stored FFh for opaque therefore comes back as 00h -
        // the one alpha value this does not reproduce byte-for-byte, and a no-op for what it draws.
        out[p + 3] = c.a === 255 ? 0 : c.a;
    });

    lut.forEach((frameIndex, i) => view.setUint16(lutOffset + i * 2, frameIndex, le));
    payloads.forEach((p, i) => out.set(p, dataOffsets[i] ?? 0));
    return out;
}
