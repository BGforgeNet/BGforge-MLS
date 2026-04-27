/**
 * Variants registry tests for MAP objects. Each variant's `defaultElement()`
 * must produce a canonical-doc shape the parser can later identify as the
 * requested variant: the PID's upper byte must encode the type tag, and
 * type-required sub-records (`critterData` for critters, `exitGrid` for
 * exit-grid misc) must be present.
 *
 * Full round-trip (canonical-doc → bytes → parse) for the per-elevation
 * objects array is currently gated on a separate canonical-writer issue
 * tracked in `docs/todo.md`: the script-section serializer and the parser
 * disagree on byte size for files whose script sections carry trailing
 * undecoded data (every real-world fixture surfaces this), so the objects
 * section lands at a different offset on reparse. Once that is fixed,
 * fixture-based round-trip tests for `buildAddEntryBytes` /
 * `buildRemoveEntryBytes` against per-elevation paths will land here too.
 */

import { describe, expect, it } from "vitest";
import { findMapObjectVariant, MAP_OBJECT_VARIANTS } from "../src/map/specs/object-variants";

describe("MAP_OBJECT_VARIANTS registry", () => {
    it("exposes Misc, Critter, and Exit Grid in the canonical order", () => {
        expect(MAP_OBJECT_VARIANTS.map((v) => v.id)).toEqual(["misc", "critter", "exitGrid"]);
    });

    it("each variant has a non-empty user-facing label", () => {
        for (const variant of MAP_OBJECT_VARIANTS) {
            expect(variant.label.length).toBeGreaterThan(0);
        }
    });

    it("findMapObjectVariant returns undefined for unknown ids", () => {
        expect(findMapObjectVariant(undefined)).toBeUndefined();
        expect(findMapObjectVariant("no-such")).toBeUndefined();
    });
});

describe("Misc skeleton", () => {
    const skeleton = findMapObjectVariant("misc")!.defaultElement();

    it("identifies as kind 'misc' with PID type tag 5", () => {
        expect(skeleton.kind).toBe("misc");
        expect((skeleton.base.pid >>> 24) & 0xff).toBe(5);
    });

    it("has objectData but neither critterData nor exitGrid", () => {
        expect(skeleton.objectData).toEqual({ dataFlags: 0 });
        expect(skeleton.critterData).toBeUndefined();
        expect(skeleton.exitGrid).toBeUndefined();
    });

    it("has empty inventory and zero-filled inventoryHeader", () => {
        expect(skeleton.inventory).toEqual([]);
        expect(skeleton.inventoryHeader).toEqual({ inventoryLength: 0, inventoryCapacity: 0, inventoryPointer: 0 });
    });

    it("has every base field other than pid set to zero", () => {
        for (const [key, value] of Object.entries(skeleton.base)) {
            if (key === "pid") continue;
            expect(value, `base.${key}`).toBe(0);
        }
    });
});

describe("Critter skeleton", () => {
    const skeleton = findMapObjectVariant("critter")!.defaultElement();

    it("identifies as kind 'critter' with PID type tag 1", () => {
        expect(skeleton.kind).toBe("critter");
        expect((skeleton.base.pid >>> 24) & 0xff).toBe(1);
    });

    it("has critterData (writer requires it for critters) but no objectData or exitGrid", () => {
        expect(skeleton.critterData).toBeDefined();
        expect(skeleton.objectData).toBeUndefined();
        expect(skeleton.exitGrid).toBeUndefined();
    });

    it("zero-fills every critterData field", () => {
        for (const [key, value] of Object.entries(skeleton.critterData!)) {
            expect(value, `critterData.${key}`).toBe(0);
        }
    });
});

describe("Exit Grid skeleton", () => {
    const skeleton = findMapObjectVariant("exitGrid")!.defaultElement();

    it("identifies as kind 'misc' but uses an exit-grid PID range", () => {
        // Exit grids are misc objects whose PID falls in 0x05000010..0x05000017;
        // a bare 0x05000000 reparses as plain misc, not exit grid.
        expect(skeleton.kind).toBe("misc");
        expect(skeleton.base.pid).toBeGreaterThanOrEqual(0x0500_0010);
        expect(skeleton.base.pid).toBeLessThanOrEqual(0x0500_0017);
    });

    it("has exitGrid sub-record + objectData; no critterData", () => {
        expect(skeleton.exitGrid).toEqual({
            destinationMap: 0,
            destinationTile: 0,
            destinationElevation: 0,
            destinationRotation: 0,
        });
        expect(skeleton.objectData).toEqual({ dataFlags: 0 });
        expect(skeleton.critterData).toBeUndefined();
    });
});
