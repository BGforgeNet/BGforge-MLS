/**
 * BAM v1 palette transparency.
 *
 * The fourth byte of each BGRA palette entry is unused in the classic engines but meaningful in the
 * Enhanced Editions, where `00h` reads as fully opaque (for backwards compatibility) and `01h`-`FFh`
 * are real transparency levels. Reading it as a plain alpha would turn every classic file, which
 * stores zeroes there, fully transparent - which is why these tests pin the `00h` case first.
 */
import { describe, expect, it } from "vitest";
import { parseBamV1, serializeBamV1, type Rgba } from "@bgforge/image";
import { greyPalette, multiCycle } from "./bam-fixtures.ts";

/** The palette region's byte offset, read from the header the serializer wrote. */
function paletteOffset(bam: Uint8Array): number {
    return new DataView(bam.buffer, bam.byteOffset, bam.byteLength).getUint32(0x10, true);
}

/** The stored fourth byte of each palette entry - what a reader of the FILE sees. */
function storedAlpha(bam: Uint8Array, count = 8): number[] {
    const at = paletteOffset(bam);
    return Array.from({ length: count }, (_, i) => bam[at + i * 4 + 3] ?? -1);
}

/** A BAM whose palette carries the given fourth bytes, written into a real serializer's output. */
function bamWithStoredAlpha(alphas: readonly number[]): Uint8Array {
    const bam = multiCycle(2, 2);
    const at = paletteOffset(bam);
    const patched = new Uint8Array(bam);
    alphas.forEach((a, i) => {
        patched[at + i * 4 + 3] = a;
    });
    return patched;
}

describe("BAM v1 palette alpha", () => {
    it("reads a stored 00h as fully opaque, not fully transparent", () => {
        // Every classic-engine file stores zeroes here; reading them literally would blank the game.
        const parsed = parseBamV1(bamWithStoredAlpha([0, 0, 0, 0]));

        expect(parsed.palette.slice(0, 4).map((c) => c.a)).toEqual([255, 255, 255, 255]);
    });

    it("keeps a stored transparency level instead of forcing the entry opaque", () => {
        const parsed = parseBamV1(bamWithStoredAlpha([0x77, 0x01, 0xff, 0x0c]));

        expect(parsed.palette.slice(0, 4).map((c) => c.a)).toEqual([0x77, 0x01, 255, 0x0c]);
    });

    it("writes a transparency level back to the file", () => {
        const parsed = parseBamV1(bamWithStoredAlpha([0x77, 0x01, 0xff, 0x0c]));

        expect(storedAlpha(serializeBamV1(parsed), 4)).toEqual([0x77, 0x01, 0x00, 0x0c]);
    });

    it("stores an opaque entry as 00h, the convention nearly every file on disk uses", () => {
        const opaque: Rgba[] = greyPalette().map((c) => ({ ...c, a: 255 }));
        const parsed = parseBamV1(multiCycle(2, 2));

        const written = serializeBamV1({ ...parsed, palette: opaque });

        expect(storedAlpha(written, 4)).toEqual([0, 0, 0, 0]);
    });

    it("round-trips a mixed palette through parse, serialize and parse again", () => {
        const original = parseBamV1(bamWithStoredAlpha([0x77, 0x00, 0xff, 0x0c, 0x01]));

        const again = parseBamV1(serializeBamV1(original));

        // Spelled out rather than compared to `original`, which would hold whatever the code does today.
        expect(again.palette.slice(0, 5).map((c) => c.a)).toEqual([0x77, 255, 255, 0x0c, 0x01]);
    });

    it("leaves an all-opaque file byte-identical, so no classic BAM is rewritten", () => {
        const bam = multiCycle(2, 2);

        expect(Buffer.from(serializeBamV1(parseBamV1(bam))).equals(Buffer.from(bam))).toBe(true);
    });
});

describe("BAM v1 empty cycles", () => {
    /** Point cycle `c` at a count of 0 and a sentinel start, as two shipped BGEE files do. */
    function withEmptyCycle(bam: Uint8Array, c: number): Uint8Array {
        const view = new DataView(bam.buffer, bam.byteOffset, bam.byteLength);
        const frameCount = view.getUint16(0x08, true);
        const cycleAt = view.getUint32(0x0c, true) + frameCount * 12 + c * 4;
        const patched = new Uint8Array(bam);
        const pv = new DataView(patched.buffer);
        pv.setUint16(cycleAt, 0, true); // count
        pv.setUint16(cycleAt + 2, 0xffff, true); // start: a sentinel, not a real index
        return patched;
    }

    it("parses a cycle that declares no frames, whatever its start says", () => {
        // An empty cycle reads no lookup entries at all, so a start past the table is unreachable
        // rather than out of range. Two shipped BGEE files (MGO2SCE, MGO2SDE) do exactly this.
        const parsed = parseBamV1(withEmptyCycle(multiCycle(2, 2), 0));

        expect(parsed.sequences[0]?.frameRefs).toEqual([]);
        expect(parsed.sequences[1]?.frameRefs.length).toBeGreaterThan(0);
    });

    it("still refuses a NON-empty cycle whose lookup range runs past the file", () => {
        const bam = multiCycle(2, 2);
        const view = new DataView(bam.buffer, bam.byteOffset, bam.byteLength);
        const cycleAt = view.getUint32(0x0c, true) + view.getUint16(0x08, true) * 12;
        const patched = new Uint8Array(bam);
        const pv = new DataView(patched.buffer);
        pv.setUint16(cycleAt, 1, true); // one frame...
        pv.setUint16(cycleAt + 2, 0xffff, true); // ...starting past the end of the table

        expect(() => parseBamV1(patched)).toThrow(/frame lookup table out of range/);
    });
});
