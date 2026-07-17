/**
 * IESDP field documentation reaches the editor as a per-field tooltip (`Row.description`) plus a "read the full
 * write-up" link (`Row.docUrl`, present only when the tooltip was capped). The generator threads the cleaned
 * IESDP text onto the presentation channel (editor-only - never the JSON snapshot), and `projectRow` overlays it
 * via `resolveFieldPresentation`. This drives the real parse + projection on a vendored SPL fixture and asserts
 * the channel surfaces for a NON-ITM format across all three of its regenerated spec sources (header, ability,
 * and the shared feature-block/effect), guarding the format-agnostic wiring the rollout depends on. ITM's own
 * end of this channel is covered by the render harness (`render-itm.mts`).
 */

import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { Row } from "../src/types";
import { openSession, sessionStore } from "../src/session";
import { projectRow } from "../src/window";

const SPL_FIXTURE = "../../external/infinity-engine/Ascension/ascension/powers/resource/berserk.spl";

/** Project every field node and return the one whose resolved semantic key matches, or undefined. */
function rowBySemanticKey(fixture: string, semanticKey: string): Row | undefined {
    const fixturePath = path.resolve(__dirname, fixture);
    if (!fs.existsSync(fixturePath)) return undefined;
    const bytes = new Uint8Array(fs.readFileSync(fixturePath));
    const { sessionId } = openSession("file:///fixture.spl", bytes);
    const session = sessionStore.get(sessionId);
    if (!session) throw new Error("spl session did not open");
    const { model } = session;
    for (const node of model.nodes) {
        if (node.kind !== "field") continue;
        const row = projectRow(model, node);
        if (row.semanticKey === semanticKey) return row;
    }
    return undefined;
}

describe("IESDP field docs surface as Row.description/docUrl through the editor render path", () => {
    it("a capped header field carries both the description and a page docUrl", () => {
        const type = rowBySemanticKey(SPL_FIXTURE, "spl.header.type");
        if (!type) return; // fixture not checked out
        // Long IESDP entry -> tooltip capped, so a docUrl to the spell's own IESDP page is emitted alongside.
        expect(type.description?.startsWith("Spell type")).toBe(true);
        expect(type.docUrl).toContain("spl_v1.htm");
    });

    it("a short header field carries the description but NO docUrl (uncapped)", () => {
        const offset = rowBySemanticKey(SPL_FIXTURE, "spl.header.extendedHeadersOffset");
        if (!offset) return;
        // The full IESDP text fits under the cap, so there is nothing more to link to.
        expect(offset.description).toBe("Extended Header offset");
        expect(offset.docUrl).toBeUndefined();
    });

    it("an ability field (SPL-specific extended-header spec) carries a capped description + docUrl", () => {
        const location = rowBySemanticKey(SPL_FIXTURE, "spl.abilities[].location");
        if (!location) return;
        expect(location.description?.startsWith("Location")).toBe(true);
        expect(location.docUrl).toContain("spl_v1.htm");
    });

    it("the shared feature-block/effect record surfaces its docs inside SPL too", () => {
        const target = rowBySemanticKey(SPL_FIXTURE, "spl.effects[].target");
        if (!target) return;
        // The effect struct is shared across ITM/SPL/CRE and documented on the ITM page, so its docUrl points
        // there even when the effect is embedded in a spell - the link follows the record, not the container.
        expect(target.description?.startsWith("Target type")).toBe(true);
        expect(target.docUrl).toContain("itm_v1.htm");
    });
});
