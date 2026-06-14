/**
 * MAP elevation Objects subtabs disable themselves for elevations the map does not have.
 *
 * The header `mapFlags` carries SkipElevation1Tiles (0x4) / SkipElevation2Tiles (0x8): when set, that
 * elevation is absent. The Objects tab's elev1 / elev2 subtabs declare a `disabledWhen` predicate on those
 * bits, so a single-elevation map greys out the elevation 1 / 2 tabs instead of offering empty object lists.
 * Elevation 0 always exists, so it is never disabled.
 */

import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { formatAdapterRegistry, mapParser } from "@bgforge/binary";
import { buildModel } from "../src/model";
import { resolveLayout } from "../src/layout";

function elevationTabState(file: string): Record<string, boolean> {
    const bytes = new Uint8Array(fs.readFileSync(path.resolve(__dirname, `../../client/testFixture/maps/${file}.map`)));
    const model = buildModel(mapParser.parse(bytes));
    const layout = formatAdapterRegistry.get("map")!.layout!;
    const resolved = resolveLayout("map", layout, model)!;
    const objects = resolved.tabs!.find((t) => t.id === "objects")!;
    return Object.fromEntries((objects.tabs ?? []).map((t) => [t.id, t.disabled ?? false]));
}

describe("MAP elevation tabs: disabled per header skip-flag", () => {
    it("greys out elevation 1/2 tabs on a single-elevation map (skip flags set)", () => {
        // artemple: mapFlags 0xc (SkipElevation1Tiles | SkipElevation2Tiles).
        const s = elevationTabState("artemple");
        expect(s.elev0).toBe(false);
        expect(s.elev1).toBe(true);
        expect(s.elev2).toBe(true);
    });

    it("keeps all elevation tabs enabled when the skip flags are clear", () => {
        // arcaves: mapFlags 0x0 - all three elevations present.
        const s = elevationTabState("arcaves");
        expect(s.elev0).toBe(false);
        expect(s.elev1).toBe(false);
        expect(s.elev2).toBe(false);
    });
});
