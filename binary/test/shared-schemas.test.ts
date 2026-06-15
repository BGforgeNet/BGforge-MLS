import { describe, expect, it } from "vitest";
import { z } from "zod";
import { opaqueRangeSchema } from "../src/shared-schemas";

// The MAP canonical document schema validates opaque ranges via z.array(opaqueRangeSchema)
// (map/canonical-schemas.ts:238), and a JSON snapshot reaches that schema through
// loadBinaryJsonSnapshot before the canonical writer allocates its output buffer. Exercise the
// same array-wrapped shape here so the bound is asserted on the path the loader actually runs.
const opaqueRanges = z.array(opaqueRangeSchema);

const validRange = { label: "objects-tail", offset: 16, size: 8, hexChunks: ["00ff"] };
const MAP_CAP = 16 * 1024 * 1024;

describe("opaqueRangeSchema", () => {
    it("accepts an in-range opaque range", () => {
        expect(opaqueRanges.safeParse([validRange]).success).toBe(true);
    });

    it("accepts offset and size exactly at the 16 MB MAP cap", () => {
        expect(opaqueRanges.safeParse([{ ...validRange, offset: MAP_CAP, size: MAP_CAP }]).success).toBe(true);
    });

    // Without the upper bound a crafted snapshot like this drives the MAP canonical writer to a
    // multi-GB Uint8Array allocation before any format validation runs.
    it("rejects an offset beyond the MAP cap", () => {
        expect(opaqueRanges.safeParse([{ ...validRange, offset: 2_147_483_647 }]).success).toBe(false);
    });

    it("rejects a size beyond the MAP cap", () => {
        expect(opaqueRanges.safeParse([{ ...validRange, size: 2_147_483_647 }]).success).toBe(false);
    });
});
