/**
 * ITM/SPL effects (48-byte feature blocks) must render through the SHARED feature-block fragment - parallel to
 * the EFF v2 body and to CRE-embedded effects - not a generic auto-form. Drives the real parse + projection on
 * vendored fixtures and asserts the producer-shape contract the detail pane relies on: every field the shared
 * `featureBlockBodyRows("<fmt>.effects[]")` fragment references resolves in the per-entry field map built from
 * a selected effect entry's child rows. Guards against the adapter's semantic keys drifting from the fragment.
 */

import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { featureBlockBodyLabels, featureBlockBodyRows } from "@bgforge/binary";
import { openSession, sessionStore } from "../src/session";
import { getChildren } from "../src/window";
import { getRelationshipModel } from "../src/relationship/registry";
import { buildDetailFieldMap, detailVariantRefs, detailVariantResolves } from "../src/detail-layout";

const CASES = [
    {
        fmt: "itm",
        fixture: "../../external/infinity-engine/bg2-wildmage/wildmage/wild_spells/itm/wm_sbook.itm",
    },
    {
        fmt: "spl",
        fixture: "../../external/infinity-engine/Ascension/ascension/powers/resource/berserk.spl",
    },
] as const;

describe("ITM/SPL effects render through the shared feature-block fragment", () => {
    for (const { fmt, fixture } of CASES) {
        const prefix = `${fmt}.effects[]`;
        it(`${fmt}: resolves every fragment ref against a selected effect's per-entry map`, () => {
            const fixturePath = path.resolve(__dirname, fixture);
            if (!fs.existsSync(fixturePath)) return;
            const bytes = new Uint8Array(fs.readFileSync(fixturePath));
            const { sessionId } = openSession(`file:///fixture.${fmt}`, bytes);
            const session = sessionStore.get(sessionId);
            if (!session) throw new Error(`${fmt} session did not open`);
            const { model } = session;
            const rel = getRelationshipModel(fmt);

            const effectsGroup = model.nodes.find((n) => n.depth === 0 && n.kind === "group" && n.name === "Effects");
            if (!effectsGroup) throw new Error("no Effects group");
            const entries = getChildren(model, effectsGroup.id, 0, 1, rel);
            expect(entries.total).toBeGreaterThan(0);
            const firstEntry = entries.rows[0]!;

            const childRows = getChildren(model, firstEntry.id, 0, 1000, rel).rows;
            const map = buildDetailFieldMap(childRows, featureBlockBodyLabels(prefix));
            const variant = featureBlockBodyRows(prefix);

            const missing = detailVariantRefs(variant).filter((ref) => !(ref in map));
            expect(missing).toEqual([]);
            expect(detailVariantResolves(variant, map)).toBe(true);

            // Opcode reaches the detail as an open enum (same control as EFF/CRE - every enum is a searchable
            // combobox; opcode is `enumOpen` so it also accepts a custom numeric value), and the level-range
            // label override applied.
            const opcode = map[`${prefix}.opcode`];
            expect(opcode?.valueType).toBe("enum");
            expect(opcode?.enumOpen).toBe(true);
            expect(map[`${prefix}.maxLevel`]?.name).toBe("Maximum Level");
        });
    }
});

describe("the shared feature-block fragment: one tight main run, flag boxes grouped at the end", () => {
    // The 48-byte feature block packs ALL its scalars into one 3-column main run (wire byte order down each
    // column); resistance/saveType are pulled out of their wire positions and grouped together in one row at the
    // end - Resistance as a SINGLE column beside Save Type. Shared, so ITM/SPL/CRE all get it.
    const prefix = "itm.effects[]";

    it("packs all scalars into one flat 3-column grid", () => {
        const fieldsBlocks = featureBlockBodyRows(prefix)
            .flatMap((r) => r.panels)
            .flatMap((p) => p.blocks)
            .filter((b) => b.kind === "fields");
        expect(fieldsBlocks).toHaveLength(1);
        const block = fieldsBlocks[0]!;
        expect(block.kind === "fields" ? block.columns : undefined).toBe(3);
        const fields = block.kind === "fields" ? block.fields : [];
        // The one grid carries every scalar (opcode through the stacking id), parameters included.
        for (const key of ["opcode", "parameter1", "parameter2", "maxLevel", "minLevel", "stackingIdEx"]) {
            expect(fields).toContain(`${prefix}.${key}`);
        }
        // parameter1/parameter2 are ordered AFTER timing/duration so they fall in a different column from opcode
        // (column-major fill) - otherwise their long relabeled labels would pad the short "Opcode" label. The
        // render harness verifies opcode hugs; here just pin the order that makes it so.
        expect(fields.indexOf(`${prefix}.parameter1`)).toBeGreaterThan(fields.indexOf(`${prefix}.timing`));
        expect(fields.indexOf(`${prefix}.parameter1`)).toBeGreaterThan(fields.indexOf(`${prefix}.duration`));
    });

    it("groups Resistance (single column) next to Save Type in one row", () => {
        const flagRow = featureBlockBodyRows(prefix).find((r) =>
            r.panels.some((p) => p.blocks.some((b) => b.kind === "flags")),
        );
        expect(flagRow).toBeDefined();
        const flagBlocks = flagRow!.panels.flatMap((p) => p.blocks).filter((b) => b.kind === "flags");
        expect(flagBlocks.map((b) => (b.kind === "flags" ? b.field : ""))).toEqual([
            `${prefix}.resistance`,
            `${prefix}.saveType`,
        ]);
        const resistance = flagBlocks.find((b) => b.kind === "flags" && b.field === `${prefix}.resistance`);
        expect(resistance?.kind === "flags" ? resistance.columns : undefined).toBe(1);
    });
});
