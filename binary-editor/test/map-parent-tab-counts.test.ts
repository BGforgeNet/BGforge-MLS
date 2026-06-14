/**
 * A parent tab that holds subtabs shows the SUM of its subtabs' counts.
 *
 * MAP's Objects tab (Elevation 0/1/2 subtabs) and Scripts tab (System/Spatial/Timer/Item subtabs) previously
 * showed no count badge - only the subtabs did. Parity with the IE formats (whose counted tabs are leaves) is
 * to aggregate: Objects = sum of elevation counts, Scripts = sum of per-type counts.
 */

import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { formatAdapterRegistry, mapParser } from "@bgforge/binary";
import { buildModel } from "../src/model";
import { resolveLayout } from "../src/layout";
import type { ResolvedTab } from "../src/types";

const FIXTURE = path.resolve(__dirname, "../../client/testFixture/maps/artemple.map");

function resolved() {
    const model = buildModel(mapParser.parse(new Uint8Array(fs.readFileSync(FIXTURE)), { skipMapTiles: true }));
    const layout = formatAdapterRegistry.get("map")!.layout!;
    return resolveLayout("map", layout, model)!;
}

const sumSubtabs = (t: ResolvedTab): number =>
    (t.tabs ?? []).reduce((acc, st) => acc + (typeof st.count === "number" ? st.count : 0), 0);

describe("MAP parent tabs: aggregate subtab counts", () => {
    it("Scripts tab count is the sum of its per-type subtab counts", () => {
        const scripts = resolved().tabs!.find((t) => t.id === "scripts")!;
        expect(scripts.count).toBe(sumSubtabs(scripts));
        // artemple: System 0, Spatial 0, Timer 3, Item 2.
        expect(scripts.count).toBe(5);
    });

    it("Objects tab count is the sum of its per-elevation subtab counts", () => {
        const objects = resolved().tabs!.find((t) => t.id === "objects")!;
        expect(objects.count).toBe(sumSubtabs(objects));
        expect(typeof objects.count).toBe("number");
    });
});
