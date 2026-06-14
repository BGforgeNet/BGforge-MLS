import { describe, expect, it } from "vitest";
import { ITM_FIELDS } from "../../binary/src/itm/entity-ops";
import { SPL_FIELDS } from "../../binary/src/spl/entity-ops";
import { RANGE_FIELDS } from "../src/effect-tree";

// effect-tree.ts duplicates the ITM/SPL effect-range field keys as plain strings because the binary adapters do
// not barrel-export ITM_FIELDS / SPL_FIELDS. This pins the copies to the source of truth, so a rename on either
// adapter fails loudly here instead of silently desyncing the abilities+effects tree projection.
describe("effect-tree RANGE_FIELDS stays in sync with the binary adapters", () => {
    it("matches ITM_FIELDS", () => {
        expect(RANGE_FIELDS.itm).toEqual({
            headerStart: ITM_FIELDS.headerStart,
            headerCount: ITM_FIELDS.headerCount,
            abilityStart: ITM_FIELDS.abilityStart,
            abilityCount: ITM_FIELDS.abilityCount,
        });
    });

    it("matches SPL_FIELDS", () => {
        expect(RANGE_FIELDS.spl).toEqual({
            headerStart: SPL_FIELDS.headerStart,
            headerCount: SPL_FIELDS.headerCount,
            abilityStart: SPL_FIELDS.abilityStart,
            abilityCount: SPL_FIELDS.abilityCount,
        });
    });
});
