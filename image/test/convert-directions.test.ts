import { describe, expect, it } from "vitest";
import { facingsForCycleCount, frmSlotOrder, FRM_FACING_SET, IE8_FACINGS } from "../src/convert/directions.ts";
describe("direction facings", () => {
    it("IE 8-dir order is S,SW,W,NW,N,NE,E,SE (0=S, CCW)", () => {
        expect(IE8_FACINGS).toEqual(["S", "SW", "W", "NW", "N", "NE", "E", "SE"]);
    });
    it("FRM stores the six hex facings, not N/S", () => {
        expect(FRM_FACING_SET.has("NE")).toBe(true);
        expect(FRM_FACING_SET.has("N")).toBe(false);
        expect(FRM_FACING_SET.has("S")).toBe(false);
    });
    it("derives facings for 6 and 8 cycles, null otherwise", () => {
        expect(facingsForCycleCount(8)).toEqual([...IE8_FACINGS]);
        expect(facingsForCycleCount(6)).toEqual(["NE", "E", "SE", "SW", "W", "NW"]);
        expect(facingsForCycleCount(9)).toBeNull();
        expect(facingsForCycleCount(16)).toBeNull();
    });
    it("frmSlotOrder maps each FRM header slot to its source index", () => {
        // IE8 kept facings placed into FRM order NE,E,SE,SW,W,NW
        expect(frmSlotOrder([...IE8_FACINGS])).toEqual([5, 6, 7, 1, 2, 3]);
    });
});
