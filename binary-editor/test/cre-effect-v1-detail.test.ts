/**
 * A CRE whose `effStructureVersion` is 0 embeds the older 48-byte EFF v1 effect record, NOT the EFF v2 body.
 * Those v1 effects must render through their OWN shared fragment (`creEffectV1BodyRows`) - parallel panels to
 * the v2 effect - rather than a generic auto-form. The CRE Effects list declares the v2 fragment as primary
 * and the v1 fragment as a fallback; the detail pane renders the FIRST whose refs all resolve. This test
 * synthesizes a v1 CRE through the real writer/parser round-trip (no v1 fixture exists in the corpus - every
 * vendored CRE is v2) and asserts: the v1 fragment resolves against a v1 effect, and the v2 fragment does NOT
 * (so the fallback is genuinely needed, not redundant).
 */

import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { creEffectV1BodyLabels, creEffectV1BodyRows, effV2BodyRows } from "@bgforge/binary";
import { creParser } from "../../binary/src/cre/index";
import { getCreCanonicalDocument, rebuildCreCanonicalDocument } from "../../binary/src/cre/canonical-reader";
import { serializeCreCanonicalDocument } from "../../binary/src/cre/canonical-writer";
import { defaultCreEffectV1 } from "../../binary/src/cre/entity-ops";
import { openSession, sessionStore } from "../src/session";
import { getChildren } from "../src/window";
import { getRelationshipModel } from "../src/relationship/registry";
import { buildDetailFieldMap, collectEntryRows, detailVariantRefs, detailVariantResolves } from "../src/detail-layout";

const PREFIX = "cre.effects[].v2"; // CRE routes BOTH v1 and v2 effects into the v2 namespace (see format-adapter).
const FIXTURE = "../../external/infinity-engine/BGT-WeiDU/bgt/modify/cre/edwin6.cre";

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

describe("CRE v1 effects render through the shared v1 fragment (fallback when v2 doesn't resolve)", () => {
    it("resolves the v1 fragment against a v1 effect, and the v2 fragment does not", async () => {
        const bytes = synthesizeV1CreBytes();
        if (!bytes) return;
        const { sessionId } = openSession("file:///v1.cre", bytes);
        const session = sessionStore.get(sessionId);
        if (!session) throw new Error("v1 cre session did not open");
        const { model } = session;
        const rel = getRelationshipModel("cre");

        const effectsGroup = model.nodes.find((n) => n.depth === 0 && n.kind === "group" && n.name === "Effects");
        if (!effectsGroup) throw new Error("no Effects group");
        const entries = getChildren(model, effectsGroup.id, 0, 1, rel);
        expect(entries.total).toBeGreaterThan(0);
        const firstEntry = entries.rows[0]!;

        const childRows = await collectEntryRows(firstEntry.id, (id) =>
            Promise.resolve(getChildren(model, id, 0, 1000, rel).rows),
        );
        const map = buildDetailFieldMap(childRows, creEffectV1BodyLabels(PREFIX));

        const v1 = creEffectV1BodyRows(PREFIX);
        const missing = detailVariantRefs(v1).filter((ref) => !(ref in map));
        expect(missing).toEqual([]);
        expect(detailVariantResolves(v1, map)).toBe(true);

        // The v2 fragment must NOT resolve against a v1 effect (v2-only fields like `timing`/`saveType` are
        // absent), proving the fallback is necessary and the v2 primary cleanly declines a v1 entry.
        expect(detailVariantResolves(effV2BodyRows(PREFIX), map)).toBe(false);
    });
});
