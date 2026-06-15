/**
 * A CRE whose `effStructureVersion` is 0 embeds the 48-byte EFF v1 effect record. That record is byte-for-byte
 * the SAME structure as the ITM/SPL feature block (IESDP documents them as one thing - feature_block.yml points
 * to eff_v1.htm for every field), so CRE v0 effects render through the SAME shared fragment ITM/SPL use
 * (`featureBlockBodyRows`), not a CRE-local copy. The CRE Effects list declares the EFF v2 fragment as primary
 * and the feature-block fragment as the fallback; the detail pane renders the FIRST whose refs all resolve. This
 * test synthesizes a v0 CRE through the real writer/parser round-trip (no v0 fixture exists in the corpus -
 * every vendored CRE is v2) and asserts the shared fragment resolves, the v2 fragment does not, the parsed
 * fields use the feature-block names (not the retired CRE-local names), and the bytes round-trip.
 */

import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { effV2BodyRows, featureBlockBodyLabels, featureBlockBodyRows } from "@bgforge/binary";
import { creParser } from "../../binary/src/cre/index";
import { getCreCanonicalDocument, rebuildCreCanonicalDocument } from "../../binary/src/cre/canonical-reader";
import { serializeCreCanonicalDocument } from "../../binary/src/cre/canonical-writer";
import { defaultCreEffectV1 } from "../../binary/src/cre/entity-ops";
import { openSession, sessionStore } from "../src/session";
import { getChildren } from "../src/window";
import { getRelationshipModel } from "../src/relationship/registry";
import { buildDetailFieldMap, collectEntryRows, detailVariantRefs, detailVariantResolves } from "../src/detail-layout";

const PREFIX = "cre.effects[].v2"; // CRE routes BOTH effect kinds into one per-entry namespace (see layout-schema).
const FIXTURE = "../../external/infinity-engine/BGT-WeiDU/bgt/modify/cre/edwin6.cre";

const fixturePresent = fs.existsSync(path.resolve(__dirname, FIXTURE));
const maybe = fixturePresent ? describe : describe.skip;

function synthesizeV1CreBytes(): Uint8Array | undefined {
    const fixturePath = path.resolve(__dirname, FIXTURE);
    if (!fs.existsSync(fixturePath)) return undefined;
    const parsed = creParser.parse(new Uint8Array(fs.readFileSync(fixturePath)));
    const doc = getCreCanonicalDocument(parsed) ?? rebuildCreCanonicalDocument(parsed);
    if (!doc) return undefined;
    const v1doc = {
        ...doc,
        header: { ...doc.header, effStructureVersion: 0 },
        effects: { kind: "v1" as const, records: [{ ...defaultCreEffectV1(), opcode: 10 }] },
    };
    return serializeCreCanonicalDocument(v1doc);
}

async function v1EffectFieldMap() {
    const bytes = synthesizeV1CreBytes();
    if (!bytes) return undefined;
    const { sessionId } = openSession("file:///v1.cre", bytes);
    const session = sessionStore.get(sessionId);
    if (!session) throw new Error("v1 cre session did not open");
    const { model } = session;
    const rel = getRelationshipModel("cre");
    const effectsGroup = model.nodes.find((n) => n.depth === 0 && n.kind === "group" && n.name === "Effects");
    if (!effectsGroup) throw new Error("no Effects group");
    const entries = getChildren(model, effectsGroup.id, 0, 1, rel);
    expect(entries.total).toBeGreaterThan(0);
    const childRows = await collectEntryRows(entries.rows[0]!.id, (id) =>
        Promise.resolve(getChildren(model, id, 0, 1000, rel).rows),
    );
    return buildDetailFieldMap(childRows, featureBlockBodyLabels(PREFIX));
}

maybe("CRE v0 effects render through the SHARED feature-block fragment (no CRE-local copy)", () => {
    it("resolves the feature-block fragment against a v0 effect, and the v2 fragment does not", async () => {
        const map = await v1EffectFieldMap();
        if (!map) throw new Error("v1EffectFieldMap returned undefined despite fixture being present");
        const fragment = featureBlockBodyRows(PREFIX);
        expect(detailVariantRefs(fragment).filter((ref) => !(ref in map))).toEqual([]);
        expect(detailVariantResolves(fragment, map)).toBe(true);
        // The v2 fragment must NOT resolve (v2-only fields like school/coordinates are absent), proving the
        // fallback is necessary and the v2 primary cleanly declines a v0 entry.
        expect(detailVariantResolves(effV2BodyRows(PREFIX), map)).toBe(false);
    });

    it("parses v0 effect fields under the feature-block names, not the retired CRE-local names", async () => {
        const map = await v1EffectFieldMap();
        if (!map) throw new Error("v1EffectFieldMap returned undefined despite fixture being present");
        // Unified onto effectSpec: the dual-purpose 0x1c/0x20 pair, the resref, timing, and save fields carry
        // the shared feature-block keys.
        for (const key of ["timing", "resource", "maxLevel", "minLevel", "saveType", "saveBonus", "stackingIdEx"]) {
            expect(map[`${PREFIX}.${key}`]).toBeDefined();
        }
        // The retired CRE-local names must be gone.
        for (const key of ["timingMode", "resref", "diceThrown", "diceSides", "savingThrowType", "unknown"]) {
            expect(map[`${PREFIX}.${key}`]).toBeUndefined();
        }
    });

    it("round-trips a v0 CRE byte-identically", () => {
        const bytes = synthesizeV1CreBytes();
        if (!bytes) throw new Error("synthesizeV1CreBytes returned undefined despite fixture being present");
        const reparsed = creParser.parse(bytes);
        const doc = getCreCanonicalDocument(reparsed) ?? rebuildCreCanonicalDocument(reparsed);
        expect(doc).toBeDefined();
        const out = serializeCreCanonicalDocument(doc!);
        expect([...out]).toEqual([...bytes]);
    });
});
