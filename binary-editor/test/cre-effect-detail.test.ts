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

describe("the shared EFF v2 fragment: side-by-side flag/group boxes, Parent Resource flag table", () => {
    // Shape contract for the EFF v2 body fragment, asserted on the producer directly (parallel to the
    // feature-block shape tests). Shared, so a standalone .eff and a CRE-embedded v2 effect both get it.
    const prefix = "eff.body";
    const rows = () => effV2BodyRows(prefix);
    // The row that holds a given flag/group box, identified by a predicate over its blocks.
    const rowWith = (
        pred: (b: ReturnType<typeof effV2BodyRows>[number]["panels"][number]["blocks"][number]) => boolean,
    ) => rows().find((r) => r.panels.some((p) => p.blocks.some(pred)));

    it("places Resistance (single column) next to Save Type in one row", () => {
        // Mirrors the v1 feature-block treatment: resistance single-column on the left, save type wider on the
        // right, side by side in one DetailRow.
        const flagRow = rowWith((b) => b.kind === "flags");
        expect(flagRow).toBeDefined();
        const flagBlocks = flagRow!.panels.flatMap((p) => p.blocks).filter((b) => b.kind === "flags");
        expect(flagBlocks.map((b) => (b.kind === "flags" ? b.field : ""))).toEqual([
            `${prefix}.resistance`,
            `${prefix}.saveType`,
        ]);
        const resistance = flagBlocks.find((b) => b.kind === "flags" && b.field === `${prefix}.resistance`);
        expect(resistance?.kind === "flags" ? resistance.columns : undefined).toBe(1);
    });

    it("groups save bonus + stacking id into one single-column box", () => {
        const saveBox = rows()
            .flatMap((r) => r.panels)
            .flatMap((p) => p.blocks)
            .find((b) => b.kind === "group" && b.fields.includes(`${prefix}.saveBonus`));
        expect(saveBox).toBeDefined();
        if (saveBox?.kind !== "group") throw new Error("save box not a group");
        expect(saveBox.fields).toEqual([`${prefix}.saveBonus`, `${prefix}.stackingIdTobex`]);
        expect(saveBox.columns).toBe(1);
    });

    it("packs Classification and Parameters boxes into the same row", () => {
        const classRow = rowWith((b) => b.kind === "group" && b.label === "Classification");
        expect(classRow).toBeDefined();
        const labels = classRow!.panels
            .flatMap((p) => p.blocks)
            .filter((b) => b.kind === "group")
            .map((b) => (b.kind === "group" ? b.label : ""));
        expect(labels).toContain("Classification");
        expect(labels).toContain("Parameters");
    });

    it("orders the Coordinates box before the Parameters box", () => {
        const boxRow = rowWith((b) => b.kind === "group" && b.label === "Coordinates");
        expect(boxRow).toBeDefined();
        const labels = boxRow!.panels
            .flatMap((p) => p.blocks)
            .filter((b) => b.kind === "group")
            .map((b) => (b.kind === "group" ? b.label : ""));
        expect(labels.indexOf("Coordinates")).toBeLessThan(labels.indexOf("Parameters"));
    });

    it("renders Parent Resource flags as a flag table inside the Parent Resource box", () => {
        const pr = rows()
            .flatMap((r) => r.panels)
            .flatMap((p) => p.blocks)
            .find((b) => b.kind === "group" && b.label === "Parent Resource");
        expect(pr).toBeDefined();
        if (pr?.kind !== "group") throw new Error("Parent Resource not a group");
        // The flags field renders as a flag table, NOT as a plain numeric field.
        expect(pr.fields).not.toContain(`${prefix}.parentResourceFlags`);
        expect(pr.flagsField).toBe(`${prefix}.parentResourceFlags`);
        // ResRef + Type stay as the box's plain fields.
        expect(pr.fields).toEqual([`${prefix}.parentResource`, `${prefix}.parentResourceType`]);
    });

    it("moves time applied to the trailing fields run (last group of metadata)", () => {
        const allBlocks = rows()
            .flatMap((r) => r.panels)
            .flatMap((p) => p.blocks);
        const fieldsBlocks = allBlocks.filter((b) => b.kind === "fields");
        const lastFieldsBlock = fieldsBlocks[fieldsBlocks.length - 1];
        expect(lastFieldsBlock).toBeDefined();
        if (lastFieldsBlock?.kind !== "fields") throw new Error("no trailing fields block");
        // timeApplied is the last field of the trailing run (projectile, variableName, casterLevel, timeApplied).
        expect(lastFieldsBlock.fields).toContain(`${prefix}.timeApplied`);
        expect(lastFieldsBlock.fields[lastFieldsBlock.fields.length - 1]).toBe(`${prefix}.timeApplied`);
    });

    it("keeps Parent Resource flags resolvable through detailVariantRefs", () => {
        const refs = detailVariantRefs(rows());
        expect(refs).toContain(`${prefix}.parentResourceFlags`);
    });
});
