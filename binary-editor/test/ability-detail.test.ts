/**
 * ITM/SPL abilities must render through SHARED ability fragments - parallel to the effect fragments - rather
 * than a generic auto-form, so an ability reads as curated panels consistent with the effects beside it. This
 * drives the real parse + projection on vendored fixtures and asserts the producer-shape contract the detail
 * pane relies on: every field the shared `<fmt>AbilityBodyRows("<fmt>.abilities[]")` fragment references
 * resolves in the per-entry field map built from a selected ability entry's child rows - including the ITM
 * `Melee Animation` slot array, which the detail map can only carry now that each slot has a distinct key.
 */

import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { itmAbilityBodyLabels, itmAbilityBodyRows, splAbilityBodyLabels, splAbilityBodyRows } from "@bgforge/binary";
import { openSession, sessionStore } from "../src/session";
import { getChildren } from "../src/window";
import { getRelationshipModel } from "../src/relationship/registry";
import { buildDetailFieldMap, collectEntryRows, detailVariantRefs, detailVariantResolves } from "../src/detail-layout";

const CASES = [
    {
        fmt: "itm",
        fixture: "../../external/infinity-engine/bg2-wildmage/wildmage/wild_spells/itm/wm_sbook.itm",
        rows: itmAbilityBodyRows,
        labels: itmAbilityBodyLabels,
        // The three melee-animation slots must each resolve distinctly in the per-entry map.
        meleeSlots: [
            "itm.abilities[].meleeAnimation.overhand",
            "itm.abilities[].meleeAnimation.backhand",
            "itm.abilities[].meleeAnimation.thrust",
        ],
    },
    {
        fmt: "spl",
        fixture: "../../external/infinity-engine/Ascension/ascension/powers/resource/berserk.spl",
        rows: splAbilityBodyRows,
        labels: splAbilityBodyLabels,
        meleeSlots: [],
    },
] as const;

describe("ITM/SPL abilities render through the shared ability fragment", () => {
    for (const { fmt, fixture, rows, labels, meleeSlots } of CASES) {
        const prefix = `${fmt}.abilities[]`;
        it(`${fmt}: resolves every fragment ref against a selected ability's per-entry map`, async () => {
            const fixturePath = path.resolve(__dirname, fixture);
            if (!fs.existsSync(fixturePath)) return;
            const bytes = new Uint8Array(fs.readFileSync(fixturePath));
            const { sessionId } = openSession(`file:///fixture.${fmt}`, bytes);
            const session = sessionStore.get(sessionId);
            if (!session) throw new Error(`${fmt} session did not open`);
            const { model } = session;
            const rel = getRelationshipModel(fmt);

            const abilitiesGroup = model.nodes.find(
                (n) => n.depth === 0 && n.kind === "group" && n.name === "Abilities",
            );
            if (!abilitiesGroup) throw new Error("no Abilities group");
            const entries = getChildren(model, abilitiesGroup.id, 0, 1, rel);
            expect(entries.total).toBeGreaterThan(0);
            const firstEntry = entries.rows[0]!;

            // Flatten nested groups (the ITM Melee Animation slots are grandchildren of the ability) the same
            // way the webview detail pane does, so slot leaves reach the per-entry map.
            const childRows = await collectEntryRows(firstEntry.id, (id) =>
                Promise.resolve(getChildren(model, id, 0, 1000, rel).rows),
            );
            const map = buildDetailFieldMap(childRows, labels(prefix));
            const variant = rows(prefix);

            const missing = detailVariantRefs(variant).filter((ref) => !(ref in map));
            expect(missing).toEqual([]);
            expect(detailVariantResolves(variant, map)).toBe(true);

            // The fragment must NOT reference the serializer-managed feature-block pointers.
            const refs = detailVariantRefs(variant);
            expect(refs.some((r) => r.toLowerCase().includes("featureblock"))).toBe(false);

            for (const slot of meleeSlots) {
                expect(map[slot]).toBeDefined();
            }
        });
    }
});
