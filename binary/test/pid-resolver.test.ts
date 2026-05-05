import { describe, it, expect } from "vitest";
import { resolvePidSubType } from "../src/pid-resolver";

describe("resolvePidSubType (default Fallout 2 table)", () => {
    it("resolves an item pid to its subType (Armor=0)", () => {
        expect(resolvePidSubType(1)).toBe(0);
    });

    it("resolves an item-weapon pid (Weapon=3)", () => {
        expect(resolvePidSubType(161)).toBe(3);
    });

    it("resolves an item-misc pid (Misc=5)", () => {
        expect(resolvePidSubType(458)).toBe(5);
    });

    it("resolves a scenery-door pid (pid 0x02000002 → Door=0)", () => {
        expect(resolvePidSubType(0x02000002)).toBe(0);
    });

    it("resolves a scenery-generic pid (pid 0x02000001 → Generic=5)", () => {
        expect(resolvePidSubType(0x02000001)).toBe(5);
    });

    it("returns undefined for an unknown item pid (modded territory)", () => {
        expect(resolvePidSubType(0x000fffff)).toBeUndefined();
    });

    it("returns undefined for a critter pid (table covers only items + scenery)", () => {
        expect(resolvePidSubType(0x01000001)).toBeUndefined();
    });

    it("returns undefined for the wildcard sentinel pid -1", () => {
        expect(resolvePidSubType(-1)).toBeUndefined();
    });
});
