import { describe, expect, it } from "vitest";
import {
    getDomainRange,
    getNumericTypeRange,
    validateNumericValue,
    zodFieldNumber,
} from "../src/binary-format-contract";

describe("binary-format-contract", () => {
    it("exposes shared primitive numeric ranges", () => {
        expect(getNumericTypeRange("uint8")).toEqual({ min: 0, max: 255 });
        expect(getNumericTypeRange("int32")).toEqual({ min: -2_147_483_648, max: 2_147_483_647 });
        expect(getNumericTypeRange("unknown")).toBeUndefined();
    });

    it("exposes domain-specific ranges keyed by semantic field keys", () => {
        expect(getDomainRange("pro", "pro.header.lightRadius")).toEqual({ min: 0, max: 8 });
        expect(getDomainRange("pro", "pro.stairsProperties.destElevation")).toEqual({ min: 0, max: 63 });
        expect(getDomainRange("map", "map.header.defaultOrientation")).toEqual({ min: 0, max: 5 });
        expect(getDomainRange("map", "map.header.unknown")).toBeUndefined();
    });

    it("validates primitive and domain constraints in one place", () => {
        expect(validateNumericValue(256, "uint8")).toContain("out of range");
        expect(
            validateNumericValue(6, "int32", { format: "map", fieldKey: "map.header.defaultOrientation" }),
        ).toContain("allowed range");
        expect(
            validateNumericValue(64, "uint32", { format: "pro", fieldKey: "pro.stairsProperties.destElevation" }),
        ).toContain("allowed range");
    });

    it("builds zod numeric schemas with domain limits", () => {
        const orientationSchema = zodFieldNumber("map", "map.header.defaultOrientation", "int32");
        expect(orientationSchema.safeParse(5).success).toBe(true);
        expect(orientationSchema.safeParse(6).success).toBe(false);

        const destTileSchema = zodFieldNumber("pro", "pro.stairsProperties.destTile", "uint32");
        expect(destTileSchema.safeParse(0x03_ff_ff_ff).success).toBe(true);
        expect(destTileSchema.safeParse(0x04_00_00_00).success).toBe(false);
    });
});
