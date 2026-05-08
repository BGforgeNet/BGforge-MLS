import { describe, it, expect } from "vitest";
import { proDomainRanges } from "../src/pro/presentation-schema";
import { toDomainRanges } from "../src/spec/derive-domain-ranges";
import { headerSpec } from "../src/pro/specs/header";
import { doorSpec } from "../src/pro/specs/door";
import { stairsSpec } from "../src/pro/specs/stairs";
import { ladderSpec } from "../src/pro/specs/ladder";

/**
 * Drift guard: every `domain:` declaration on a PRO spec must appear in
 * `proDomainRanges` with matching bounds, and `proDomainRanges` must contain
 * no path key beyond what the specs produce.
 *
 * The path-keyed `proDomainRanges` table is consumed by `validateNumericValue`
 * for editor input bounds; the spec `domain:` field is consumed by
 * `fieldSpecToZod` as the save-time refinement. Both encode the same
 * constraint - derivation keeps them locked together.
 */
describe("proDomainRanges", () => {
    it("equals the union of toDomainRanges() over every PRO spec that declares domains", () => {
        const expected = {
            ...toDomainRanges(headerSpec, "pro.header"),
            ...toDomainRanges(doorSpec, "pro.doorProperties"),
            ...toDomainRanges(stairsSpec, "pro.stairsProperties"),
            ...toDomainRanges(ladderSpec, "pro.ladderProperties"),
        };
        expect(proDomainRanges).toEqual(expected);
    });

    it("matches the documented PRO domain bounds", () => {
        expect(proDomainRanges).toEqual({
            "pro.header.lightRadius": { min: 0, max: 8 },
            "pro.header.lightIntensity": { min: 0, max: 65536 },
            "pro.doorProperties.walkThruFlag": { min: 0, max: 1 },
            "pro.stairsProperties.destTile": { min: 0, max: 0x03ffffff },
            "pro.stairsProperties.destElevation": { min: 0, max: 0x3f },
            "pro.ladderProperties.destTile": { min: 0, max: 0x03ffffff },
            "pro.ladderProperties.destElevation": { min: 0, max: 0x3f },
        });
    });
});
