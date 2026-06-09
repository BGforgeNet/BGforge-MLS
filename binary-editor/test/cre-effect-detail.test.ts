/**
 * A CRE-embedded EFF v2 effect must render through the SAME shared layout fragment a standalone `.eff` uses,
 * not a generic auto-form. This drives the real parse + projection on a vendored v2 CRE (edwin6, effStructure
 * version 1) and asserts the producer-shape contract the webview detail pane relies on: every field the
 * shared `effV2BodyRows("cre.effects[].v2")` fragment references resolves in the per-entry field map built
 * from a selected effect entry's child rows. If the CRE adapter's semantic keys ever drift from the fragment
 * refs, this fails instead of the editor silently falling back to the auto-form.
 */

import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { effV2BodyLabels, effV2BodyRows } from "@bgforge/binary";
import { openSession, sessionStore } from "../src/session";
import { getChildren } from "../src/window";
import { getRelationshipModel } from "../src/relationship/registry";
import { buildDetailFieldMap, detailVariantRefs, detailVariantResolves } from "../src/detail-layout";

const CRE_FIXTURE = path.resolve(__dirname, "../../external/infinity-engine/BGT-WeiDU/bgt/modify/cre/edwin6.cre");
const EFFECTS_PREFIX = "cre.effects[].v2";

describe("CRE embedded v2 effect renders through the shared EFF v2 fragment", () => {
    it("resolves every shared-fragment field ref against a selected effect's per-entry map", () => {
        if (!fs.existsSync(CRE_FIXTURE)) return;
        const bytes = new Uint8Array(fs.readFileSync(CRE_FIXTURE));
        const { sessionId } = openSession("file:///edwin6.cre", bytes);
        const session = sessionStore.get(sessionId);
        if (!session) throw new Error("CRE session did not open");
        const { model } = session;
        const rel = getRelationshipModel("cre");

        // The depth-0 Effects group, then its first entry ("Effect 0").
        const effectsGroup = model.nodes.find((n) => n.depth === 0 && n.kind === "group" && n.name === "Effects");
        if (!effectsGroup) throw new Error("no Effects group");
        const entries = getChildren(model, effectsGroup.id, 0, 1, rel);
        expect(entries.total).toBeGreaterThan(0);
        const firstEntry = entries.rows[0]!;

        // Build the per-entry field map exactly as the detail pane does: the entry's child rows keyed by
        // semantic key, with the fragment's label overrides applied.
        const childRows = getChildren(model, firstEntry.id, 0, 1000, rel).rows;
        const map = buildDetailFieldMap(childRows, effV2BodyLabels(EFFECTS_PREFIX));

        const variant = effV2BodyRows(EFFECTS_PREFIX);
        // Every ref the shared fragment uses must resolve - otherwise the webview falls back to the auto-form
        // and the embedded effect looks different from a standalone one (the bug this feature fixes).
        const missing = detailVariantRefs(variant).filter((ref) => !(ref in map));
        expect(missing).toEqual([]);
        expect(detailVariantResolves(variant, map)).toBe(true);

        // Opcode is the discriminator and must reach the detail as the searchable enum (same control as the
        // standalone .eff), and the label override must have applied to a renamed field.
        const opcode = map[`${EFFECTS_PREFIX}.opcode`];
        expect(opcode?.valueType).toBe("enum");
        expect(opcode?.searchableEnum).toBe(true);
        expect(map[`${EFFECTS_PREFIX}.casterXCoord`]?.name).toBe("Caster X Coordinate");
    });
});
