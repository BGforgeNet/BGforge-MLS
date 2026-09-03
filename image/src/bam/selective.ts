import { type Frame } from "../model/animation.ts";
import { type BamV1Tables, decodeFrameAt, readV1Tables } from "./parse.ts";
import { decodeBamc, isBamc } from "./bamc.ts";

/**
 * Read a BAM v1 or BAMC without decoding pixels, then decode only the frames a caller names.
 *
 * A thumbnail samples one frame per cycle, so decoding all of them is wasted work on a many-frame
 * animation. BAMC buys nothing here - the whole payload inflates before any table is readable - but it
 * is the dominant on-disk shape, so both entry points accept it rather than making callers sniff.
 */
function uncompressed(bytes: Uint8Array): Uint8Array {
    return isBamc(bytes) ? decodeBamc(bytes) : bytes;
}

export function readBamV1Tables(bytes: Uint8Array): BamV1Tables {
    return readV1Tables(uncompressed(bytes));
}

/**
 * Decode only `indices`. Out-of-range indices are skipped: a cycle table may reference a frame the file
 * does not have, and a thumbnail is not the place to fail on it.
 */
export function decodeBamV1Frames(bytes: Uint8Array, indices: readonly number[]): Map<number, Frame> {
    const raw = uncompressed(bytes);
    const tables = readV1Tables(raw);
    const out = new Map<number, Frame>();
    for (const index of new Set(indices)) {
        if (index < 0 || index >= tables.frameCount) continue;
        out.set(index, decodeFrameAt(raw, index, tables));
    }
    return out;
}
