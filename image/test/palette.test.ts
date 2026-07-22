import { describe, expect, it } from "vitest";
import { parsePal, serializePal, DEFAULT_FALLOUT_PALETTE } from "@bgforge/image";

describe("palette", () => {
    it("default Fallout palette has 256 entries in 0..255 range", () => {
        expect(DEFAULT_FALLOUT_PALETTE).toHaveLength(256);
        for (const c of DEFAULT_FALLOUT_PALETTE) {
            for (const ch of [c.r, c.g, c.b]) {
                expect(ch).toBeGreaterThanOrEqual(0);
                expect(ch).toBeLessThanOrEqual(255);
            }
        }
    });
    it("default Fallout palette pins index 0 and 1 from the source 6-bit bytes", () => {
        // Source color.pal raw bytes: index 0 = (0xff,0xff,0xff) sentinel; (255<<2)|(255>>4) & 0xff
        // still yields 255, so the sentinel survives the 6-to-8-bit expansion unchanged.
        // Index 1 = (0x3b,0x3b,0x3b) = (59,59,59) 6-bit -> 8-bit (59<<2)|(59>>4) = 236|3 = 239.
        expect(DEFAULT_FALLOUT_PALETTE[0]).toEqual({ r: 255, g: 255, b: 255, a: 255 });
        expect(DEFAULT_FALLOUT_PALETTE[1]).toEqual({ r: 239, g: 239, b: 239, a: 255 });
    });
    it("round-trips a synthesized 6-bit palette core", () => {
        // 768-byte 6-bit RGB core, values 0..63.
        const core = new Uint8Array(768);
        for (let i = 0; i < 768; i++) core[i] = i % 64;
        const parsed = parsePal(core);
        expect(parsed).toHaveLength(256);
        expect(Buffer.from(serializePal(parsed).subarray(0, 768)).equals(Buffer.from(core))).toBe(true);
    });
});
