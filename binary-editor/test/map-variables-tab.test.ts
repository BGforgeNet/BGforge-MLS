/**
 * MAP Variables tab: top-level tab with Global / Local subtabs whose count aggregates both.
 *
 * arcaves.map: 21 global vars, 0 local vars -> Variables count = 21.
 * denbus1.map: 10 global vars, 0 local vars -> Variables count = 10.
 */

import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { formatAdapterRegistry, mapParser } from "@bgforge/binary";
import { buildModel } from "../src/model";
import { resolveLayout } from "../src/layout";
import type { ResolvedTab } from "../src/types";

function resolved(fixtureName: string): NonNullable<ReturnType<typeof resolveLayout>> {
    const fixturePath = path.resolve(__dirname, "../../client/testFixture/maps", fixtureName);
    const model = buildModel(mapParser.parse(new Uint8Array(fs.readFileSync(fixturePath)), { skipMapTiles: true }));
    const layout = formatAdapterRegistry.get("map")!.layout!;
    // resolveLayout returns undefined only for unparseable files; real fixtures always produce a layout.
    return resolveLayout("map", layout, model) as NonNullable<ReturnType<typeof resolveLayout>>;
}

const sumSubtabs = (t: ResolvedTab): number =>
    (t.tabs ?? []).reduce((acc, st) => acc + (typeof st.count === "number" ? st.count : 0), 0);

function findVarsTab(fixtureName: string): ResolvedTab {
    const topTabs = resolved(fixtureName).tabs ?? [];
    const vars = topTabs.find((t) => t.id === "variables");
    if (vars === undefined) throw new Error(`variables tab not found in ${fixtureName}`);
    return vars;
}

describe("MAP Variables tab", () => {
    it("exists as a top-level tab with id 'variables' ordered between 'header' and 'objects'", () => {
        const topTabs = resolved("arcaves.map").tabs ?? [];
        const ids = topTabs.map((t) => t.id);
        const hiIdx = ids.indexOf("header");
        const viIdx = ids.indexOf("variables");
        const oiIdx = ids.indexOf("objects");
        expect(viIdx).toBeGreaterThan(-1);
        expect(viIdx).toBeGreaterThan(hiIdx);
        expect(viIdx).toBeLessThan(oiIdx);
    });

    it("has subtabs ordered [globalVars, localVars]", () => {
        const vars = findVarsTab("arcaves.map");
        expect(vars.tabs).toBeDefined();
        if (!vars.tabs) throw new Error("vars.tabs missing despite toBeDefined assertion");
        const subIds = vars.tabs.map((t) => t.id);
        expect(subIds).toEqual(["globalVars", "localVars"]);
    });

    it("Variables count equals sum of subtab counts (arcaves: 21 globals + 0 locals)", () => {
        const vars = findVarsTab("arcaves.map");
        expect(typeof vars.count).toBe("number");
        expect(vars.count).toBe(sumSubtabs(vars));
        // arcaves.map has 21 global vars, 0 local vars.
        expect(vars.count).toBe(21);
        const subtabs = vars.tabs ?? [];
        const globalSub = subtabs.find((t) => t.id === "globalVars");
        const localSub = subtabs.find((t) => t.id === "localVars");
        expect(globalSub?.count).toBe(21);
        // arcaves has no local vars, but the parser emits an empty "Local Variables" group so the Local subtab
        // stays present (the user asked for both subtabs always) with count 0 and an addable empty list.
        expect(localSub?.count).toBe(0);
    });

    it("keeps the Local subtab present (count 0) even when the map has no local vars", () => {
        // The empty section must RESOLVE (entryCount 0) - that is the property the renderer's content filter
        // keys on to keep the subtab visible instead of pruning it.
        const layout = resolved("arcaves.map");
        expect(layout.sections["Local Variables"]).toBeDefined();
        expect(layout.sections["Local Variables"]?.entryCount).toBe(0);
    });

    it("Variables count equals sum of subtab counts (denbus1: 10 globals + 0 locals)", () => {
        const vars = findVarsTab("denbus1.map");
        expect(vars.count).toBe(sumSubtabs(vars));
        // denbus1.map has 10 global vars, 0 local vars.
        expect(vars.count).toBe(10);
    });
});
