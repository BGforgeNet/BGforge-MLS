import { describe, expect, it } from "vitest";
import { FRM_FACINGS, emptyPalette } from "@bgforge/image";

describe("model", () => {
    it("FRM has 6 hex facings, no N/S", () => {
        expect(FRM_FACINGS).toEqual(["NE", "E", "SE", "SW", "W", "NW"]);
        expect(FRM_FACINGS).not.toContain("N");
        expect(FRM_FACINGS).not.toContain("S");
    });
    it("emptyPalette has 256 rgba entries", () => {
        const p = emptyPalette();
        expect(p).toHaveLength(256);
        expect(p[0]).toEqual({ r: 0, g: 0, b: 0, a: 255 });
    });
});
